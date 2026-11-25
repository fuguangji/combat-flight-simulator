import * as THREE from 'three';
import type { AircraftDefinition } from '../aircraft/registry';
import { createModularAircraft, createProceduralAircraftConfig, type AircraftVisualConfig } from '../aircraft/builder/modularAircraft';

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
};

/**
 * Self-contained procedural 3D encyclopedia viewer.
 * Aircraft are original game silhouettes; equipment is represented as fictional
 * energy-pod props, not functional or dimensionally accurate real-world weapons.
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
  }

  private showWeapon(item: WeaponDefinition, button: HTMLButtonElement): void {
    this.selectEntry(button);
    this.elements.title.textContent = item.name;
    this.elements.description.textContent = `${item.role}。 ${item.description} 模型採原創科幻能量彈體外觀，具有發光錐形端部、分段外殼與能量環，只用於遊戲圖鑑展示，不模擬現實飛彈結構、導引或推進系統。`;
    this.elements.specs.textContent = [
      item.category,
      `視覺效果 ${item.effect}`,
      `展示額度 ${item.capacity}`,
      `冷卻 ${item.cooldown.toFixed(1)} s`,
      `演出時間 ${item.life.toFixed(2)} s`,
    ].join('　·　');
    this.replaceModel(this.buildEnergyPod(item.color, item.id));
  }

  private material(color: number, metalness = 0.62, roughness = 0.32): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, metalness, roughness });
  }

  private mesh(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Group, position?: [number, number, number]): THREE.Mesh {
    const object = new THREE.Mesh(geometry, material);
    if (position) object.position.set(...position);
    object.castShadow = true;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  }

  /** Public factory so the encyclopedia and live scene use the exact same geometry. */
  createAircraftModel(id: number): THREE.Group {
    const item = this.aircraft.find((aircraft) => aircraft.id === id) ?? this.aircraft[0];
    if (!item) throw new Error('No aircraft is registered');
    return this.buildAircraft(item);
  }

  private buildAircraft(item: AircraftDefinition): THREE.Group {
    const visualPath = Object.keys(this.visualConfigs).find((path) => path.endsWith(`/${item.key}.json`));
    const custom = visualPath ? this.visualConfigs[visualPath] as AircraftVisualConfig : undefined;
    const model = createModularAircraft(custom ?? createProceduralAircraftConfig(item.id));
    model.scale.setScalar(1.05);
    model.userData.aircraftKey = item.key;
    return model;
  }

  private buildEnergyPod(colorText: string, id: string): THREE.Group {
    const group = new THREE.Group();
    const color = Number.parseInt(colorText.replace('#', ''), 16) || 0x73e8ca;
    const shell = this.material(0x637b78, 0.78, 0.26);
    const glow = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.8, metalness: 0.3, roughness: 0.2 });
    const core = this.mesh(new THREE.CylinderGeometry(0.38, 0.38, 3.15, 24), shell, group, [0, 0, 0]);
    core.rotation.z = -Math.PI / 2;
    const tip = this.mesh(new THREE.ConeGeometry(0.34, 0.82, 20), glow, group, [1.96, 0, 0]);
    tip.rotation.z = -Math.PI / 2;
    this.mesh(new THREE.SphereGeometry(0.27, 16, 10), glow, group, [-2.02, 0, 0]).scale.set(1.2, 0.9, 0.9);
    const rear = this.mesh(new THREE.CylinderGeometry(0.31, 0.34, 0.42, 20), this.material(0x263a39), group, [-1.78, 0, 0]);
    rear.rotation.z = -Math.PI / 2;
    for (const x of [-0.85, 0.05, 0.95]) {
      const ring = this.mesh(new THREE.TorusGeometry(0.405, 0.045, 8, 24), glow, group, [x, 0, 0]);
      ring.rotation.y = Math.PI / 2;
    }
    this.mesh(new THREE.BoxGeometry(0.48, 0.055, 0.055), glow, group, [-0.42, 0.39, 0]).rotation.z = 0.15;
    group.userData.catalogId = id;
    return group;
  }
}
