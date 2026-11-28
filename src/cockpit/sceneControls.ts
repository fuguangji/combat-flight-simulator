import * as THREE from 'three';
import type { AircraftView } from './aircraftView';

type Control = {
  label: string;
  action: () => void;
  hold?: { down: string; up: string };
};

const click = (selector: string): void => {
  document.querySelector<HTMLElement>(selector)?.click();
};

/**
 * Interactive switches are children of each aircraft's actual instrument/console components.
 * Their positions therefore inherit the selected airframe's cockpit geometry and camera.
 */
export class CockpitSceneControls {
  private readonly groups: THREE.Group[] = [];
  private readonly held = new Map<number, string>();
  private readonly style = document.createElement('style');

  constructor(private readonly host: HTMLElement, private readonly aircraftView: AircraftView) {
    this.groups.push(this.createBank('dashboard', [
      { label: 'PAUSE', action: () => this.tapKey('Escape') },
      { label: 'LOOK CENTER', action: () => window.dispatchEvent(new Event('cfs:look-recenter')) },
      { label: 'AUTOPILOT', action: () => window.dispatchEvent(new Event('cfs:autopilot-toggle')) },
      { label: 'GEAR', action: () => window.dispatchEvent(new Event('cfs:gear-toggle')) },
      { label: 'CANOPY', action: () => window.dispatchEvent(new Event('cfs:canopy-toggle')) },
      { label: 'WAYPOINT', action: () => click('#nav-next') },
      { label: 'AIRFIELD / CARRIER', action: () => click('#nav-site') },
      { label: 'APPROACH', action: () => click('#landing-guide-toggle') },
    ], 2, 'vertical'));

    this.groups.push(this.createBank('left', [
      { label: 'BEACON PREV', action: () => click('#contact-status [data-landing-prev]') },
      { label: 'BEACON NEXT', action: () => click('#contact-status [data-landing-next]') },
      { label: 'NEXT CONTACT', action: () => this.tapKey('Tab') },
      { label: 'FOCUS', action: () => click('#contact-status [data-focus]') },
      { label: 'SETTINGS', action: () => click('#cockpit-shell .cockpit-config summary') },
      { label: 'TUTORIAL NEXT', action: () => click('#tutorial-next') },
    ], 3, 'horizontal'));

    this.groups.push(this.createBank('right', [
      { label: 'THROTTLE UP', action: () => {}, hold: { down: 'KeyW', up: 'KeyW' } },
      { label: 'THROTTLE DOWN', action: () => {}, hold: { down: 'KeyS', up: 'KeyS' } },
      { label: 'PITCH UP', action: () => {}, hold: { down: 'ArrowDown', up: 'ArrowDown' } },
      { label: 'PITCH DOWN', action: () => {}, hold: { down: 'ArrowUp', up: 'ArrowUp' } },
      { label: 'ROLL LEFT', action: () => {}, hold: { down: 'ArrowLeft', up: 'ArrowLeft' } },
      { label: 'ROLL RIGHT', action: () => {}, hold: { down: 'ArrowRight', up: 'ArrowRight' } },
    ], 3, 'horizontal'));

    this.aircraftView.setCockpitControls(this.groups);
    this.host.addEventListener('pointerdown', this.onPointerDown, true);
    this.host.addEventListener('pointerup', this.onPointerUp, true);
    this.host.addEventListener('pointercancel', this.onPointerUp, true);
    this.style.dataset.cfs3dControls = 'true';
    this.style.textContent = `
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
    `;
    document.head.append(this.style);
  }

  private createBank(anchor: 'dashboard' | 'left' | 'right', controls: Control[], columns: number, orientation: 'vertical' | 'horizontal'): THREE.Group {
    const group = new THREE.Group();
    group.name = `cockpit-controls-${anchor}`;
    group.userData.cockpitAnchor = anchor;
    const buttonWidth = orientation === 'vertical' ? 0.42 : 0.25;
    const buttonHeight = orientation === 'vertical' ? 0.075 : 0.065;
    const depth = orientation === 'vertical' ? 0.045 : 0.12;
    const gapX = orientation === 'vertical' ? 0.055 : 0.035;
    const gapY = orientation === 'vertical' ? 0.025 : 0.045;
    const rows = Math.ceil(controls.length / columns);
    controls.forEach((control, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      const face = this.makeLabelTexture(control.label);
      const materials = Array.from({ length: 6 }, () => new THREE.MeshStandardMaterial({
        color: 0x263c32, metalness: 0.68, roughness: 0.38,
      }));
      // Dashboard switches face the pilot (-X); side-console switches face upward (+Y).
      materials[orientation === 'vertical' ? 1 : 2].map = face;
      materials[orientation === 'vertical' ? 1 : 2].color.set(0xffffff);
      const geometry = orientation === 'vertical'
        ? new THREE.BoxGeometry(depth, buttonHeight, buttonWidth)
        : new THREE.BoxGeometry(buttonWidth, buttonHeight, depth);
      const mesh = new THREE.Mesh(geometry, materials);
      mesh.name = `cockpit-switch-${control.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      if (orientation === 'vertical') {
        const x = -0.018;
        const y = 0.115 - row * (buttonHeight + gapY);
        const z = (col - (columns - 1) / 2) * (buttonWidth + gapX);
        mesh.position.set(x, y, z);
      } else {
        const x = (col - (columns - 1) / 2) * (buttonWidth + gapX);
        const z = (row - (rows - 1) / 2) * (depth + gapY);
        mesh.position.set(x, 0.025, z);
      }
      mesh.userData.control = control;
      group.add(mesh);
    });
    return group;
  }

  private makeLabelTexture(label: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 384;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('無法建立座艙按鈕標籤');
    context.fillStyle = '#14241c';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = '#8ee6aa';
    context.lineWidth = 5;
    context.strokeRect(3, 3, canvas.width - 6, canvas.height - 6);
    context.fillStyle = '#e4ffec';
    context.font = 'bold 30px ui-monospace, monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(label, canvas.width / 2, canvas.height / 2, 360);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private tapKey(code: string): void {
    window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code }));
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (document.body.dataset.mode !== 'flying') return;
    const control = this.aircraftView.pickCockpitControl(event.clientX, event.clientY) as Control | null;
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

  dispose(): void {
    this.host.removeEventListener('pointerdown', this.onPointerDown, true);
    this.host.removeEventListener('pointerup', this.onPointerUp, true);
    this.host.removeEventListener('pointercancel', this.onPointerUp, true);
    this.style.remove();
    this.groups.forEach((group) => {
      group.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((material) => {
          if (material.map) material.map.dispose();
          material.dispose();
        });
      });
      group.removeFromParent();
    });
    this.held.clear();
  }
}
