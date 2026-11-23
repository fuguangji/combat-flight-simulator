import * as THREE from 'three';
import type { AircraftDefinition } from '../aircraft/registry';

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
  private readonly elements: Elements;
  private active = false;
  private dragging = false;
  private pointerX = 0;
  private pointerY = 0;
  private resizeObserver: ResizeObserver | null = null;
  private category: 'aircraft' | 'equipment' = 'aircraft';

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
      this.setCategory(elements.category.value === 'equipment' ? 'equipment' : 'aircraft');
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
    if (active) this.resize();
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

  private setCategory(category: 'aircraft' | 'equipment'): void {
    this.category = category;
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
    this.replaceModel(this.buildAircraft(item.id));
  }

  private showWeapon(item: WeaponDefinition, button: HTMLButtonElement): void {
    this.selectEntry(button);
    this.elements.title.textContent = item.name;
    this.elements.description.textContent = `${item.role}。 ${item.description} 模型採原創科幻能量艙外觀，只用於遊戲圖鑑與視覺展示，不模擬現實武器結構或導引。`;
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

  private wing(parent: THREE.Group, span: number, sweep: number, rear: number, color: number, side: 1 | -1): void {
    const shape = new THREE.Shape();
    shape.moveTo(1.05, 0);
    shape.lineTo(0.55 - sweep, side * span);
    shape.lineTo(-rear - sweep * 0.18, side * span * 0.96);
    shape.lineTo(-1.42, 0);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: 0.035, bevelThickness: 0.025 });
    geometry.rotateX(-Math.PI / 2);
    geometry.computeVertexNormals();
    this.mesh(geometry, this.material(color), parent, [0, -0.12, 0]);
  }

  private buildAircraft(id: number): THREE.Group {
    const group = new THREE.Group();
    const palette = [0x738d83, 0x8d9b92, 0x586d78, 0x536b78, 0x899c88, 0x59666b, 0x7d8c95, 0x596c75];
    const body = this.material(palette[id % palette.length], 0.72, 0.3);
    const wingColor = palette[(id + 2) % palette.length];
    const accent = this.material(0xb9d2c4, 0.8, 0.24);
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x4cae9b, metalness: 0.45, roughness: 0.12, transparent: true, opacity: 0.78, clearcoat: 1 });
    const twin = id % 4 === 0 || id === 5 || id === 8 || id === 14;
    const canard = id % 3 === 0 || id === 12;
    const twinTail = id % 4 === 1 || id === 5 || id === 9 || id === 14;
    const delta = id % 5 === 2 || id === 3 || id === 10;
    const span = 2.5 + (id % 5) * 0.25;
    const sweep = delta ? 1.35 : 0.35 + (id % 4) * 0.18;
    const rear = delta ? 1.8 : 0.95 + (id % 3) * 0.2;

    // Main fuselage, nose and rear fairing.
    const fuselage = this.mesh(new THREE.CylinderGeometry(0.27, 0.39, 6.2, 20, 1), body, group, [0, 0, 0]);
    fuselage.rotation.z = -Math.PI / 2;
    const nose = this.mesh(new THREE.ConeGeometry(0.27, 1.35, 20), accent, group, [3.72, 0, 0]);
    nose.rotation.z = -Math.PI / 2;
    const tailCone = this.mesh(new THREE.ConeGeometry(0.31, 0.95, 20), body, group, [-3.45, 0, 0]);
    tailCone.rotation.z = Math.PI / 2;

    this.wing(group, span, sweep, rear, wingColor, 1);
    this.wing(group, span, sweep, rear, wingColor, -1);

    if (canard) {
      this.wing(group, 1.1, 0.18, 0.42, 0x9aafa3, 1);
      this.wing(group, 1.1, 0.18, 0.42, 0x9aafa3, -1);
      group.children.slice(-2).forEach((part) => { part.position.x = 1.65; part.scale.set(0.52, 1, 0.62); });
    }

    const canopy = this.mesh(new THREE.SphereGeometry(1, 20, 14), glass, group, [0.95, 0.3, 0]);
    canopy.scale.set(1.18, 0.37, 0.47);

    const finShape = new THREE.Shape();
    finShape.moveTo(-2.5, 0.18); finShape.lineTo(-1.2, 1.5); finShape.lineTo(-0.75, 1.42); finShape.lineTo(-0.85, 0.12); finShape.closePath();
    const finGeo = new THREE.ShapeGeometry(finShape);
    this.mesh(finGeo, body, group, [0, 0.15, twinTail ? 0.48 : 0]);
    if (twinTail) {
      const second = this.mesh(finGeo.clone(), body, group, [0, 0.15, -0.48]);
      second.rotation.y = Math.PI;
    }

    const engineCount = twin ? 2 : 1;
    for (let i = 0; i < engineCount; i++) {
      const z = twin ? (i === 0 ? -0.48 : 0.48) : 0;
      const nozzle = this.mesh(new THREE.CylinderGeometry(0.19, 0.24, 0.8, 16), this.material(0x273c3a, 0.9, 0.24), group, [-2.75, -0.02, z]);
      nozzle.rotation.z = Math.PI / 2;
      const inner = this.mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.035, 16), this.material(0x6a9d8c, 0.5, 0.3), group, [-3.17, -0.02, z]);
      inner.rotation.z = Math.PI / 2;
    }
    const stripe = this.mesh(new THREE.BoxGeometry(1.05, 0.025, 0.04), accent, group, [-0.35, 0.27, 0]);
    stripe.rotation.z = -0.02;
    group.scale.setScalar(1.05);
    return group;
  }

  private buildEnergyPod(colorText: string, id: string): THREE.Group {
    const group = new THREE.Group();
    const color = Number.parseInt(colorText.replace('#', ''), 16) || 0x73e8ca;
    const shell = this.material(0x637b78, 0.78, 0.26);
    const glow = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.8, metalness: 0.3, roughness: 0.2 });
    const core = this.mesh(new THREE.CylinderGeometry(0.38, 0.38, 3.15, 24), shell, group, [0, 0, 0]);
    core.rotation.z = -Math.PI / 2;
    const nose = this.mesh(new THREE.SphereGeometry(0.39, 20, 12), glow, group, [1.62, 0, 0]);
    nose.scale.set(1.2, 0.8, 0.8);
    const rear = this.mesh(new THREE.CylinderGeometry(0.31, 0.34, 0.42, 20), this.material(0x263a39), group, [-1.78, 0, 0]);
    rear.rotation.z = -Math.PI / 2;
    for (const x of [-0.85, 0.05, 0.95]) {
      const ring = this.mesh(new THREE.TorusGeometry(0.405, 0.045, 8, 24), glow, group, [x, 0, 0]);
      ring.rotation.y = Math.PI / 2;
    }
    const band = this.mesh(new THREE.BoxGeometry(0.48, 0.055, 0.055), glow, group, [-0.42, 0.39, 0]);
    band.rotation.z = 0.15;
    group.userData.catalogId = id;
    return group;
  }
}
