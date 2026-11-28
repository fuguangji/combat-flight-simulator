import * as THREE from 'three';
import type { AircraftSnapshot } from '../physics/stateLayout';

/**
 * Physical multifunction displays mounted to the aircraft's instrument-panel mesh.
 * This intentionally renders flight/navigation/system information only. It does not
 * reproduce contact tracks, target selection, or weapon cueing on the cockpit displays.
 */
export type MfdPage = 'FLIGHT' | 'SYSTEM' | 'SENSOR';

type FlightEventDetail = { snapshot?: AircraftSnapshot; heading?: number };

export class CockpitMfd {
  readonly group = new THREE.Group();
  private readonly leftCanvas = document.createElement('canvas');
  private readonly rightCanvas = document.createElement('canvas');
  private readonly leftContext: CanvasRenderingContext2D;
  private readonly rightContext: CanvasRenderingContext2D;
  private readonly leftTexture: THREE.CanvasTexture;
  private readonly rightTexture: THREE.CanvasTexture;
  private readonly pageLabel: THREE.Mesh;
  private page: MfdPage = 'FLIGHT';
  private snapshot: AircraftSnapshot | null = null;
  private heading = 0;
  private landing: { phase?: string; distanceToThreshold?: number; targetAltitude?: number; speed?: number; verticalSpeed?: number; lateralError?: number; glideError?: number } | null = null;
  private lastDraw = -Infinity;
  private sensorSweep = 0;
  private disposed = false;
  private readonly frame = (): void => {
    if (this.disposed) return;
    const now = performance.now();
    if (now - this.lastDraw >= 100) {
      this.lastDraw = now;
      this.drawLeft();
      this.drawRight(now);
      this.leftTexture.needsUpdate = true;
      this.rightTexture.needsUpdate = true;
    }
  };

  constructor() {
    this.group.name = 'cockpit-multifunction-displays';
    this.group.userData.cockpitAnchor = 'dashboard';

    this.leftCanvas.width = 512;
    this.leftCanvas.height = 320;
    this.rightCanvas.width = 512;
    this.rightCanvas.height = 320;
    const left = this.leftCanvas.getContext('2d');
    const right = this.rightCanvas.getContext('2d');
    if (!left || !right) throw new Error('無法建立 3D 座艙多功能顯示器');
    this.leftContext = left;
    this.rightContext = right;

    this.leftTexture = new THREE.CanvasTexture(this.leftCanvas);
    this.rightTexture = new THREE.CanvasTexture(this.rightCanvas);
    this.leftTexture.colorSpace = THREE.SRGBColorSpace;
    this.rightTexture.colorSpace = THREE.SRGBColorSpace;
    this.leftTexture.anisotropy = 2;
    this.rightTexture.anisotropy = 2;

    this.addScreen('MFD-NAV', this.leftTexture, -0.255);
    this.addScreen('MFD-FLIGHT', this.rightTexture, 0.255);

    const pageTexture = this.makeBezelLabel('MAP  ·  FLIGHT  ·  SYSTEM');
    const pageMaterial = new THREE.MeshBasicMaterial({ map: pageTexture, transparent: true, side: THREE.DoubleSide });
    this.pageLabel = new THREE.Mesh(new THREE.PlaneGeometry(0.43, 0.028), pageMaterial);
    this.pageLabel.rotation.x = -Math.PI / 2;
    this.pageLabel.position.set(-0.012, 0.17, 0);
    this.group.add(this.pageLabel);

    this.drawLeft();
    this.drawRight(performance.now());
    window.addEventListener('cfs:flight-snapshot', this.onFlightSnapshot);
    window.addEventListener('cfs:landing-guidance', this.onLandingGuidance);
    window.addEventListener('cfs:mfd-page', this.onPageEvent);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('cfs:flight-start', this.onFlightStart);
  }

  setPage(page: MfdPage): void {
    this.page = page;
    this.drawRight(performance.now());
    this.rightTexture.needsUpdate = true;
  }

  private addScreen(name: string, texture: THREE.CanvasTexture, lateral: number): void {
    const housing = new THREE.Group();
    housing.name = name;
    // Dashboard coordinates are shared with the physical switch-bank anchors.
    housing.position.set(-0.018, 0.245, lateral);

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.215, 0.035),
      new THREE.MeshStandardMaterial({ color: 0x101814, metalness: 0.66, roughness: 0.42 }),
    );
    body.position.y = 0;
    housing.add(body);

    const bezel = new THREE.Mesh(
      new THREE.BoxGeometry(0.318, 0.193, 0.008),
      new THREE.MeshStandardMaterial({ color: 0x26342d, metalness: 0.72, roughness: 0.3 }),
    );
    bezel.position.y = 0.021;
    housing.add(bezel);

    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(0.296, 0.17),
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, toneMapped: false }),
    );
    glass.rotation.x = -Math.PI / 2;
    glass.position.y = 0.026;
    housing.add(glass);

    const screws = new THREE.Mesh(
      new THREE.CylinderGeometry(0.004, 0.004, 0.003, 8),
      new THREE.MeshStandardMaterial({ color: 0x9aa69c, metalness: 0.9, roughness: 0.22 }),
    );
    for (const x of [-0.15, 0.15]) for (const z of [-0.09, 0.09]) {
      const screw = screws.clone();
      screw.position.set(x, 0.022, z);
      housing.add(screw);
    }
    this.group.add(housing);
  }

  private makeBezelLabel(label: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 64;
    const context = canvas.getContext('2d')!;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#a8cbb5';
    context.font = 'bold 22px ui-monospace, monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(label, canvas.width / 2, canvas.height / 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private onFlightSnapshot = (event: Event): void => {
    const detail = (event as CustomEvent<FlightEventDetail>).detail;
    if (detail?.snapshot) this.snapshot = detail.snapshot;
    if (Number.isFinite(detail?.heading)) this.heading = detail.heading!;
    this.frame();
  };

  private onLandingGuidance = (event: Event): void => {
    this.landing = (event as CustomEvent<typeof this.landing>).detail;
    this.frame();
  };

  private onPageEvent = (event: Event): void => {
    const page = (event as CustomEvent<{ page?: MfdPage }>).detail?.page;
    if (page === 'FLIGHT' || page === 'SYSTEM' || page === 'SENSOR') this.setPage(page);
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'F1') this.setPage('FLIGHT');
    else if (event.code === 'F2') this.setPage('SYSTEM');
    else if (event.code === 'F3') this.setPage('SENSOR');
  };

  private onFlightStart = (): void => {
    this.snapshot = null;
    this.landing = null;
    this.setPage('FLIGHT');
  };

  private drawFrame(ctx: CanvasRenderingContext2D, title: string, subtitle: string): void {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#04100d';
    ctx.fillRect(0, 0, w, h);
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, '#0b2119');
    gradient.addColorStop(1, '#020907');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(136,255,181,.24)';
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.fillStyle = '#a8ffc9';
    ctx.font = 'bold 22px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(title, 22, 34);
    ctx.fillStyle = '#789f89';
    ctx.font = '14px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(subtitle, w - 22, 34);
    ctx.strokeStyle = 'rgba(136,255,181,.22)';
    ctx.beginPath();
    ctx.moveTo(20, 48);
    ctx.lineTo(w - 20, 48);
    ctx.stroke();
  }

  private drawLeft(): void {
    const ctx = this.leftContext;
    this.drawFrame(ctx, 'NAVIGATION', 'MAP / NORTH-UP');
    const source = document.querySelector<HTMLCanvasElement>('#navigation-display canvas');
    if (source) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(source, 22, 62, 468, 204);
    } else {
      ctx.fillStyle = '#789f89';
      ctx.font = '18px ui-monospace, monospace';
      ctx.fillText('NAV DATA INITIALIZING', 28, 105);
    }
    ctx.fillStyle = '#a8ffc9';
    ctx.font = '16px ui-monospace, monospace';
    ctx.textAlign = 'left';
    const s = this.snapshot;
    if (s) {
      const hdg = ((Math.round(this.heading * 180 / Math.PI) % 360) + 360) % 360;
      ctx.fillText(`OWN ${Math.round(s.position[0])} / ${Math.round(s.position[2])}`, 24, 292);
      ctx.textAlign = 'right';
      ctx.fillText(`HDG ${String(hdg).padStart(3, '0')}°`, 488, 292);
    } else {
      ctx.fillText('WAITING FOR FLIGHT DATA', 24, 292);
    }
  }

  private drawRight(now: number): void {
    const ctx = this.rightContext;
    if (this.page === 'FLIGHT') this.drawFlightPage(ctx);
    else if (this.page === 'SYSTEM') this.drawSystemPage(ctx);
    else this.drawSensorPage(ctx, now);
  }

  private drawFlightPage(ctx: CanvasRenderingContext2D): void {
    this.drawFrame(ctx, 'FLIGHT DATA', 'PRIMARY / SECONDARY');
    const s = this.snapshot;
    if (!s) {
      ctx.fillStyle = '#789f89';
      ctx.font = '20px ui-monospace, monospace';
      ctx.fillText('WAITING FOR TELEMETRY', 24, 100);
      return;
    }
    const hdg = ((Math.round(this.heading * 180 / Math.PI) % 360) + 360) % 360;
    const values: Array<[string, string]> = [
      ['ALTITUDE', `${Math.round(s.altitude).toLocaleString()} m`],
      ['AIRSPEED', `${Math.round(s.airspeed * 1.943844)} kt`],
      ['MACH', s.mach.toFixed(2)],
      ['HEADING', `${String(hdg).padStart(3, '0')}°`],
      ['VERTICAL SPEED', `${s.velocity[1] >= 0 ? '+' : ''}${s.velocity[1].toFixed(1)} m/s`],
      ['LOAD FACTOR', `${s.loadFactor.toFixed(1)} G`],
      ['FUEL', `${Math.round(s.fuel).toLocaleString()} kg`],
      ['ENGINE POWER', `${Math.round(s.power * 100)} %`],
    ];
    values.forEach(([label, value], index) => {
      const col = index % 2, row = Math.floor(index / 2);
      const x = 26 + col * 236, y = 92 + row * 48;
      ctx.fillStyle = '#729783';
      ctx.font = '14px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(label, x, y);
      ctx.fillStyle = '#e0ffeb';
      ctx.font = 'bold 24px ui-monospace, monospace';
      ctx.fillText(value, x, y + 25);
    });
    ctx.fillStyle = s.stallWarning ? '#ffc56b' : '#a8ffc9';
    ctx.font = 'bold 15px ui-monospace, monospace';
    ctx.fillText(s.stallWarning ? 'STALL WARNING' : s.afterburner ? 'ENGINE BOOST' : 'FLIGHT NORMAL', 26, 292);
    if (this.landing) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffc56b';
      ctx.fillText(`APPROACH ${this.landing.phase ?? ''} · ${((this.landing.distanceToThreshold ?? 0) / 1000).toFixed(1)} KM`, 488, 292);
    }
  }

  private drawSystemPage(ctx: CanvasRenderingContext2D): void {
    this.drawFrame(ctx, 'AIRCRAFT SYSTEMS', 'STATUS / MONITOR');
    const items: Array<[string, string, boolean]> = [
      ['CANOPY', document.body.dataset.canopyOpen === 'true' ? 'OPEN' : 'CLOSED', document.body.dataset.canopyOpen === 'true'],
      ['LANDING GEAR', document.body.dataset.gearDown === 'true' ? 'DOWN' : 'UP', document.body.dataset.gearDown === 'true'],
      ['AUTOPILOT', document.body.dataset.autopilot === 'true' ? 'ENGAGED' : 'STANDBY', document.body.dataset.autopilot === 'true'],
      ['FLIGHT COMPUTER', this.snapshot ? 'ONLINE' : 'STANDBY', Boolean(this.snapshot)],
    ];
    items.forEach(([label, value, active], index) => {
      const y = 100 + index * 48;
      ctx.fillStyle = '#729783';
      ctx.font = '17px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(label, 28, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = active ? '#a8ffc9' : '#c0a879';
      ctx.font = 'bold 22px ui-monospace, monospace';
      ctx.fillText(value, 480, y);
      ctx.strokeStyle = 'rgba(136,255,181,.16)';
      ctx.beginPath();
      ctx.moveTo(24, y + 14);
      ctx.lineTo(488, y + 14);
      ctx.stroke();
    });
    ctx.textAlign = 'left';
    ctx.fillStyle = '#789f89';
    ctx.font = '13px ui-monospace, monospace';
    ctx.fillText('DISPLAY DATA IS SIMULATION TELEMETRY', 28, 286);
  }

  private drawSensorPage(ctx: CanvasRenderingContext2D, now: number): void {
    this.drawFrame(ctx, 'SENSOR STATUS', 'TRAINING / NON-TARGET');
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const cx = w / 2, cy = 174, radius = 102;
    ctx.strokeStyle = 'rgba(136,255,181,.32)';
    ctx.lineWidth = 2;
    for (const scale of [1, 0.66, 0.33]) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx - radius, cy);
    ctx.lineTo(cx + radius, cy);
    ctx.moveTo(cx, cy - radius);
    ctx.lineTo(cx, cy + radius);
    ctx.stroke();
    this.sensorSweep = (now / 2600) % (Math.PI * 2);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.sensorSweep);
    const sweep = ctx.createLinearGradient(0, 0, radius, 0);
    sweep.addColorStop(0, 'rgba(125,255,154,.5)');
    sweep.addColorStop(1, 'rgba(125,255,154,0)');
    ctx.fillStyle = sweep;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, -0.22, 0.22);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#a8ffc9';
    ctx.font = 'bold 16px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SENSOR DISPLAY ACTIVE', cx, 300);
    ctx.fillStyle = '#8aa995';
    ctx.font = '12px ui-monospace, monospace';
    ctx.fillText('NO TRACKS / NO TARGET CUES', cx, 282);
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('cfs:flight-snapshot', this.onFlightSnapshot);
    window.removeEventListener('cfs:landing-guidance', this.onLandingGuidance);
    window.removeEventListener('cfs:mfd-page', this.onPageEvent);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('cfs:flight-start', this.onFlightStart);
    this.leftTexture.dispose();
    this.rightTexture.dispose();
    this.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material.dispose();
      }
    });
    this.group.removeFromParent();
  }
}
