import './ui/style.css';
import { aircraftRegistry, type AircraftDefinition } from './aircraft/registry';
import weaponCatalog from './combat/weapons.json';
import { detectCapabilities } from './core/capabilities';
import { CameraRig, attitudeFromQuat } from './cockpit/camera';
import { mountCockpitShell } from './cockpit/cockpitShell';
import { AircraftView } from './cockpit/aircraftView';
import { CockpitSceneControls } from './cockpit/sceneControls';
import { INITIAL_WAYPOINT, NavigationDisplay } from './navigation/navigation';
import { Hud } from './cockpit/hud';
import { PanelToggles } from './ui/panelToggles';
import { PhysicsClient, type ControlInput } from './physics/PhysicsClient';
import { CRASH_BUILDING, LAND_DECK, type AircraftSnapshot } from './physics/stateLayout';
import { DynamicResolution } from './rendering/dynamicResolution';
import { createRenderer } from './rendering/createRenderer';
import type { Backend } from './rendering/Renderer';
import { activeWarnings } from './physics/warnings';
import { attractCamera } from './ui/attract';
import { WarningAudio } from './ui/audio';
import { TUTORIAL_CHAPTERS, Tutorial, chapterSteps, type TutorialFlag, type TutorialView } from './ui/tutorial';
import { FreeLook } from './ui/look';
import { TouchControls, isTouchDevice } from './ui/touch';
import { KeyboardControls } from './ui/input';
import { EncyclopediaViewer } from './encyclopedia/modelViewer';
import * as THREE from 'three';

type Mode = 'loading' | 'menu' | 'flying' | 'paused' | 'crashed';

const MS_TO_KT = 1.943844;
/** Wall-clock delay between the impact and the result card, so the flash / shake can play. */
const CRASH_CARD_DELAY_MS = 1500;
const FADE_MS = 450;

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in index.html`);
  return el as T;
};

const stage = $<HTMLDivElement>('stage');
const hudCanvas = $<HTMLCanvasElement>('hud');
const statusEl = $<HTMLPreElement>('status');
const errorEl = $<HTMLDivElement>('error');
const menuEl = $<HTMLElement>('menu');
const pauseEl = $<HTMLDivElement>('pause');
const crashEl = $<HTMLDivElement>('crash');
const fadeEl = $<HTMLDivElement>('fade');
const startBtn = $<HTMLButtonElement>('btn-start');
const howtoBtn = $<HTMLButtonElement>('btn-howto');
const howtoEl = $<HTMLElement>('howto');
const crashStatsEl = $<HTMLDListElement>('crash-stats');
const crashTitleEl = $<HTMLHeadingElement>('crash-title');
const tutorialBtn = $<HTMLButtonElement>('btn-tutorial');
const tutorialEl = $<HTMLElement>('tutorial');
const tutorialStepEl = $<HTMLElement>('tutorial-step');
const tutorialTitleEl = $<HTMLElement>('tutorial-title');
const tutorialHintEl = $<HTMLElement>('tutorial-hint');
const tutorialBarEl = $<HTMLElement>('tutorial-bar');
const tutorialCautionEl = $<HTMLElement>('tutorial-caution');
const tutorialChapterEl = $<HTMLElement>('tutorial-chapter');
const tutorialBodyEl = $<HTMLElement>('tutorial-body');
const tutorialNextBtn = $<HTMLButtonElement>('tutorial-next');

function fail(message: string): void {
  errorEl.hidden = false;
  errorEl.textContent = message;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const forced: Backend | undefined = params.get('backend') === 'webgl2' ? 'webgl2' : undefined;
  const lastKey = ((): string | null => {
    try {
      return localStorage.getItem('cfs.aircraft');
    } catch {
      return null;
    }
  })();
  let aircraft: AircraftDefinition =
    aircraftRegistry.find(params.get('aircraft') ?? lastKey ?? '') ?? aircraftRegistry.default;
  const caps = detectCapabilities();
  if (!caps.workers) throw new Error('此瀏覽器不支援 Web Worker，無法執行物理模擬。');

  let mode: Mode = 'loading';
  const setMode = (m: Mode): void => {
    mode = m;
    document.body.dataset.mode = m;
  };
  setMode('loading');
  const aircraftSelect = $<HTMLSelectElement>('aircraft-select');
  const specStart = $<HTMLElement>('spec-start');
  const specDesc = $<HTMLElement>('aircraft-desc');
  for (const a of aircraftRegistry.list()) aircraftSelect.add(new Option(a.displayName, a.key, false, a.key === aircraft.key));
  const showAircraft = (): void => {
    specStart.textContent = `${aircraft.startAltitude.toLocaleString('en-US')} m · ${Math.round(aircraft.startSpeed * MS_TO_KT)} KT · 北向`;
    specDesc.textContent =
      `${aircraft.role} / ${aircraft.description}（空重 ${aircraft.specs.emptyMassKg.toLocaleString()} kg · MTOW ${aircraft.specs.mtowKg.toLocaleString()} kg · 燃油 ${aircraft.specs.fuelKg.toLocaleString()} kg · 最大 M ${aircraft.maxMach} · G ${aircraft.gLimit}）`;
  };
  showAircraft();

  const hangarPage = $<HTMLElement>('hangar-page');
  const equipmentPage = $<HTMLElement>('equipment-page');
  const tutorialPage = $<HTMLElement>('tutorial-page');
  const tutorialGrid = $<HTMLDivElement>('tutorial-grid');
  const hangarGrid = $<HTMLDivElement>('hangar-grid');
  const equipmentGrid = $<HTMLDivElement>('equipment-grid');
  const encyclopediaPage = $<HTMLElement>('encyclopedia-page');
  const encyclopedia = new EncyclopediaViewer({
    canvas: $<HTMLCanvasElement>('encyclopedia-model'),
    list: $<HTMLElement>('encyclopedia-list'),
    title: $<HTMLElement>('encyclopedia-title'),
    description: $<HTMLElement>('encyclopedia-description'),
    specs: $<HTMLElement>('encyclopedia-specs'),
    category: $<HTMLSelectElement>('encyclopedia-category'),
    chart: document.getElementById('encyclopedia-chart'),
    parts: document.getElementById('encyclopedia-parts'),
  }, aircraftRegistry.list(), weaponCatalog);
  const menuPanel = menuEl.querySelector('.panel') as HTMLDivElement;
  const equipmentOptions = weaponCatalog.map((weapon) => ({
    id: weapon.id,
    name: weapon.name,
    desc: `${weapon.category} · ${weapon.role}。 ${weapon.description}`,
    note: `${weapon.effect} · ${weapon.capacity} 次遊戲額度 · 冷卻 ${weapon.cooldown.toFixed(1)} s`,
  }));
  let selectedEquipment = (() => {
    try { return localStorage.getItem('cfs.equipment') ?? 'nova17'; } catch { return 'pulse'; }
  })();
  if (!weaponCatalog.some((weapon) => weapon.id === selectedEquipment)) selectedEquipment = 'nova17';
  document.body.dataset.equipment = selectedEquipment;
  let hangarPreviewRenderer: THREE.WebGLRenderer | null = null;
  let hangarPreviewScene: THREE.Scene | null = null;
  let hangarPreviewCamera: THREE.PerspectiveCamera | null = null;
  let hangarPreviewRoot: THREE.Group | null = null;
  let hangarPreviewCanvas: HTMLCanvasElement | null = null;
  let hangarPreviewActive = false;
  let hangarPreviewResize: ResizeObserver | null = null;
  let hangarPreviewSelected: AircraftDefinition = aircraft;
  let hangarPointer: { x: number; y: number; id: number } | null = null;

  const setHangarPreviewModel = (definition: AircraftDefinition): void => {
    hangarPreviewSelected = definition;
    if (!hangarPreviewRoot) return;
    for (const child of [...hangarPreviewRoot.children]) {
      child.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose();
        if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose());
        else mesh.material?.dispose();
      });
    }
    hangarPreviewRoot.clear();
    hangarPreviewRoot.add(encyclopedia.createAircraftModel(definition.id));
    hangarPreviewRoot.rotation.set(-0.12, -0.52, 0);
  };

  const resizeHangarPreview = (): void => {
    if (!hangarPreviewRenderer || !hangarPreviewCamera || !hangarPreviewCanvas) return;
    const host = hangarPreviewCanvas.parentElement;
    if (!host) return;
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    hangarPreviewRenderer.setSize(width, height, false);
    hangarPreviewCamera.aspect = width / height;
    hangarPreviewCamera.updateProjectionMatrix();
  };

  const ensureHangarPreview = (canvas: HTMLCanvasElement): void => {
    if (hangarPreviewRenderer) {
      resizeHangarPreview();
      return;
    }
    hangarPreviewCanvas = canvas;
    hangarPreviewRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' });
    hangarPreviewRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    hangarPreviewRenderer.outputColorSpace = THREE.SRGBColorSpace;
    hangarPreviewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    hangarPreviewRenderer.toneMappingExposure = 1.2;
    hangarPreviewScene = new THREE.Scene();
    hangarPreviewScene.background = new THREE.Color(0x07120f);
    hangarPreviewScene.add(new THREE.HemisphereLight(0xd9f6e4, 0x15211d, 2.25));
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
    keyLight.position.set(7, 10, 8);
    hangarPreviewScene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x6bd9ae, 1.8);
    rimLight.position.set(-7, 3, -5);
    hangarPreviewScene.add(rimLight);
    const floor = new THREE.GridHelper(24, 24, 0x315447, 0x172b24);
    floor.position.y = -1.55;
    hangarPreviewScene.add(floor);
    hangarPreviewRoot = new THREE.Group();
    hangarPreviewScene.add(hangarPreviewRoot);
    hangarPreviewCamera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);
    hangarPreviewCamera.position.set(9, 6.2, 10);
    hangarPreviewCamera.lookAt(0, 0, 0);
    hangarPreviewResize = new ResizeObserver(resizeHangarPreview);
    if (canvas.parentElement) hangarPreviewResize.observe(canvas.parentElement);
    canvas.addEventListener('pointerdown', (event) => {
      hangarPointer = { x: event.clientX, y: event.clientY, id: event.pointerId };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!hangarPointer || !hangarPreviewRoot) return;
      const dx = event.clientX - hangarPointer.x;
      const dy = event.clientY - hangarPointer.y;
      hangarPointer.x = event.clientX;
      hangarPointer.y = event.clientY;
      hangarPreviewRoot.rotation.y += dx * 0.009;
      hangarPreviewRoot.rotation.x = THREE.MathUtils.clamp(hangarPreviewRoot.rotation.x + dy * 0.006, -0.85, 0.85);
    });
    const stopHangarDrag = (): void => { hangarPointer = null; };
    canvas.addEventListener('pointerup', stopHangarDrag);
    canvas.addEventListener('pointercancel', stopHangarDrag);
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      if (!hangarPreviewCamera) return;
      hangarPreviewCamera.position.multiplyScalar(event.deltaY > 0 ? 1.08 : 0.93);
      hangarPreviewCamera.position.clampLength(6.5, 24);
      hangarPreviewCamera.lookAt(0, 0, 0);
    }, { passive: false });
    setHangarPreviewModel(hangarPreviewSelected);
    resizeHangarPreview();
    const draw = (): void => {
      requestAnimationFrame(draw);
      if (hangarPreviewActive && hangarPreviewRenderer && hangarPreviewScene && hangarPreviewCamera) {
        hangarPreviewRenderer.render(hangarPreviewScene, hangarPreviewCamera);
      }
    };
    requestAnimationFrame(draw);
  };

  const setHangarPreviewActive = (active: boolean): void => {
    hangarPreviewActive = active;
    if (active && hangarPreviewCanvas) {
      if (hangarPreviewCanvas.parentElement) hangarPreviewResize?.observe(hangarPreviewCanvas.parentElement);
      resizeHangarPreview();
    } else {
      hangarPreviewResize?.disconnect();
    }
  };

  const openSubpage = (page: HTMLElement): void => {
    for (const candidate of [hangarPage, equipmentPage, encyclopediaPage, tutorialPage]) candidate.hidden = candidate !== page;
    menuPanel.classList.add('subpage-open');
    encyclopedia.setActive(page === encyclopediaPage);
    setHangarPreviewActive(page === hangarPage);
  };
  const closeSubpage = (): void => {
    hangarPage.hidden = true;
    equipmentPage.hidden = true;
    tutorialPage.hidden = true;
    encyclopediaPage.hidden = true;
    encyclopedia.setActive(false);
    setHangarPreviewActive(false);
    menuPanel.classList.remove('subpage-open');
  };
  let aircraftView: AircraftView | null = null;
  const applyAircraftChoice = (key: string): void => {
    const next = aircraftRegistry.find(key);
    if (!next || next === aircraft) return;
    aircraft = next;
    hangarPreviewSelected = next;
    setHangarPreviewModel(next);
    aircraftView?.setAircraft(next);
    aircraftSelect.value = aircraft.key;
    physics.setAircraft(aircraft.toPhysicsArray());
    window.dispatchEvent(new CustomEvent('cfs:aircraft', { detail: aircraft.key }));
    physics.pause();
    input.reset(aircraft.startThrottle);
    showAircraft();
    try { localStorage.setItem('cfs.aircraft', aircraft.key); } catch { /* storage optional */ }
    renderHangar();
  };
  let hangarRoster: HTMLDivElement | null = null;
  let hangarDetailTitle: HTMLElement | null = null;
  let hangarDetailRole: HTMLElement | null = null;
  let hangarDetailDescription: HTMLElement | null = null;
  let hangarDetailFeatures: HTMLElement | null = null;
  let hangarDetailSpecs: HTMLDivElement | null = null;
  let hangarDetailMetrics: HTMLDivElement | null = null;
  let hangarUseButton: HTMLButtonElement | null = null;

  const updateHangarDetail = (): void => {
    const item = hangarPreviewSelected;
    if (!hangarDetailTitle || !hangarDetailRole || !hangarDetailDescription || !hangarDetailFeatures || !hangarDetailSpecs || !hangarDetailMetrics || !hangarUseButton) return;
    hangarDetailTitle.textContent = item.displayName;
    hangarDetailRole.textContent = item.role;
    hangarDetailDescription.textContent = item.description;
    hangarDetailFeatures.textContent = item.features || '原創機型設定';
    hangarDetailSpecs.replaceChildren();
    const s = item.specs;
    const facts: Array<[string, string]> = [
      ['EMPTY MASS', Math.round(s.emptyMassKg).toLocaleString('en-US') + ' kg'],
      ['MAX TAKEOFF', Math.round(s.mtowKg).toLocaleString('en-US') + ' kg'],
      ['FUEL', Math.round(s.fuelKg).toLocaleString('en-US') + ' kg'],
      ['PAYLOAD', Math.round(s.payloadKg).toLocaleString('en-US') + ' kg'],
    ];
    for (const fact of facts) {
      const cell = document.createElement('div');
      cell.className = 'hangar-fact';
      const label = document.createElement('span');
      label.textContent = fact[0];
      const value = document.createElement('strong');
      value.textContent = fact[1];
      cell.append(label, value);
      hangarDetailSpecs.append(cell);
    }
    hangarDetailMetrics.replaceChildren();
    const all = aircraftRegistry.list();
    const metrics: Array<{ label: string; value: number; max: number; suffix: string; digits: number }> = [
      { label: 'MAX MACH', value: item.maxMach, max: Math.max(...all.map((a) => a.maxMach)), suffix: ' M', digits: 2 },
      { label: 'SERVICE CEILING', value: s.ceilingM, max: Math.max(...all.map((a) => a.specs.ceilingM)), suffix: ' m', digits: 0 },
      { label: 'COMBAT RADIUS', value: s.rangeKm, max: Math.max(...all.map((a) => a.specs.rangeKm)), suffix: ' km', digits: 0 },
      { label: 'THRUST', value: s.thrustKN, max: Math.max(...all.map((a) => a.specs.thrustKN)), suffix: ' kN', digits: 0 },
    ];
    for (const metric of metrics) {
      const row = document.createElement('div');
      row.className = 'hangar-metric';
      const header = document.createElement('div');
      header.className = 'hangar-metric-head';
      const label = document.createElement('span');
      label.textContent = metric.label;
      const value = document.createElement('strong');
      value.textContent = metric.value.toFixed(metric.digits) + metric.suffix;
      const track = document.createElement('div');
      track.className = 'hangar-metric-track';
      const fill = document.createElement('i');
      fill.style.width = Math.max(0, Math.min(100, metric.max > 0 ? metric.value / metric.max * 100 : 0)) + '%';
      track.append(fill);
      header.append(label, value);
      row.append(header, track);
      hangarDetailMetrics.append(row);
    }
    hangarUseButton.textContent = item.key === aircraft.key ? '目前使用中 / IN USE' : '使用此機型 / SELECT AIRCRAFT';
    hangarUseButton.disabled = item.key === aircraft.key;
    hangarRoster?.querySelectorAll<HTMLButtonElement>('[data-aircraft-key]').forEach((button) => {
      const active = button.dataset.aircraftKey === item.key;
      button.classList.toggle('selected', active);
      button.setAttribute('aria-pressed', String(active));
    });
  };

  const renderHangar = (): void => {
    if (!hangarRoster) {
      hangarGrid.className = 'hangar-layout';
      const rosterPanel = document.createElement('aside');
      rosterPanel.className = 'hangar-roster';
      const rosterHeading = document.createElement('div');
      rosterHeading.className = 'hangar-roster-heading';
      rosterHeading.textContent = 'FLEET ROSTER / 機隊';
      hangarRoster = document.createElement('div');
      hangarRoster.className = 'hangar-roster-list';
      rosterPanel.append(rosterHeading, hangarRoster);

      const detail = document.createElement('section');
      detail.className = 'hangar-detail';
      const head = document.createElement('div');
      head.className = 'hangar-detail-heading';
      const titleWrap = document.createElement('div');
      const eyebrow = document.createElement('p');
      eyebrow.className = 'hangar-eyebrow';
      eyebrow.textContent = 'AIRFRAME PROFILE / 機型資料';
      hangarDetailTitle = document.createElement('h3');
      hangarDetailRole = document.createElement('p');
      hangarDetailRole.className = 'hangar-role';
      titleWrap.append(eyebrow, hangarDetailTitle, hangarDetailRole);
      head.append(titleWrap);

      const viewer = document.createElement('div');
      viewer.className = 'hangar-viewer';
      const canvas = document.createElement('canvas');
      canvas.className = 'hangar-model-canvas';
      canvas.setAttribute('aria-label', '可旋轉縮放的飛機 3D 模型');
      const hint = document.createElement('span');
      hint.className = 'hangar-viewer-hint';
      hint.textContent = 'DRAG TO ROTATE · SCROLL TO ZOOM';
      viewer.append(canvas, hint);

      const factsLabel = document.createElement('p');
      factsLabel.className = 'hangar-section-label';
      factsLabel.textContent = 'AIRFRAME DATA / 機體數據';
      hangarDetailSpecs = document.createElement('div');
      hangarDetailSpecs.className = 'hangar-facts';
      const metricsLabel = document.createElement('p');
      metricsLabel.className = 'hangar-section-label';
      metricsLabel.textContent = 'PERFORMANCE INDEX / 性能指標';
      hangarDetailMetrics = document.createElement('div');
      hangarDetailMetrics.className = 'hangar-metrics';
      hangarDetailDescription = document.createElement('p');
      hangarDetailDescription.className = 'hangar-description';
      hangarDetailFeatures = document.createElement('p');
      hangarDetailFeatures.className = 'hangar-features';
      hangarUseButton = document.createElement('button');
      hangarUseButton.type = 'button';
      hangarUseButton.className = 'primary hangar-use';
      hangarUseButton.addEventListener('click', () => applyAircraftChoice(hangarPreviewSelected.key));
      detail.append(head, viewer, factsLabel, hangarDetailSpecs, metricsLabel, hangarDetailMetrics, hangarDetailDescription, hangarDetailFeatures, hangarUseButton);
      hangarGrid.replaceChildren(rosterPanel, detail);

      const style = document.createElement('style');
      style.textContent = '.hangar-layout{display:grid;grid-template-columns:minmax(155px,.62fr) minmax(0,2fr);gap:14px;min-height:520px;margin:14px 0}.hangar-roster{min-height:0;display:flex;flex-direction:column;border:1px solid rgba(125,255,154,.2);background:rgba(5,17,12,.55)}.hangar-roster-heading,.hangar-section-label{margin:0;padding:11px 12px;color:#8db9a1;font:10px ui-monospace,monospace;letter-spacing:.14em;border-bottom:1px solid rgba(125,255,154,.14)}.hangar-roster-list{overflow:auto;max-height:570px;padding:6px;display:flex;flex-direction:column;gap:4px}.hangar-roster-list button{width:100%;padding:10px 9px;text-align:left;font:11px ui-monospace,monospace;background:rgba(18,39,30,.65);border-color:rgba(125,255,154,.12);white-space:normal}.hangar-roster-list button.selected{color:#e3ffed;border-color:#8affb1;background:rgba(82,145,107,.3)}.hangar-detail{min-width:0;display:flex;flex-direction:column;gap:9px}.hangar-detail-heading h3{margin:0;color:#e5fff0;font-size:23px}.hangar-eyebrow,.hangar-section-label{padding:0;border:0;margin:0;color:#8db9a1;font:9px ui-monospace,monospace;letter-spacing:.16em}.hangar-role{margin:4px 0 0;color:#b3d5c0;font-size:12px}.hangar-viewer{position:relative;height:clamp(210px,34vh,330px);overflow:hidden;border:1px solid rgba(125,255,154,.24);border-radius:5px;background:radial-gradient(ellipse at 50% 45%,#1a3029,#07110f 76%)}.hangar-model-canvas{display:block;width:100%;height:100%;touch-action:none;cursor:grab}.hangar-model-canvas:active{cursor:grabbing}.hangar-viewer-hint{position:absolute;right:10px;bottom:8px;color:rgba(193,224,205,.58);font:8px ui-monospace,monospace;pointer-events:none}.hangar-facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}.hangar-fact{padding:9px 8px;background:rgba(125,255,154,.045);border:1px solid rgba(125,255,154,.13);display:flex;flex-direction:column;gap:4px;min-width:0}.hangar-fact span{color:#8db9a1;font:8px ui-monospace,monospace;letter-spacing:.08em}.hangar-fact strong{color:#e6fff0;font:600 12px ui-monospace,monospace;overflow-wrap:anywhere}.hangar-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 16px}.hangar-metric-head{display:flex;justify-content:space-between;gap:8px;margin-bottom:5px;color:#a6cbb4;font:9px ui-monospace,monospace}.hangar-metric-head strong{color:#e6fff0;font-weight:600}.hangar-metric-track{height:5px;background:rgba(255,255,255,.1);overflow:hidden;border-radius:4px}.hangar-metric-track i{display:block;height:100%;background:linear-gradient(90deg,#39765b,#a0f4b5);box-shadow:0 0 9px rgba(125,255,154,.25)}.hangar-description{margin:0;color:rgba(225,242,230,.78);font-size:12px;line-height:1.65}.hangar-features{margin:0;color:#9cc8aa;font:10px/1.6 ui-monospace,monospace}.hangar-use{width:100%;padding:12px}.hangar-use:disabled{opacity:.65;cursor:default}@media(max-width:720px),(max-height:520px){.hangar-layout{grid-template-columns:minmax(100px,.58fr) minmax(0,1.6fr);gap:7px;min-height:0}.hangar-roster-list{max-height:400px;padding:4px}.hangar-roster-list button{padding:8px 5px;font-size:9px}.hangar-detail-heading h3{font-size:17px}.hangar-viewer{height:190px}.hangar-facts{grid-template-columns:repeat(2,minmax(0,1fr))}.hangar-metrics{grid-template-columns:1fr;gap:7px}.hangar-fact strong{font-size:10px}.hangar-section-label{font-size:8px}}@media(max-width:430px){.hangar-layout{grid-template-columns:94px minmax(0,1fr)}.hangar-viewer{height:165px}.hangar-roster-list button{font-size:8px}.hangar-detail-heading h3{font-size:15px}}';
      document.head.append(style);
      hangarRoster.replaceChildren();
      for (const item of aircraftRegistry.list()) {
        const entry = document.createElement('button');
        entry.type = 'button';
        entry.dataset.aircraftKey = item.key;
        entry.textContent = item.displayName;
        entry.addEventListener('click', () => {
          setHangarPreviewModel(item);
          updateHangarDetail();
        });
        hangarRoster.append(entry);
      }
      ensureHangarPreview(canvas);
    }
    updateHangarDetail();
  };
  const renderEquipment = (): void => {
    equipmentGrid.replaceChildren();
    for (const option of equipmentOptions) {
      const card = document.createElement('article');
      card.className = 'selection-card';
      const title = document.createElement('h3');
      title.textContent = option.name;
      const desc = document.createElement('p');
      desc.textContent = option.desc;
      const note = document.createElement('small');
      note.textContent = option.note;
      const select = document.createElement('button');
      select.type = 'button';
      select.className = selectedEquipment === option.id ? 'primary' : 'ghost';
      select.textContent = selectedEquipment === option.id ? '已配置' : '配置此裝備';
      select.addEventListener('click', () => {
        selectedEquipment = option.id;
        document.body.dataset.equipment = selectedEquipment;
        try { localStorage.setItem('cfs.equipment', selectedEquipment); } catch { /* storage optional */ }
        window.dispatchEvent(new CustomEvent('cfs:equipment-select', { detail: { id: selectedEquipment } }));
        renderEquipment();
      });
      card.append(title, desc, note, select);
      equipmentGrid.append(card);
    }
  };
  renderHangar();
  renderEquipment();
  $<HTMLButtonElement>('btn-hangar').addEventListener('click', () => openSubpage(hangarPage));
  $<HTMLButtonElement>('btn-equipment').addEventListener('click', () => openSubpage(equipmentPage));
  $<HTMLButtonElement>('btn-encyclopedia').addEventListener('click', () => openSubpage(encyclopediaPage));
  menuEl.querySelectorAll<HTMLButtonElement>('[data-page-back]').forEach((button) => button.addEventListener('click', closeSubpage));
  document.body.dataset.equipment = selectedEquipment;
  howtoBtn.addEventListener('click', () => {
    howtoEl.hidden = !howtoEl.hidden;
    howtoBtn.setAttribute('aria-expanded', String(!howtoEl.hidden));
  });

  const physics = new PhysicsClient();
  const wasmUrl = new URL(`${import.meta.env.BASE_URL}wasm/physics_engine.wasm`, location.href).href;
  const [handle] = await Promise.all([createRenderer(stage, forced), physics.start(wasmUrl, aircraft.toPhysicsArray())]);
  const { renderer, fallbackLog } = handle;
  handle.canvas.style.position = 'absolute';
  handle.canvas.style.inset = '0';
  handle.canvas.style.zIndex = '0';
  physics.pause(); // the sim only runs while a flight is in progress

  $<HTMLElement>('spec-backend').textContent = renderer.backend === 'webgpu' ? 'WebGPU' : 'WebGL 2';

  const hud = new Hud(hudCanvas);
  const input = new KeyboardControls(aircraft.startThrottle);
  const dynRes = new DynamicResolution();
  const rig = new CameraRig();
  const audio = new WarningAudio();
  const look = new FreeLook();
  const cockpit = mountCockpitShell();
  cockpit.setAircraft(aircraft.key);
  aircraftView = new AircraftView(stage);
  aircraftView.setAircraft(aircraft);
  aircraftView.setVisible(false);
  let visualGear = 0;
  let visualCanopy = 0;
  window.addEventListener('cfs:gear-toggle', () => {
    visualGear = visualGear < 0.5 ? 1 : 0;
    document.body.dataset.gearDown = String(visualGear > 0.5);
    window.dispatchEvent(new CustomEvent('cfs:gear-state', { detail: { down: visualGear > 0.5 } }));
  });

  // In-flight canopy opening is deliberately a hold-to-confirm action. This is a
  // simulator safety affordance; it does not expose a real-aircraft procedure.
  const canopyConfirm = document.createElement('aside');
  canopyConfirm.id = 'canopy-confirm';
  canopyConfirm.innerHTML = '<div class="canopy-confirm-card"><b>CANOPY INTERLOCK</b><span>空中開啟座艙罩？長按確認 1 秒</span><button type="button">按住以確認開啟</button><small>放開即取消</small></div>';
  const canopyStyle = document.createElement('style');
  canopyStyle.textContent = `#canopy-confirm{position:fixed;inset:0;z-index:80;display:none;place-items:center;background:rgba(0,0,0,.72);font:12px ui-monospace,monospace;color:#e8f5ec}#canopy-confirm.on{display:grid}#canopy-confirm .canopy-confirm-card{display:flex;flex-direction:column;gap:12px;width:min(340px,calc(100vw - 36px));padding:20px;border:1px solid #d6a45c;background:linear-gradient(160deg,#1b2922,#050a08);box-shadow:0 14px 50px #000;text-align:center}#canopy-confirm b{color:#ffc56b;letter-spacing:.14em}#canopy-confirm button{min-height:54px;border:1px solid #ffc56b;background:linear-gradient(#584326,#21170b);color:#fff0d2;font:700 12px ui-monospace,monospace;touch-action:none}#canopy-confirm button.holding{background:#8a5d24;box-shadow:inset 0 0 0 3px #ffc56b}#canopy-confirm small{color:#9ba99f}`;
  document.head.append(canopyStyle);
  document.body.append(canopyConfirm);
  const canopyConfirmButton = canopyConfirm.querySelector('button')!;
  let canopyHoldTimer = 0;
  const closeCanopyConfirm = (): void => {
    window.clearTimeout(canopyHoldTimer);
    canopyHoldTimer = 0;
    canopyConfirm.classList.remove('on');
    canopyConfirmButton.classList.remove('holding');
  };
  const applyCanopy = (open: boolean): void => {
    visualCanopy = open ? 1 : 0;
    document.body.dataset.canopyOpen = String(open);
    window.dispatchEvent(new CustomEvent('cfs:canopy-state', { detail: { open } }));
  };
  const requestCanopyToggle = (): void => {
    if (visualCanopy > 0.5) { applyCanopy(false); return; }
    const airborne = Boolean(lastSnap && !lastSnap.landed && lastSnap.altitude > 10);
    if (!airborne) { applyCanopy(true); return; }
    canopyConfirm.classList.add('on');
  };
  canopyConfirmButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    canopyConfirmButton.setPointerCapture(event.pointerId);
    canopyConfirmButton.classList.add('holding');
    canopyHoldTimer = window.setTimeout(() => {
      applyCanopy(true);
      closeCanopyConfirm();
    }, 1000);
  });
  const cancelCanopyHold = (): void => {
    if (canopyHoldTimer) closeCanopyConfirm();
  };
  canopyConfirmButton.addEventListener('pointerup', cancelCanopyHold);
  canopyConfirmButton.addEventListener('pointercancel', cancelCanopyHold);
  canopyConfirmButton.addEventListener('lostpointercapture', cancelCanopyHold);
  canopyConfirm.addEventListener('pointerdown', (event) => {
    if (event.target === canopyConfirm) closeCanopyConfirm();
  });
  window.addEventListener('cfs:canopy-toggle', requestCanopyToggle);
  new PanelToggles();
  new NavigationDisplay();
  new CockpitSceneControls(stage, aircraftView);
  window.addEventListener('cfs:look-recenter', () => { tutorial.note('recenter'); look.recenter(); });
  const touchMode = isTouchDevice();
  document.body.classList.toggle('touch', touchMode);
  window.dispatchEvent(new Event('cfs:touch-mode'));
  const touch = new TouchControls(document.body);
  touch.show(true); // visibility is driven by body[data-mode] in CSS
  hud.compact = touchMode;
  if (touchMode) {
    input.touch = touch.axes;
    touch.onThrottle = (v) => input.setThrottle(v);
    touch.onRecenter = () => { tutorial.note('recenter'); look.recenter(); };
    touch.onPause = () => pauseFlight();
    tutorialEl.style.pointerEvents = 'auto';
    $<HTMLElement>('tutorial-skip').textContent = '點此略過';
    tutorialEl.addEventListener('click', (e) => {
      if (e.target instanceof HTMLButtonElement) return;
      if (tutorialOn && mode === 'flying') tutorial.skip();
    });
  }
  /** Fullscreen + landscape lock where the browser allows it (must run inside the tap handler). */
  const enterImmersive = (): void => {
    if (!touchMode) return;
    try {
      void document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).then(
        () => (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.('landscape').catch(() => undefined),
        () => undefined,
      );
    } catch {
      /* unsupported (iOS Safari): the rotate hint still covers portrait */
    }
  };
  let lastWaypoint: { x: number; z: number } | null = { ...INITIAL_WAYPOINT };
  const tutorialFlags: Record<TutorialFlag, boolean> = {
    map: document.body.dataset.showMap === '1',
    nav: document.body.dataset.showNav === '1',
    radar: document.body.dataset.showRadar === '1',
    autopilot: false,
    landingGuide: false,
  };
  const setTutorialFlag = (flag: TutorialFlag, on: boolean): void => {
    tutorialFlags[flag] = on;
    tutorial.setFlag(flag, on);
  };
  const doneChapters = new Set<string>(((): string[] => {
    try { return JSON.parse(localStorage.getItem('cfs.tutorial.done') ?? '[]') as string[]; } catch { return []; }
  })());
  let tutorialChapter = 0;
  const makeTutorial = (chapter: number): Tutorial => {
    const t = new Tutorial(chapterSteps(TUTORIAL_CHAPTERS[chapter], { afterburner: aircraft.hasAfterburner, touch: touchMode }));
    t.setWaypoint(lastWaypoint);
    for (const [flag, on] of Object.entries(tutorialFlags)) t.setFlag(flag as TutorialFlag, on);
    return t;
  };
  let tutorial = new Tutorial();
  let tutorialOn = false;
  let tutorialView: TutorialView | null = null;
  /** True while the tutorial (not the pilot) has the autopilot engaged for a reading page. */
  let tutorialHoldsAutopilot = false;
  let lastSent: ControlInput = { ...input.state, throttle: -1 }; // force first send

  // ---- flight bookkeeping -------------------------------------------------------------------
  let lastSnap: AircraftSnapshot | null = null;
  let frozenSnap: AircraftSnapshot | null = null;
  let crashedAtMs = 0;
  let transitioning = false;
  const stats = { maxKt: 0, maxG: 0, minAlt: Infinity, preCrashKt: 0 };
  const autopilot = { enabled: false, targetAltitude: 3000, targetHeading: 0, throttle: 0.55, altitudeGain: 0.00018, pitchDamping: 0.62, rollGain: 0.9, headingGain: 0.22, yawDamping: 0.14 };
  window.addEventListener('cfs:autopilot-config', (event) => {
    const cfg = (event as CustomEvent<{ targetAltitude?: number; targetHeading?: number; throttle?: number; altitudeGain?: number; headingGain?: number }>).detail;
    if (Number.isFinite(cfg?.targetAltitude)) autopilot.targetAltitude = cfg.targetAltitude!;
    if (Number.isFinite(cfg?.targetHeading)) autopilot.targetHeading = cfg.targetHeading!;
    if (Number.isFinite(cfg?.throttle)) autopilot.throttle = Math.max(0.2, Math.min(1, cfg.throttle!));
    if (Number.isFinite(cfg?.altitudeGain)) autopilot.altitudeGain = Math.max(0.00005, Math.min(0.0005, cfg.altitudeGain!));
    if (Number.isFinite(cfg?.headingGain)) autopilot.headingGain = Math.max(0.05, Math.min(0.5, cfg.headingGain!));
  });
  const publishAutopilotState = (): void => {
    document.body.dataset.autopilot = String(autopilot.enabled);
    window.dispatchEvent(new CustomEvent('cfs:autopilot-state', { detail: { enabled: autopilot.enabled } }));
  };
  const disengageAutopilot = (): void => {
    if (!autopilot.enabled) return;
    autopilot.enabled = false;
    publishAutopilotState();
  };
  input.onManualInput = disengageAutopilot;
  touch.onManualInput = disengageAutopilot;
  window.addEventListener('cfs:autopilot-toggle', () => {
    if (!lastSnap || mode !== 'flying') return;
    autopilot.enabled = !autopilot.enabled;
    publishAutopilotState();
  });

  /** "Next page" on a reading step, or "next chapter" once the chapter is finished. */
  const advanceTutorial = (): void => {
    if (!tutorialOn || mode !== 'flying' || !tutorialView) return;
    if (tutorialView.kind === 'read') tutorial.acknowledge();
    else if (tutorialView.done && tutorialChapter < TUTORIAL_CHAPTERS.length - 1) {
      tutorialChapter++;
      tutorial = makeTutorial(tutorialChapter);
      tutorialView = null;
    }
  };
  const renderTutorial = (v: TutorialView): void => {
    const chapter = TUTORIAL_CHAPTERS[tutorialChapter];
    tutorialView = v;
    tutorialChapterEl.textContent = `第 ${tutorialChapter + 1} 章 · ${chapter.title}`;
    tutorialStepEl.textContent = v.done ? '完成' : `${v.index + 1} / ${v.total}`;
    tutorialTitleEl.textContent = v.title;
    tutorialHintEl.textContent = touchMode ? v.touchHint : v.hint;
    tutorialBodyEl.hidden = v.body.length === 0;
    const sig = v.body.join('|');
    if (tutorialBodyEl.dataset.sig !== sig) {
      tutorialBodyEl.dataset.sig = sig;
      tutorialBodyEl.replaceChildren(...v.body.map((line) => Object.assign(document.createElement('li'), { textContent: line })));
    }
    tutorialBarEl.style.width = `${(v.progress * 100).toFixed(0)}%`;
    tutorialCautionEl.hidden = v.caution === null;
    if (v.caution) tutorialCautionEl.textContent = v.caution;
    const hasNext = tutorialChapter < TUTORIAL_CHAPTERS.length - 1;
    tutorialNextBtn.hidden = !(v.kind === 'read' || (v.done && hasNext));
    tutorialNextBtn.textContent = v.kind === 'read' ? '下一頁 ▶（Enter）' : `下一章：${TUTORIAL_CHAPTERS[tutorialChapter + 1]?.title ?? ''} ▶`;
    if (v.done && !doneChapters.has(chapter.id)) {
      doneChapters.add(chapter.id);
      try { localStorage.setItem('cfs.tutorial.done', JSON.stringify([...doneChapters])); } catch { /* storage optional */ }
      renderTutorialPage();
    }
    // reading pages run on autopilot so the aircraft stays safe while the pilot reads
    if (lastSnap && v.wantsAutopilot && !autopilot.enabled) {
      const a = attitudeFromQuat(lastSnap.orientation);
      autopilot.targetAltitude = Math.max(1500, lastSnap.altitude);
      autopilot.targetHeading = a.heading;
      autopilot.enabled = true;
      tutorialHoldsAutopilot = true;
      publishAutopilotState();
    } else if (!v.wantsAutopilot && tutorialHoldsAutopilot) {
      tutorialHoldsAutopilot = false;
      disengageAutopilot();
    }
  };

  const showOverlay = (which: 'menu' | 'pause' | 'crash' | null): void => {
    menuEl.hidden = which !== 'menu';
    pauseEl.hidden = which !== 'pause';
    crashEl.hidden = which !== 'crash';
  };

  /** Fade to black, run `change` while hidden, fade back in. */
  const withFade = async (change: () => void): Promise<void> => {
    if (transitioning) return;
    transitioning = true;
    fadeEl.classList.add('on');
    await sleep(FADE_MS);
    change();
    await sleep(60);
    fadeEl.classList.remove('on');
    transitioning = false;
  };

  const beginFlight = (): void => {
    visualGear = 0;
    visualCanopy = 0;
    aircraftView?.setControls({ pitch: 0, roll: 0, yaw: 0, gear: visualGear, flaps: 0, canopy: visualCanopy });
    physics.reset();
    autopilot.enabled = false;
    publishAutopilotState();
    input.reset(aircraft.startThrottle);
    lastSent = { ...input.state, throttle: -1 };
    rig.reset();
    look.reset();
    touch.reset();
    tutorial = makeTutorial(tutorialChapter);
    tutorialView = null;
    tutorialHoldsAutopilot = false;
    tutorialEl.hidden = !tutorialOn;
    lastSnap = null;
    frozenSnap = null;
    stats.maxKt = 0;
    stats.maxG = 0;
    stats.minAlt = Infinity;
    stats.preCrashKt = 0;
    physics.resume();
    showOverlay(null);
    setMode('flying');
    window.dispatchEvent(new Event('cfs:flight-start'));
  };

  const startFlight = (): void => {
    if (mode !== 'menu' && mode !== 'paused' && mode !== 'crashed') return;
    if (mode === 'menu') tutorialOn = false; // restarts keep the current mode; the menu button picks it
    void withFade(beginFlight);
  };

  const startTutorial = (chapter = 0): void => {
    if (mode !== 'menu') return;
    tutorialChapter = chapter;
    tutorialOn = true;
    void withFade(beginFlight);
  };

  const goHome = (): void => {
    if (mode === 'menu' || mode === 'loading') return;
    void withFade(() => {
      physics.pause();
      audio.silence();
      if (document.pointerLockElement) document.exitPointerLock();
      tutorialEl.hidden = true;
      tutorialOn = false;
      frozenSnap = null;
      lastSnap = null;
      showOverlay('menu');
      setMode('menu');
    });
  };

  const pauseFlight = (): void => {
    if (mode !== 'flying') return;
    physics.pause();
    audio.silence();
    if (document.pointerLockElement) document.exitPointerLock();
    touch.reset();
    frozenSnap = lastSnap;
    showOverlay('pause');
    setMode('paused');
  };

  const resumeFlight = (): void => {
    if (mode !== 'paused') return;
    physics.resume();
    showOverlay(null);
    setMode('flying');
  };

  const showCrashCard = (s: AircraftSnapshot): void => {
    const building = s.crashKind === CRASH_BUILDING;
    const row = (k: string, v: string): string => `<dt>${k}</dt><dd>${v}</dd>`;
    if (s.landed) {
      const grade = s.landingSink < 1.5 ? '優異 EXCELLENT' : s.landingSink < 3 ? '良好 GOOD' : '合格 PASS';
      crashTitleEl.textContent = s.landingKind === LAND_DECK ? '降落成功 · 航艦甲板' : '降落成功 · 跑道';
      crashStatsEl.innerHTML =
        row('評級', grade) +
        row('接地下沉率', `${s.landingSink.toFixed(1)} m/s`) +
        row('接地速度', `${stats.preCrashKt.toFixed(0)} KT`) +
        row('飛行時間', `${s.crashTime.toFixed(1)} s`) +
        row('最大過載', `${stats.maxG.toFixed(1)} G`);
      showOverlay('crash');
      return;
    }
    crashTitleEl.textContent = building ? '撞上建築物' : '墜地';
    crashStatsEl.innerHTML =
      row('飛行時間', `${s.crashTime.toFixed(1)} s`) +
      row('撞擊速度', `${stats.preCrashKt.toFixed(0)} KT`) +
      row('最高速度', `${stats.maxKt.toFixed(0)} KT`) +
      row('最大過載', `${stats.maxG.toFixed(1)} G`) +
      row('最低高度', `${Number.isFinite(stats.minAlt) ? stats.minAlt.toFixed(0) : '—'} m`);
    showOverlay('crash');
  };

  aircraftSelect.addEventListener('change', () => {
    if (mode !== 'menu') return;
    applyAircraftChoice(aircraftSelect.value);
  });

  // ---- wiring -------------------------------------------------------------------------------
  startBtn.addEventListener('click', () => {
    enterImmersive();
    startFlight();
  });
  tutorialBtn.addEventListener('click', () => openSubpage(tutorialPage));
  const renderTutorialPage = (): void => {
    tutorialGrid.replaceChildren();
    TUTORIAL_CHAPTERS.forEach((chapter, i) => {
      const card = document.createElement('article');
      card.className = 'selection-card';
      const title = document.createElement('h3');
      title.textContent = `第 ${i + 1} 章　${chapter.title}${doneChapters.has(chapter.id) ? '　✓' : ''}`;
      const desc = document.createElement('p');
      desc.textContent = chapter.summary;
      const note = document.createElement('small');
      note.textContent = `${chapter.en} · ${chapterSteps(chapter, { afterburner: aircraft.hasAfterburner, touch: touchMode }).length} 個步驟`;
      const go = document.createElement('button');
      go.type = 'button';
      go.className = i === 0 ? 'primary' : 'ghost';
      go.textContent = doneChapters.has(chapter.id) ? '再練一次' : '開始本章';
      go.addEventListener('click', () => {
        enterImmersive();
        startTutorial(i);
      });
      card.append(title, desc, note, go);
      tutorialGrid.append(card);
    });
  };
  renderTutorialPage();
  $<HTMLButtonElement>('btn-resume').addEventListener('click', resumeFlight);
  $<HTMLButtonElement>('btn-restart-pause').addEventListener('click', startFlight);
  $<HTMLButtonElement>('btn-home-pause').addEventListener('click', goHome);
  $<HTMLButtonElement>('btn-restart-crash').addEventListener('click', startFlight);
  $<HTMLButtonElement>('btn-home-crash').addEventListener('click', goHome);

  // ---- free look: desktop uses Pointer Lock; touch keeps its dedicated gesture ----
  const canLook = (): boolean => mode === 'flying' || mode === 'crashed';
  stage.addEventListener('click', (event) => {
    if (touchMode || !canLook() || document.pointerLockElement === stage) return;
    if (event.target instanceof HTMLElement && event.target.closest('button, input, summary, a')) return;
    try {
      const request = stage.requestPointerLock();
      if (request && typeof request.catch === 'function') request.catch(() => {
        statusEl.textContent = '此瀏覽器未授予滑鼠鎖定；請使用支援 Pointer Lock 的桌面瀏覽器。';
      });
    } catch {
      statusEl.textContent = '此瀏覽器不支援滑鼠鎖定。';
    }
  });
  document.addEventListener('pointerlockchange', () => {
    document.body.dataset.pointerLocked = String(document.pointerLockElement === stage);
  });
  // touch: one finger on the scene turns the head; desktop never falls back to drag.
  let lookFinger = -1;
  let lookX = 0;
  let lookY = 0;
  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || !canLook() || lookFinger !== -1) return;
    lookFinger = e.pointerId;
    lookX = e.clientX;
    lookY = e.clientY;
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lookFinger) return;
    look.move(e.clientX - lookX, e.clientY - lookY, 0.004);
    lookX = e.clientX;
    lookY = e.clientY;
  });
  const endLook = (e: PointerEvent): void => {
    if (e.pointerId !== lookFinger) return;
    lookFinger = -1;
  };
  stage.addEventListener('pointerup', endLook);
  stage.addEventListener('pointercancel', endLook);
  window.addEventListener('mousemove', (e) => {
    if (!canLook() || document.pointerLockElement !== stage) return;
    look.move(e.movementX, e.movementY);
  });
  stage.addEventListener('wheel', (event) => {
    if (touchMode || !canLook()) return;
    event.preventDefault();
    rig.adjustZoom(event.deltaY);
  }, { passive: false });
  input.onRecenter = () => {
    tutorial.note('recenter');
    if (canLook()) look.recenter();
  };
  input.onSkip = () => {
    if (tutorialOn && mode === 'flying') tutorial.skip();
  };
  input.onReset = startFlight;
  input.onPause = () => {
    if (mode === 'flying') pauseFlight();
    else if (mode === 'paused') resumeFlight();
  };
  input.onConfirm = () => {
    if (tutorialOn && mode === 'flying' && tutorialView && (tutorialView.kind === 'read' || tutorialView.done)) advanceTutorial();
    else if (mode === 'menu' || mode === 'crashed') startFlight();
    else if (mode === 'paused') resumeFlight();
  };

  // ---- tutorial feeds: UI events and switch states -------------------------------------------
  window.addEventListener('cfs:waypoint', (e) => {
    const d = (e as CustomEvent<{ x: number; z: number; changed: boolean }>).detail;
    lastWaypoint = { x: d.x, z: d.z };
    tutorial.setWaypoint(lastWaypoint);
    if (d.changed) tutorial.note('waypoint');
  });
  window.addEventListener('cfs:panel-toggle', (e) => {
    const d = (e as CustomEvent<{ panel: 'map' | 'nav' | 'radar'; on: boolean }>).detail;
    setTutorialFlag(d.panel, d.on);
  });
  window.addEventListener('cfs:autopilot-state', (e) => {
    setTutorialFlag('autopilot', Boolean((e as CustomEvent<{ enabled?: boolean }>).detail?.enabled));
  });
  window.addEventListener('cfs:contact-select', () => tutorial.note('contact'));
  window.addEventListener('cfs:contact-focus', (e) => {
    if ((e as CustomEvent<{ focused: boolean }>).detail?.focused) tutorial.note('focus');
  });
  window.addEventListener('cfs:equipment-fire', () => tutorial.note('fire'));
  window.addEventListener('cfs:landing-site-select', () => tutorial.note('landing-site'));
  window.addEventListener('cfs:landing-approach-state', (e) => {
    setTutorialFlag('landingGuide', Boolean((e as CustomEvent<{ active?: boolean }>).detail?.active));
  });
  tutorialNextBtn.addEventListener('click', () => advanceTutorial());

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseFlight(); // the wall clock would otherwise run on without the sim
  });

  startBtn.disabled = false;
  tutorialBtn.disabled = false;
  startBtn.textContent = '起飛 / TAKE OFF';
  showOverlay('menu');
  setMode('menu');
  startBtn.focus({ preventScroll: true });

  // ---- main loop ----------------------------------------------------------------------------
  let shownThrottle = -1;
  let lastFrame = performance.now();
  let statFrames = 0;
  let statStart = lastFrame;
  let fps = 0;
  let bufW = 0;
  let bufH = 0;

  // The home scene keeps orbiting on its own; mouse position adds a soft parallax look offset.
  let attractPointerX = 0;
  let attractPointerY = 0;
  let attractPointerTargetX = 0;
  let attractPointerTargetY = 0;
  window.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse' || mode !== 'menu') return;
    attractPointerTargetX = Math.max(-1, Math.min(1, (event.clientX / Math.max(1, window.innerWidth) - 0.5) * 2));
    attractPointerTargetY = Math.max(-1, Math.min(1, (event.clientY / Math.max(1, window.innerHeight) - 0.5) * 2));
  });
  window.addEventListener('blur', () => {
    attractPointerTargetX = 0;
    attractPointerTargetY = 0;
  });

  const frame = (now: number): void => {
    requestAnimationFrame(frame);
    const frameMs = now - lastFrame;
    lastFrame = now;

    const scale = dynRes.update(frameMs);
    const dpr = Math.min(window.devicePixelRatio || 1, touchMode ? 1.5 : 2);
    const w = Math.max(1, Math.round(stage.clientWidth * dpr * scale));
    const h = Math.max(1, Math.round(stage.clientHeight * dpr * scale));
    if (w !== bufW || h !== bufH) {
      renderer.resize(w, h);
      bufW = w;
      bufH = h;
    }

    let snap: AircraftSnapshot | null = null;

    if (mode === 'menu' || mode === 'loading') {
      audio.silence();
      aircraftView?.setVisible(false);
      const pointerEase = 1 - Math.exp(-Math.min(frameMs, 100) / 180);
      attractPointerX += (attractPointerTargetX - attractPointerX) * pointerEase;
      attractPointerY += (attractPointerTargetY - attractPointerY) * pointerEase;
      renderer.render(attractCamera(now, attractPointerX, attractPointerY));
      hud.draw(null, aircraft, now);
    } else if (mode === 'paused') {
      // frozen picture: same snapshot, same camera as the moment of pausing
      snap = frozenSnap;
      aircraftView?.setVisible(true);
      if (rig.last) renderer.render(rig.last);
      aircraftView?.render(look.yaw, look.pitch, stage.clientWidth, stage.clientHeight, Math.min(frameMs / 1000, 0.1), rig.last?.fovY);
      hud.draw(snap, aircraft, now, rig.last?.fovY, look);
    } else {
      // flying or crashed: the simulation keeps running (the wreck just stops moving)
      if (touchMode) touch.update(Math.min(frameMs / 1000, 0.1));
      input.update(Math.min(frameMs / 1000, 0.1));
      const c = input.state;
      if (autopilot.enabled && lastSnap && mode === 'flying') {
        const attitude = attitudeFromQuat(lastSnap.orientation);
        const headingError = Math.atan2(
          Math.sin(autopilot.targetHeading - attitude.heading),
          Math.cos(autopilot.targetHeading - attitude.heading),
        );
        // Fictional simulator-level cruise hold: level wings, retain heading and altitude.
        c.pitch = Math.max(-0.32, Math.min(0.32,
          (autopilot.targetAltitude - lastSnap.altitude) * autopilot.altitudeGain - attitude.pitch * autopilot.pitchDamping - lastSnap.angularVelocity[2] * 0.24));
        c.roll = Math.max(-0.45, Math.min(0.45, -attitude.roll * autopilot.rollGain - lastSnap.angularVelocity[0] * 0.22));
        c.yaw = Math.max(-0.3, Math.min(0.3, headingError * autopilot.headingGain - lastSnap.angularVelocity[1] * autopilot.yawDamping));
        c.throttle = autopilot.throttle;
      }
      aircraftView?.setControls({ pitch: c.pitch, roll: c.roll, yaw: c.yaw, gear: visualGear, flaps: 0, canopy: visualCanopy });
      if (touchMode && Math.abs(c.throttle - shownThrottle) > 1e-3) {
        shownThrottle = c.throttle;
        touch.setThrottle(c.throttle);
      }
      if (
        mode === 'flying' &&
        (Math.abs(c.throttle - lastSent.throttle) > 1e-3 ||
          Math.abs(c.pitch - lastSent.pitch) > 1e-3 ||
          Math.abs(c.roll - lastSent.roll) > 1e-3 ||
          Math.abs(c.yaw - lastSent.yaw) > 1e-3)
      ) {
        physics.setControls(c);
        lastSent = { ...c };
      }

      snap = physics.sample(now) ?? lastSnap;
      if (snap) {
        lastSnap = snap;
        if (!snap.crashed && !snap.landed) {
          const kt = snap.airspeed * MS_TO_KT;
          stats.maxKt = Math.max(stats.maxKt, kt);
          stats.preCrashKt = kt;
          stats.maxG = Math.max(stats.maxG, snap.loadFactor);
          stats.minAlt = Math.min(stats.minAlt, snap.altitude);
        } else if (mode === 'flying') {
          autopilot.enabled = false;
          publishAutopilotState();
          setMode('crashed');
          crashedAtMs = now;
        }
        if (tutorialOn && mode === 'flying') {
          renderTutorial(tutorial.update(snap));
          if (look.active) tutorial.note('look');
        }
        audio.update(snap.crashed || snap.landed ? null : (activeWarnings(snap.warnMask)[0] ?? null), now);
        look.update(frameMs / 1000);
        const attitude = attitudeFromQuat(snap.orientation);
        cockpit.setFlightReadout(snap.altitude, snap.airspeed * MS_TO_KT, attitude.heading);
        const cam = rig.update(snap, aircraft, now, look);
        window.dispatchEvent(new CustomEvent('cfs:flight-snapshot', {
          detail: {
            x: snap.position[0],
            y: snap.altitude,
            z: snap.position[2],
            heading: attitude.heading,
            speed: snap.airspeed,
            verticalSpeed: snap.velocity[1],
            snapshot: snap,
            camera: cam,
          },
        }));
        aircraftView?.setVisible(true);
        renderer.render(cam);
        aircraftView?.render(look.yaw, look.pitch, stage.clientWidth, stage.clientHeight, Math.min(frameMs / 1000, 0.1), cam.fovY);
        hud.draw(snap, aircraft, now, cam.fovY, look);
        if (mode === 'crashed' && crashEl.hidden && !transitioning && now - crashedAtMs > CRASH_CARD_DELAY_MS) {
          showCrashCard(snap);
        }
      } else {
        hud.draw(null, aircraft, now);
      }
    }

    statFrames++;
    if (now - statStart >= 500) {
      fps = (statFrames * 1000) / (now - statStart);
      statFrames = 0;
      statStart = now;
      statusEl.textContent =
        `${renderer.backend.toUpperCase()}  ${fps.toFixed(0)} FPS  (${dynRes.smoothedFrameMs.toFixed(1)} ms)\n` +
        `render ${bufW}x${bufH} @ ${(scale * 100).toFixed(0)}%  draws ${renderer.stats.drawCalls}  inst ${renderer.stats.instances}\n` +
        `physics ${physics.measuredHz.toFixed(1)} Hz  t=${snap ? snap.time.toFixed(1) : '-'} s` +
        (fallbackLog.length ? `\nfallback: ${fallbackLog.join(' | ')}` : '') +
        (physics.lastError ? `\nphysics error: ${physics.lastError}` : '');
    }
  };
  requestAnimationFrame(frame);
}

boot().catch((e: unknown) => {
  console.error(e);
  fail(`啟動失敗：\n${e instanceof Error ? e.message : String(e)}`);
});
