import * as THREE from 'three';
import type { AircraftView } from './aircraftView';

type Control = {
  label: string;
  action: () => void;
  toggle?: boolean;
  lever?: THREE.Object3D;
  state?: boolean;
};

const click = (selector: string): void => {
  document.querySelector<HTMLElement>(selector)?.click();
};

/** Compact physical toggle switches. Flight axes remain keyboard/touch controls, not 3D buttons. */
export class CockpitSceneControls {
  private readonly groups: THREE.Group[] = [];
  private readonly style = document.createElement('style');

  constructor(private readonly host: HTMLElement, private readonly aircraftView: AircraftView) {
    this.groups.push(this.createSwitchBank([
      { label: 'PAUSE', action: () => this.tapKey('Escape') },
      { label: 'CENTER', action: () => window.dispatchEvent(new Event('cfs:look-recenter')) },
      { label: 'AUTO', action: () => window.dispatchEvent(new Event('cfs:autopilot-toggle')), toggle: true },
      { label: 'GEAR', action: () => window.dispatchEvent(new Event('cfs:gear-toggle')), toggle: true },
      { label: 'CANOPY', action: () => window.dispatchEvent(new Event('cfs:canopy-toggle')), toggle: true },
      { label: 'WAYPOINT', action: () => click('#nav-next') },
      { label: 'AIRFIELD', action: () => click('#nav-site') },
      { label: 'APPROACH', action: () => click('#landing-guide-toggle'), toggle: true },
    ]));
    this.aircraftView.setCockpitControls(this.groups);
    this.host.addEventListener('pointerdown', this.onPointerDown, true);
    window.addEventListener('cfs:touch-mode', this.onTouchMode);
    this.onTouchMode();
    this.style.dataset.cfs3dControls = 'true';
    this.style.textContent = `
      body.touch #cockpit-shell { display:none !important; }
      body[data-mode="flying"] #cockpit-shell .cockpit-switches button,
      body[data-mode="flying"] #cockpit-shell .cockpit-config summary,
      body[data-mode="flying"] #cockpit-dashboard button,
      body[data-mode="flying"] #contact-status button,
      body[data-mode="flying"] #navigation-display button,
      body[data-mode="flying"] #touch,
      body[data-mode="flying"] #tutorial-next,
      body[data-mode="crashed"] #tutorial-next,
      body[data-mode="crashed"] #cockpit-shell .cockpit-switches button,
      body[data-mode="crashed"] #cockpit-shell .cockpit-config summary,
      body[data-mode="crashed"] #cockpit-dashboard button,
      body[data-mode="crashed"] #contact-status button,
      body[data-mode="crashed"] #navigation-display button,
      body[data-mode="crashed"] #touch { display:none !important; }
      body[data-mode="flying"] #cockpit-dashboard,
      body[data-mode="flying"] #contact-status,
      body[data-mode="flying"] #navigation-display { pointer-events:none !important; }
      body[data-mode="flying"][data-pointer-locked="true"] #help { opacity:.18; }
    `;
    document.head.append(this.style);
  }

  private createSwitchBank(controls: Control[]): THREE.Group {
    const group = new THREE.Group();
    group.name = 'cockpit-physical-switches';
    group.userData.cockpitAnchor = 'dashboard';
    const columns = 4;
    controls.forEach((control, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      const base = new THREE.Group();
      base.name = `toggle-${control.label.toLowerCase()}`;
      base.position.set(-0.018, 0.105 - row * 0.15, (col - 1.5) * 0.25);

      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(0.19, 0.035, 0.14),
        new THREE.MeshStandardMaterial({ color: 0x18251f, metalness: 0.72, roughness: 0.34 }),
      );
      plate.position.y = 0;
      base.add(plate);

      const socket = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.04, 0.025, 12),
        new THREE.MeshStandardMaterial({ color: 0x59665f, metalness: 0.82, roughness: 0.28 }),
      );
      socket.position.set(0, 0.025, 0);
      base.add(socket);

      const lever = new THREE.Group();
      lever.position.set(0, 0.035, 0);
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.009, 0.013, 0.085, 8),
        new THREE.MeshStandardMaterial({ color: 0xc3cbc5, metalness: 0.9, roughness: 0.22 }),
      );
      shaft.position.y = 0.04;
      shaft.rotation.z = -0.18;
      lever.add(shaft);
      const tip = new THREE.Mesh(
        new THREE.SphereGeometry(0.021, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0x252d28, metalness: 0.55, roughness: 0.3 }),
      );
      tip.position.y = 0.083;
      lever.add(tip);
      base.add(lever);
      control.lever = lever;
      plate.userData.control = control;
      socket.userData.control = control;
      shaft.userData.control = control;
      tip.userData.control = control;

      const label = this.makeLabelTexture(control.label);
      const labelMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.16, 0.035),
        new THREE.MeshBasicMaterial({ map: label, transparent: true, side: THREE.DoubleSide }),
      );
      labelMesh.rotation.x = -Math.PI / 2;
      labelMesh.position.set(0, 0.019, 0.045);
      base.add(labelMesh);
      group.add(base);
    });
    return group;
  }

  private makeLabelTexture(label: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('無法建立座艙開關標籤');
    context.fillStyle = '#101914';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = '#7d9b88';
    context.lineWidth = 3;
    context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
    context.fillStyle = '#e5f4e9';
    context.font = 'bold 27px ui-monospace, monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(label, canvas.width / 2, canvas.height / 2, 240);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private tapKey(code: string): void {
    window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code }));
  }

  private onTouchMode = (): void => {
    const desktopCockpitSwitchesVisible = !document.body.classList.contains('touch');
    this.groups.forEach((group) => { group.visible = desktopCockpitSwitchesVisible; });
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (document.body.dataset.mode !== 'flying' || event.pointerType === 'touch') return;
    const control = this.aircraftView.pickCockpitControl(event.clientX, event.clientY) as Control | null;
    if (!control) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    control.action();
    if (control.toggle && control.lever) {
      control.state = !control.state;
      control.lever.rotation.z = control.state ? 0.62 : -0.62;
    }
  };

  dispose(): void {
    this.host.removeEventListener('pointerdown', this.onPointerDown, true);
    window.removeEventListener('cfs:touch-mode', this.onTouchMode);
    this.style.remove();
    this.groups.forEach((group) => {
      group.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((material) => {
          const standard = material as THREE.MeshStandardMaterial;
          if (standard.map) standard.map.dispose();
          material.dispose();
        });
      });
      group.removeFromParent();
    });
  }
}
