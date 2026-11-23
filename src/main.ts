import './ui/style.css';
import { aircraftRegistry, type AircraftDefinition } from './aircraft/registry';
import { detectCapabilities } from './core/capabilities';
import { CameraRig, attitudeFromQuat } from './cockpit/camera';
import { mountCockpitShell } from './cockpit/cockpitShell';
import { NavigationDisplay } from './navigation/navigation';
import { Hud } from './cockpit/hud';
import { PhysicsClient, type ControlInput } from './physics/PhysicsClient';
import { CRASH_BUILDING, type AircraftSnapshot } from './physics/stateLayout';
import { DynamicResolution } from './rendering/dynamicResolution';
import { createRenderer } from './rendering/createRenderer';
import type { Backend } from './rendering/Renderer';
import { activeWarnings } from './physics/warnings';
import { attractCamera } from './ui/attract';
import { WarningAudio } from './ui/audio';
import { TUTORIAL_STEPS, Tutorial } from './ui/tutorial';
import { FreeLook } from './ui/look';
import { TouchControls, isTouchDevice } from './ui/touch';
import { KeyboardControls } from './ui/input';

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
  const hangarGrid = $<HTMLDivElement>('hangar-grid');
  const equipmentGrid = $<HTMLDivElement>('equipment-grid');
  const menuPanel = menuEl.querySelector('.panel') as HTMLDivElement;
  const equipmentOptions = [
    { id: 'pulse', name: 'PULSE 脈衝彈', desc: '短促、明亮的直線光效。', note: '快速視覺回饋 · 8 次展示額度' },
    { id: 'arc', name: 'ARC 電弧彈', desc: '帶有分岔電弧的特殊效果。', note: '電弧視覺 · 5 次展示額度' },
    { id: 'prism', name: 'PRISM 稜鏡彈', desc: '幾何稜鏡形狀與折射光感。', note: '稜鏡視覺 · 3 次展示額度' },
    { id: 'nova', name: 'NOVA 星爆彈', desc: '較大的環形脈衝與短暫光暈。', note: '環形視覺 · 4 次展示額度' },
    { id: 'lumen', name: 'LUMEN 光幕彈', desc: '柔和的多層光幕與粒子拖尾。', note: '光幕視覺 · 6 次展示額度' },
  ] as const;
  let selectedEquipment = (() => {
    try { return localStorage.getItem('cfs.equipment') ?? 'pulse'; } catch { return 'pulse'; }
  })();
  const openSubpage = (page: HTMLElement): void => {
    hangarPage.hidden = page !== hangarPage;
    equipmentPage.hidden = page !== equipmentPage;
    menuPanel.classList.add('subpage-open');
  };
  const closeSubpage = (): void => {
    hangarPage.hidden = true;
    equipmentPage.hidden = true;
    menuPanel.classList.remove('subpage-open');
  };
  const applyAircraftChoice = (key: string): void => {
    const next = aircraftRegistry.find(key);
    if (!next || next === aircraft) return;
    aircraft = next;
    aircraftSelect.value = aircraft.key;
    physics.setAircraft(aircraft.toPhysicsArray());
    physics.pause();
    input.reset(aircraft.startThrottle);
    showAircraft();
    try { localStorage.setItem('cfs.aircraft', aircraft.key); } catch { /* storage optional */ }
    renderHangar();
  };
  const renderHangar = (): void => {
    hangarGrid.replaceChildren();
    for (const a of aircraftRegistry.list()) {
      const card = document.createElement('article');
      card.className = 'selection-card';
      const title = document.createElement('h3');
      title.textContent = a.displayName;
      const desc = document.createElement('p');
      desc.textContent = `${a.role} / ${a.description} ${a.features ? `特色：${a.features}` : ''}`;
      const specs = document.createElement('small');
      specs.textContent = `空重 ${a.specs.emptyMassKg.toLocaleString()} kg · MTOW ${a.specs.mtowKg.toLocaleString()} kg · 載荷 ${a.specs.payloadKg.toLocaleString()} kg · 燃油 ${a.specs.fuelKg.toLocaleString()} kg · 推力 ${a.specs.thrustKN} kN · 最大 M ${a.maxMach} · G +${a.specs.gPositive}/ ${a.specs.gNegative} · 升限 ${a.specs.ceilingM.toLocaleString()} m · 半徑 ${a.specs.rangeKm.toLocaleString()} km`;
      const select = document.createElement('button');
      select.type = 'button';
      select.className = a.key === aircraft.key ? 'primary' : 'ghost';
      select.textContent = a.key === aircraft.key ? '目前使用中' : '選擇此機型';
      select.addEventListener('click', () => { applyAircraftChoice(a.key); });
      card.append(title, desc, specs, select);
      hangarGrid.append(card);
    }
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
  physics.pause(); // the sim only runs while a flight is in progress

  $<HTMLElement>('spec-backend').textContent = renderer.backend === 'webgpu' ? 'WebGPU' : 'WebGL 2';

  const hud = new Hud(hudCanvas);
  const input = new KeyboardControls(aircraft.startThrottle);
  const dynRes = new DynamicResolution();
  const rig = new CameraRig();
  const audio = new WarningAudio();
  const look = new FreeLook();
  const cockpit = mountCockpitShell();
  new NavigationDisplay();
  window.addEventListener('cfs:look-recenter', () => look.recenter());
  const touchMode = isTouchDevice();
  document.body.classList.toggle('touch', touchMode);
  const touch = new TouchControls(document.body);
  touch.show(true); // visibility is driven by body[data-mode] in CSS
  hud.compact = touchMode;
  if (touchMode) {
    input.touch = touch.axes;
    touch.onThrottle = (v) => input.setThrottle(v);
    touch.onRecenter = () => look.recenter();
    touch.onPause = () => pauseFlight();
    tutorialEl.style.pointerEvents = 'auto';
    $<HTMLElement>('tutorial-skip').textContent = '點此略過';
    tutorialEl.addEventListener('click', () => {
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
  let tutorial = new Tutorial();
  let tutorialOn = false;
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
    physics.reset();
    autopilot.enabled = false;
    publishAutopilotState();
    input.reset(aircraft.startThrottle);
    lastSent = { ...input.state, throttle: -1 };
    rig.reset();
    look.reset();
    touch.reset();
    tutorial = new Tutorial(aircraft.hasAfterburner ? TUTORIAL_STEPS : TUTORIAL_STEPS.filter((st) => st.id !== 'afterburner'));
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
  };

  const startFlight = (): void => {
    if (mode !== 'menu' && mode !== 'paused' && mode !== 'crashed') return;
    if (mode === 'menu') tutorialOn = false; // restarts keep the current mode; the menu button picks it
    void withFade(beginFlight);
  };

  const startTutorial = (): void => {
    if (mode !== 'menu') return;
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
    crashTitleEl.textContent = building ? '撞上建築物' : '墜地';
    const row = (k: string, v: string): string => `<dt>${k}</dt><dd>${v}</dd>`;
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
  tutorialBtn.addEventListener('click', () => {
    enterImmersive();
    startTutorial();
  });
  $<HTMLButtonElement>('btn-resume').addEventListener('click', resumeFlight);
  $<HTMLButtonElement>('btn-restart-pause').addEventListener('click', startFlight);
  $<HTMLButtonElement>('btn-home-pause').addEventListener('click', goHome);
  $<HTMLButtonElement>('btn-restart-crash').addEventListener('click', startFlight);
  $<HTMLButtonElement>('btn-home-crash').addEventListener('click', goHome);

  // ---- free look: mouse turns the head only; the flight controls stay on the keyboard / nose ----
  let dragging = false;
  const canLook = (): boolean => mode === 'flying' || mode === 'crashed';
  stage.addEventListener('mousedown', (e) => {
    if (e.button === 1) {
      e.preventDefault();
      look.recenter();
    } else if (e.button === 0 && canLook()) {
      dragging = true;
    }
  });
  // touch: one finger on the scene turns the head; lifting it looks ahead again
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
  window.addEventListener('mouseup', () => {
    dragging = false; // releasing the drag preserves the pilot's head direction
  });
  window.addEventListener('mousemove', (e) => {
    if (!canLook()) return;
    if (dragging) look.move(e.movementX, e.movementY);
  });
  input.onRecenter = () => {
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
    if (mode === 'menu' || mode === 'crashed') startFlight();
    else if (mode === 'paused') resumeFlight();
  };

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
      renderer.render(attractCamera(now));
      hud.draw(null, aircraft, now);
    } else if (mode === 'paused') {
      // frozen picture: same snapshot, same camera as the moment of pausing
      snap = frozenSnap;
      if (rig.last) renderer.render(rig.last);
      hud.draw(snap, aircraft, now, rig.last?.fovY, look);
    } else {
      // flying or crashed: the simulation keeps running (the wreck just stops moving)
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
        if (!snap.crashed) {
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
          const v = tutorial.update(snap);
          tutorialStepEl.textContent = v.done ? '完成' : `${v.index + 1} / ${v.total}`;
          tutorialTitleEl.textContent = v.title;
          tutorialHintEl.textContent = v.hint;
          tutorialBarEl.style.width = `${(v.progress * 100).toFixed(0)}%`;
          tutorialCautionEl.hidden = v.caution === null;
          if (v.caution) tutorialCautionEl.textContent = v.caution;
        }
        audio.update(snap.crashed ? null : (activeWarnings(snap.warnMask)[0] ?? null), now);
        look.update(frameMs / 1000);
        cockpit.setHeadPose(look.yaw, look.pitch);
        const attitude = attitudeFromQuat(snap.orientation);
        cockpit.setFlightReadout(snap.altitude, snap.airspeed * MS_TO_KT, attitude.heading);
        window.dispatchEvent(new CustomEvent('cfs:flight-snapshot', { detail: { x: snap.position[0], y: snap.altitude, z: snap.position[2], heading: attitude.heading, speed: snap.airspeed } }));
        const cam = rig.update(snap, aircraft, now, look);
        renderer.render(cam);
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
