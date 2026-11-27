import * as THREE from 'three';
import type { AircraftDefinition } from '../aircraft/registry';
import type { Anchor } from './modelKit';
import { buildWeaponModel, weaponAnchors } from './weaponModels';
import { createModularAircraft, createProceduralAircraftConfig, type AircraftVisualInput } from '../aircraft/builder/modularAircraft';

type WeaponDefinition = {
  id: string;
  name: string;
  category: string;
  role: string;
  description: string;
  effect: string;
  capacity: number;
  cooldown: number;
  color: string;
  life: number;
};

type Elements = {
  canvas: HTMLCanvasElement;
  list: HTMLElement;
  title: HTMLElement;
  description: HTMLElement;
  specs: HTMLElement;
  category: HTMLSelectElement;
  /** Optional: SVG chart and part chips under the model. */
  chart?: HTMLElement | null;
  parts?: HTMLElement | null;
};

/**
 * Self-contained procedural 3D encyclopedia viewer.
 * Aircraft and equipment are original game models (see aircraftModels.ts / weaponModels.ts);
 * none of them copies or approximates a real aircraft or weapon.
 */
export class EncyclopediaViewer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);
  private readonly root = new THREE.Group();
  private readonly aircraft: AircraftDefinition[];
  private readonly weapons: WeaponDefinition[];
  private readonly visualConfigs: Record<string, unknown> = import.meta.glob('../aircraft/visuals/*.json', { eager: true, import: 'default' });
  private readonly elements: Elements;
  private active = false;
  private resizeObserver: ResizeObserver | null = null;
  private dragging = false;
  private pointerX = 0;
  private pointerY = 0;

  constructor(elements: Elements, aircraft: AircraftDefinition[], weapons: WeaponDefinition[]) {
    this.elements = elements;
    this.aircraft = aircraft;
    this.weapons = weapons;
    this.renderer = new THREE.WebGLRenderer({ canvas: elements.canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.scene.background = new THREE.Color(0x07110f);
    this.scene.add(new THREE.HemisphereLight(0xc9f5dc, 0x101a20, 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 3.1);
    key.position.set(7, 10, 8);
    this.scene.add(key);
    const rim = new THREE.PointLight(0x65e6b0, 28, 32);
    rim.position.set(-5, 2, -6);
    this.scene.add(rim);
    const floor = new THREE.GridHelper(24, 24, 0x315347, 0x172b25);
    floor.position.y = -1.5;
    this.scene.add(floor);
    this.scene.add(this.root);
    this.camera.position.set(8.5, 6.3, 9.5);
    this.camera.lookAt(0, 0, 0);

    elements.category.addEventListener('change', () => {
      this.setCategory(elements.category.value === 'missiles' ? 'missiles' : elements.category.value === 'equipment' ? 'equipment' : 'aircraft');
    });
    elements.canvas.addEventListener('pointerdown', (event) => {
      this.dragging = true;
      this.pointerX = event.clientX;
      this.pointerY = event.clientY;
      elements.canvas.setPointerCapture(event.pointerId);
    });
    elements.canvas.addEventListener('pointermove', (event) => {
      if (!this.dragging) return;
      const dx = event.clientX - this.pointerX;
      const dy = event.clientY - this.pointerY;
      this.pointerX = event.clientX;
      this.pointerY = event.clientY;
      this.root.rotation.y += dx * 0.009;
      this.root.rotation.x = THREE.MathUtils.clamp(this.root.rotation.x + dy * 0.006, -0.9, 0.9);
    });
    const stopDrag = (): void => { this.dragging = false; };
    elements.canvas.addEventListener('pointerup', stopDrag);
    elements.canvas.addEventListener('pointercancel', stopDrag);
    elements.canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.camera.position.multiplyScalar(event.deltaY > 0 ? 1.08 : 0.93);
      this.camera.position.clampLength(6, 22);
      this.camera.lookAt(0, 0, 0);
    }, { passive: false });

    const host = elements.canvas.parentElement;
    if (host) {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(host);
    }
    this.setCategory('aircraft');
    this.animate();
  }

  setActive(active: boolean): void {
    this.active = active;
    if (active) {
      const host = this.elements.canvas.parentElement;
      if (host) this.resizeObserver?.observe(host);
      this.resize();
    }
  }

  private resize(): void {
    const host = this.elements.canvas.parentElement;
    if (!host) return;
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    if (!this.active) return;
    this.renderer.render(this.scene, this.camera);
  };

  private setCategory(category: 'aircraft' | 'equipment' | 'missiles'): void {
    this.elements.category.value = category;
    this.elements.list.replaceChildren();
    if (category === 'aircraft') {
      this.aircraft.forEach((item, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'encyclopedia-entry';
        button.textContent = `${String(index + 1).padStart(2, '0')}  ${item.displayName}`;
        button.addEventListener('click', () => this.showAircraft(item, button));
        this.elements.list.append(button);
      });
      const first = this.elements.list.querySelector<HTMLButtonElement>('button');
      if (first && this.aircraft[0]) this.showAircraft(this.aircraft[0], first);
    } else if (category === 'equipment') {
      this.weapons.forEach((item, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'encyclopedia-entry';
        button.textContent = `${String(index + 1).padStart(2, '0')}  ${item.name}`;
        button.addEventListener('click', () => this.showWeapon(item, button));
        this.elements.list.append(button);
      });
      const first = this.elements.list.querySelector<HTMLButtonElement>('button');
      if (first && this.weapons[0]) this.showWeapon(this.weapons[0], first);
    } else {
      this.weapons.forEach((item, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'encyclopedia-entry';
        button.textContent = `${String(index + 1).padStart(2, '0')}  ${item.name}`;
        button.addEventListener('click', () => this.showWeapon(item, button));
        this.elements.list.append(button);
      });
      const first = this.elements.list.querySelector<HTMLButtonElement>('button');
      if (first && this.weapons[0]) this.showWeapon(this.weapons[0], first);
    }
  }

  private selectEntry(button: HTMLButtonElement): void {
    this.elements.list.querySelectorAll('.encyclopedia-entry').forEach((entry) => entry.classList.remove('selected'));
    button.classList.add('selected');
  }

  private replaceModel(model: THREE.Group): void {
    for (const child of [...this.root.children]) {
      if (child.userData.shared) continue; // kit geometry / materials are reused by the next instance
      child.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose();
        if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose());
        else mesh.material?.dispose();
      });
    }
    this.root.clear();
    this.root.add(model);
    this.root.rotation.set(-0.12, -0.45, 0);
  }

  private showAircraft(item: AircraftDefinition, button: HTMLButtonElement): void {
    this.selectEntry(button);
    this.elements.title.textContent = item.displayName;
    this.elements.description.textContent = `${item.role}。 ${item.description} ${item.features ? `設計特色：${item.features}。` : ''}本模型為本作原創程序化外觀，並非真實機型的工程複刻。`;
    const s = item.specs;
    this.elements.specs.textContent = [
      `空重 ${s.emptyMassKg.toLocaleString()} kg`,
      `最大起飛重量 ${s.mtowKg.toLocaleString()} kg`,
      `載荷 ${s.payloadKg.toLocaleString()} kg`,
      `燃油 ${s.fuelKg.toLocaleString()} kg`,
      `推力 ${s.thrustKN} kN`,
      `巡航油耗 ${s.cruiseBurnKgMin} kg/min`,
      `高推力油耗 ${s.boostBurnKgMin} kg/min`,
      `最大 Mach ${item.maxMach}`,
      `G 限制 +${s.gPositive} / ${s.gNegative}`,
      `升限 ${s.ceilingM.toLocaleString()} m`,
      `作戰半徑 ${s.rangeKm.toLocaleString()} km`,
    ].join('　·　');
    this.replaceModel(this.buildAircraft(item));
    if (this.elements.chart) this.elements.chart.innerHTML = this.aircraftChart(item);
    this.showParts([]);
  }

  private showWeapon(item: WeaponDefinition, button: HTMLButtonElement): void {
    this.selectEntry(button);
    this.elements.title.textContent = item.name;
    this.elements.description.textContent = `${item.role}。 ${item.description} 模型為本作原創的虛構外觀，只用於遊戲圖鑑與視覺展示，不對應任何現實裝備，也不模擬真實結構或導引。`;
    this.elements.specs.textContent = [
      item.category,
      `視覺效果 ${item.effect}`,
      `展示額度 ${item.capacity}`,
      `冷卻 ${item.cooldown.toFixed(1)} s`,
      `演出時間 ${item.life.toFixed(2)} s`,
    ].join('　·　');
    this.replaceModel(buildWeaponModel(item.id, item.color));
    if (this.elements.chart) this.elements.chart.innerHTML = this.weaponChart(item);
    this.showParts(weaponAnchors(item.id, item.color));
  }

  /** Public factory so the encyclopedia and live scene use the exact same geometry. */
  createAircraftModel(id: number): THREE.Group {
    const item = this.aircraft.find((aircraft) => aircraft.id === id) ?? this.aircraft[0];
    if (!item) throw new Error('No aircraft is registered');
    return this.buildAircraft(item);
  }

  private buildAircraft(item: AircraftDefinition): THREE.Group {
    const visualPath = Object.keys(this.visualConfigs).find((path) => path.endsWith(`/${item.key}.json`));
    const custom = visualPath ? this.visualConfigs[visualPath] as AircraftVisualInput : undefined;
    let model: THREE.Group;
    if (custom) {
      try {
        // The editor exports this exact schema. The builder also migrates legacy v1 assets.
        model = createModularAircraft(custom);
        model.userData.visualSource = visualPath;
        model.userData.visualSchemaVersion = custom.version;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        // A broken optional art asset must never prevent the aircraft/game UI from starting.
        console.warn(`[AircraftVisual] ${item.key} 視覺資料載入失敗，已使用程序模型：${reason}`);
        model = createModularAircraft(createProceduralAircraftConfig(item.id));
        model.userData.visualLoadError = reason;
        model.userData.visualSource = 'procedural-fallback';
      }
    } else {
      model = createModularAircraft(createProceduralAircraftConfig(item.id));
      model.userData.visualSource = 'procedural-fallback';
    }
    model.scale.setScalar(1.05);
    model.userData.aircraftKey = item.key;
    return model;
  }

  private showParts(anchors: Anchor[]): void {
    const host = this.elements.parts;
    if (!host) return;
    host.replaceChildren();
    for (const a of anchors) {
      const chip = document.createElement('span');
      chip.className = 'encyclopedia-chip';
      chip.textContent = `${a.label} · ${a.en}`;
      host.append(chip);
    }
  }

  /** Radar chart of six normalised aircraft ratings (relative to the fleet maximum). */
  private aircraftChart(item: AircraftDefinition): string {
    const axes: Array<[string, (a: AircraftDefinition) => number]> = [
      ['速度', (a) => a.maxMach],
      ['機動', (a) => a.specs.gPositive],
      ['航程', (a) => a.specs.rangeKm],
      ['載荷', (a) => a.specs.payloadKg],
      ['升限', (a) => a.specs.ceilingM],
      ['推力', (a) => a.specs.thrustKN],
    ];
    const max = axes.map(([, f]) => Math.max(...this.aircraft.map(f), 1e-9));
    const cx = 110, cy = 100, R = 72;
    const pt = (i: number, v: number): string => {
      const a = -Math.PI / 2 + (i / axes.length) * Math.PI * 2;
      return `${(cx + Math.cos(a) * R * v).toFixed(1)},${(cy + Math.sin(a) * R * v).toFixed(1)}`;
    };
    const rings = [0.25, 0.5, 0.75, 1].map((k) => `<polygon points="${axes.map((_, i) => pt(i, k)).join(' ')}" fill="none" stroke="#2c4a3d" stroke-width="1"/>`).join('');
    const spokes = axes.map((_, i) => `<line x1="${cx}" y1="${cy}" x2="${pt(i, 1).split(',')[0]}" y2="${pt(i, 1).split(',')[1]}" stroke="#2c4a3d"/>`).join('');
    const values = axes.map(([, f], i) => Math.max(0.04, f(item) / max[i]));
    const shape = `<polygon points="${values.map((v, i) => pt(i, v)).join(' ')}" fill="rgba(125,255,154,.22)" stroke="#8affb1" stroke-width="2"/>`;
    const labels = axes.map(([name], i) => {
      const [x, y] = pt(i, 1.2).split(',');
      return `<text x="${x}" y="${y}" fill="#a9d1b7" font-size="10" text-anchor="middle" dominant-baseline="middle">${name}</text>`;
    }).join('');
    return `<svg viewBox="0 0 220 200" role="img" aria-label="${item.displayName} 能力雷達圖">${rings}${spokes}${shape}${labels}</svg>`;
  }

  /** Horizontal bars comparing a store with the rest of the catalogue. */
  private weaponChart(item: WeaponDefinition): string {
    const rows: Array<[string, number, number, string]> = [
      ['展示額度', item.capacity, Math.max(...this.weapons.map((w) => w.capacity)), `${item.capacity}`],
      ['回復速度', 1 / item.cooldown, Math.max(...this.weapons.map((w) => 1 / w.cooldown)), `${item.cooldown.toFixed(1)} s`],
      ['演出長度', item.life, Math.max(...this.weapons.map((w) => w.life)), `${item.life.toFixed(2)} s`],
    ];
    const bars = rows.map(([name, v, m, label], i) => {
      const y = 22 + i * 44;
      const w = Math.max(6, (v / m) * 150);
      return `<text x="4" y="${y}" fill="#a9d1b7" font-size="10">${name}</text><rect x="4" y="${y + 6}" width="150" height="10" rx="3" fill="#10241b"/><rect x="4" y="${y + 6}" width="${w.toFixed(1)}" height="10" rx="3" fill="${item.color}"/><text x="160" y="${y + 15}" fill="#d9ffe4" font-size="10">${label}</text>`;
    }).join('');
    return `<svg viewBox="0 0 220 160" role="img" aria-label="${item.name} 比較條">${bars}</svg>`;
  }
}
