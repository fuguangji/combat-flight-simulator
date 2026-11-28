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

    const pageTexture = this.makeBezelLabel('MAP  ·  FLIGHT  ·  SYSTEM  ·  SENSOR');
    const pageMaterial = new THREE.MeshBasicMaterial({ map: pageTexture, transparent: true, side: THREE.DoubleSide });
    this.pageLabel = new THREE.Mesh(new THREE.PlaneGeometry(0.43, 0.028), pageMaterial);
    this.pageLabel.userData.cockpitMfd = true;
    this.pageLabel.rotation.set(0, -Math.PI / 2, 0);
    this.pageLabel.position.set(0.74, 0.36, 0);
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
    // The procedural cockpit already contains a physical display housing at
    // x=-0.105, y=0.08, z=±0.39 relative to the instrument-panel body.
    housing.position.set(0.775, 0.56, lateral);

    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(0.40, 0.28),
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, toneMapped: false }),
    );
    glass.userData.cockpitMfd = true;
    // Body +X points forward. The screen normal points -X toward the pilot.
    glass.rotation.set(0, -Math.PI / 2, 0);
    glass.position.x = -0.029;
    housing.add(glass);
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
    if (event.code === 'F1' || event.code === 'Digit1' || event.code === 'KeyV') this.setPage('FLIGHT');
    else if (event.code === 'F2' || event.code === 'Digit2' || event.code === 'KeyM') this.setPage('SYSTEM');
    else if (event.code === 'F3' || event.code === 'Digit3' || event.code === 'KeyB') this.setPage('SENSOR');
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
    const readSetting = (id: string, fallback: string): string =>
      document.querySelector<HTMLInputElement>(`#${id}`)?.value ?? fallback;
    const ap = document.body.dataset.autopilot === 'true';
    const items: Array<[string, string, boolean]> = [
      ['CANOPY', document.body.dataset.canopyOpen === 'true' ? 'OPEN' : 'CLOSED', document.body.dataset.canopyOpen === 'true'],
      ['LANDING GEAR', document.body.dataset.gearDown === 'true' ? 'DOWN' : 'UP', document.body.dataset.gearDown === 'true'],
      ['AUTOPILOT', ap ? 'ENGAGED' : 'STANDBY', ap],
      ['AP TARGET ALT', `${readSetting('ap-alt', '3000')} m`, ap],
      ['AP TARGET HDG', `${readSetting('ap-hdg', '000')}°`, ap],
      ['AP THROTTLE', `${readSetting('ap-thr', '55')} %`, ap],
      ['FLIGHT COMPUTER', this.snapshot ? 'ONLINE' : 'STANDBY', Boolean(this.snapshot)],
    ];
    items.forEach(([label, value, active], index) => {
      const y = 78 + index * 31;
      ctx.fillStyle = '#729783';
      ctx.font = '14px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(label, 28, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = active ? '#a8ffc9' : '#c0a879';
      ctx.font = 'bold 17px ui-monospace, monospace';
      ctx.fillText(value, 480, y);
      ctx.strokeStyle = 'rgba(136,255,181,.16)';
      ctx.beginPath();
      ctx.moveTo(24, y + 8);
      ctx.lineTo(488, y + 8);
      ctx.stroke();
    });
    ctx.textAlign = 'left';
    ctx.fillStyle = '#789f89';
    ctx.font = '12px ui-monospace, monospace';
    ctx.fillText('DISPLAY DATA IS SIMULATION TELEMETRY', 28, 300);
  }

  private drawSensorPage(ctx: CanvasRenderingContext2D, now: number): void {
    this.drawFrame(ctx, 'RADAR STATUS', 'TRAINING / NO TRACKS');
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
    ctx.fillText('SIMULATED SWEEP ACTIVE', cx, 288);
    ctx.fillStyle = '#8aa995';
    ctx.font = '12px ui-monospace, monospace';
    ctx.fillText('NO TRACK DATA / NO TARGET CUES', cx, 268);
    const range = document.querySelector<HTMLInputElement>('#lock-range')?.value ?? '20';
    const sensitivity = document.querySelector<HTMLInputElement>('#lock-sens')?.value ?? '50';
    ctx.fillStyle = '#a8ffc9';
    ctx.font = '14px ui-monospace, monospace';
    ctx.fillText(`RANGE ${range} KM  ·  SENS ${sensitivity}%`, cx, 310);
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
        if (Array.isArray(material)) material.forEach((item) => { (item as THREE.MeshBasicMaterial).map?.dispose(); item.dispose(); });
        else { (material as THREE.MeshBasicMaterial).map?.dispose(); material.dispose(); }
      }
    });
    this.group.removeFromParent();
  }
}
