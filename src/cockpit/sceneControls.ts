import * as THREE from 'three';

type Control = {
  label: string;
  action: () => void;
  hold?: { down: string; up: string };
};

const click = (selector: string): void => {
  document.querySelector<HTMLElement>(selector)?.click();
};

export class CockpitSceneControls {
  private readonly canvas = document.createElement('canvas');
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(48, 1, 0.05, 20);
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly hitTargets: THREE.Mesh[] = [];
  private readonly held = new Map<number, string>();
  private readonly resizeObserver: ResizeObserver;
  private disposed = false;

  constructor(private readonly host: HTMLElement) {
    this.canvas.id = 'cfs-3d-cockpit-controls';
    Object.assign(this.canvas.style, {
      position: 'fixed', inset: '0', width: '100%', height: '100%',
      zIndex: '9', pointerEvents: 'none', display: 'none',
    });
    document.body.append(this.canvas);
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, alpha: true, antialias: false, powerPreference: 'low-power',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene.add(new THREE.HemisphereLight(0xe2f5e9, 0x101b16, 1.8));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-2, 4, 3);
    this.scene.add(key);

    this.camera.position.set(0, 0, 0);
    this.scene.add(this.camera);
    this.buildPanel();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(document.documentElement);
    window.addEventListener('resize', this.resize);
    this.host.addEventListener('pointerdown', this.onPointerDown, true);
    this.host.addEventListener('pointerup', this.onPointerUp, true);
    this.host.addEventListener('pointercancel', this.onPointerUp, true);
    this.host.addEventListener('mousedown', this.onMouseDown, true);
    this.host.addEventListener('mouseup', this.onMouseUp, true);

    const style = document.createElement('style');
    style.dataset.cfs3dControls = 'true';
    style.textContent = `
      body[data-mode="flying"] #cfs-3d-cockpit-controls,
      body[data-mode="crashed"] #cfs-3d-cockpit-controls { display:block !important; }
      body[data-mode="flying"] #cockpit-shell .cockpit-switches button,
      body[data-mode="flying"] #cockpit-shell .cockpit-config summary,
      body[data-mode="flying"] #cockpit-dashboard button,
      body[data-mode="flying"] #contact-status button,
      body[data-mode="flying"] #navigation-display button,
      body[data-mode="flying"] #touch,
      body[data-mode="crashed"] #cockpit-shell .cockpit-switches button,
      body[data-mode="crashed"] #cockpit-shell .cockpit-config summary,
      body[data-mode="crashed"] #cockpit-dashboard button,
      body[data-mode="crashed"] #contact-status button,
      body[data-mode="crashed"] #navigation-display button,
      body[data-mode="crashed"] #touch { display:none !important; }
      #cfs-3d-cockpit-controls { touch-action:none; }
    `;
    document.head.append(style);
    this.resize();
    this.render();
  }

  private buildPanel(): void {
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(1.72, 0.76, 0.075),
      new THREE.MeshStandardMaterial({ color: 0x101c17, metalness: 0.72, roughness: 0.38 }),
    );
    board.position.set(0, -0.30, -1.42);
    this.camera.add(board);

    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(1.68, 0.018, 0.012),
      new THREE.MeshBasicMaterial({ color: 0x78d99a }),
    );
    trim.position.set(0, 0.075, -1.465);
    this.camera.add(trim);

    const controls: Control[] = [
      { label: 'PAUSE', action: () => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' })); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape' })); } },
      { label: 'LOOK CENTER', action: () => window.dispatchEvent(new Event('cfs:look-recenter')) },
      { label: 'AUTOPILOT', action: () => window.dispatchEvent(new Event('cfs:autopilot-toggle')) },
      { label: 'GEAR', action: () => window.dispatchEvent(new Event('cfs:gear-toggle')) },
      { label: 'CANOPY', action: () => window.dispatchEvent(new Event('cfs:canopy-toggle')) },
      { label: 'STORES', action: () => click('#cockpit-dashboard [data-fire]') },
      { label: 'MISSILE', action: () => window.dispatchEvent(new Event('cfs:missile-launch')) },
      { label: 'CANNON', action: () => window.dispatchEvent(new Event('cfs:cannon-trigger')) },
      { label: 'WAYPOINT', action: () => click('#nav-next') },
      { label: 'AIRFIELD / CARRIER', action: () => click('#nav-site') },
      { label: 'APPROACH', action: () => click('#landing-guide-toggle') },
      { label: 'BEACON PREV', action: () => click('#contact-status [data-landing-prev]') },
      { label: 'BEACON NEXT', action: () => click('#contact-status [data-landing-next]') },
      { label: 'NEXT CONTACT', action: () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab' })) },
      { label: 'FOCUS', action: () => click('#contact-status [data-focus]') },
      { label: 'SETTINGS', action: () => click('#cockpit-shell .cockpit-config summary') },
      { label: 'PITCH UP', action: () => {}, hold: { down: 'ArrowDown', up: 'ArrowDown' } },
      { label: 'PITCH DOWN', action: () => {}, hold: { down: 'ArrowUp', up: 'ArrowUp' } },
      { label: 'ROLL LEFT', action: () => {}, hold: { down: 'ArrowLeft', up: 'ArrowLeft' } },
      { label: 'ROLL RIGHT', action: () => {}, hold: { down: 'ArrowRight', up: 'ArrowRight' } },
    ];

    const cols = 4;
    const buttonW = 0.385;
    const buttonH = 0.105;
    const gapX = 0.025;
    const gapY = 0.025;
    const startX = -((cols * buttonW + (cols - 1) * gapX) / 2) + buttonW / 2;
    const startY = 0.015;

    controls.forEach((control, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const face = this.makeLabelTexture(control.label);
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(buttonW, buttonH, 0.045),
        [
          new THREE.MeshStandardMaterial({ color: 0x33443a, metalness: 0.75, roughness: 0.32 }),
          new THREE.MeshStandardMaterial({ color: 0x33443a, metalness: 0.75, roughness: 0.32 }),
          new THREE.MeshStandardMaterial({ color: 0x526b5a, metalness: 0.62, roughness: 0.3 }),
          new THREE.MeshStandardMaterial({ color: 0x17241d, metalness: 0.7, roughness: 0.4 }),
          new THREE.MeshStandardMaterial({ color: 0x17241d, metalness: 0.7, roughness: 0.4 }),
          new THREE.MeshStandardMaterial({ map: face, color: 0xffffff, metalness: 0.15, roughness: 0.48 }),
        ],
      );
      mesh.position.set(
        startX + col * (buttonW + gapX),
        startY - row * (buttonH + gapY),
        -1.475,
      );
      mesh.userData.control = control;
      this.camera.add(mesh);
      this.hitTargets.push(mesh);
    });
  }

  private makeLabelTexture(label: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#17271e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#8ee6aa';
    ctx.lineWidth = 5;
    ctx.strokeRect(3, 3, canvas.width - 6, canvas.height - 6);
    ctx.fillStyle = '#e4ffec';
    ctx.font = 'bold 38px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, canvas.width / 2, canvas.height / 2, 480);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private resize = (): void => {
    if (this.disposed) return;
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.render();
  };

  private render(): void {
    if (!this.disposed) this.renderer.render(this.scene, this.camera);
  }

  private pick(clientX: number, clientY: number): Control | null {
    this.pointer.set(
      (clientX / Math.max(1, window.innerWidth)) * 2 - 1,
      -(clientY / Math.max(1, window.innerHeight)) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.hitTargets, false)[0];
    return (hit?.object.userData.control as Control | undefined) ?? null;
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (document.body.dataset.mode !== 'flying' && document.body.dataset.mode !== 'crashed') return;
    const control = this.pick(event.clientX, event.clientY);
    if (!control) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (control.hold) {
      this.held.set(event.pointerId, control.hold.up);
      window.dispatchEvent(new KeyboardEvent('keydown', { code: control.hold.down }));
    } else control.action();
  };

  private onPointerUp = (event: PointerEvent): void => {
    const code = this.held.get(event.pointerId);
    if (!code) return;
    window.dispatchEvent(new KeyboardEvent('keyup', { code }));
    this.held.delete(event.pointerId);
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  private onMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0 || 'ontouchstart' in window) return;
    const control = this.pick(event.clientX, event.clientY);
    if (!control) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  private onMouseUp = (event: MouseEvent): void => {
    if (event.button !== 0 || 'ontouchstart' in window) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  dispose(): void {
    this.disposed = true;
    this.resizeObserver.disconnect();
    window.removeEventListener('resize', this.resize);
    this.host.removeEventListener('pointerdown', this.onPointerDown, true);
    this.host.removeEventListener('pointerup', this.onPointerUp, true);
    this.host.removeEventListener('pointercancel', this.onPointerUp, true);
    this.host.removeEventListener('mousedown', this.onMouseDown, true);
    this.host.removeEventListener('mouseup', this.onMouseUp, true);
    this.renderer.dispose();
    this.canvas.remove();
  }
}
