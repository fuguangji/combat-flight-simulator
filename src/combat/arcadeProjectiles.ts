import { quatRotate, type Vec3 } from '../core/math';
import type { CameraState } from '../rendering/Renderer';
import type { AircraftSnapshot } from '../physics/stateLayout';
import { CombatSimulation, distanceBetween, type CombatContact, type CombatTargetKind } from './simulation';
import { SITE_MARKERS } from '../world/sites';
import weaponCatalog from './weapons.json';

type EquipmentId = string;
type FlightSnapshotEvent = CustomEvent<{
  snapshot: AircraftSnapshot;
  camera: CameraState;
}>;
type ProjectedPoint = { x: number; y: number; depth: number };

const EQUIPMENT = Object.fromEntries(weaponCatalog.map((weapon) => [weapon.id, weapon])) as Record<
  EquipmentId,
  (typeof weaponCatalog)[number]
>;
const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const relative = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export class ArcadeProjectileSystem {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly panel: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly reticle: HTMLDivElement;
  private readonly simulation = new CombatSimulation();
  private equipment: EquipmentId = 'nova17';
  private ammo: Record<EquipmentId, number> = Object.fromEntries(weaponCatalog.map((weapon) => [weapon.id, weapon.capacity]));
  private cooldowns: Record<EquipmentId, number> = Object.fromEntries(weaponCatalog.map((weapon) => [weapon.id, 0]));
  private selectedTargetId: string | null = null;
  private focused = false;
  private landingSiteId: string | null = null;
  private initialized = false;
  private lastMode = '';
  private lastSimTime = 0;
  private lastFrameTime = performance.now();
  private lastUiTime = 0;
  private lastUiSignature = '';
  private lastContactsSignature = '';
  private readonly notifiedDestroyed = new Set<string>();
  private cannonHeld = false;
  private cannonBurstUntil = 0;
  private cannonAccumulator = 0;
  private cannonFlash = 0;
  private missileFlash = 0;
  private message = '';
  private messageUntil = 0;
  private radarRange = 20_000;
  private radarSensitivity = 0.5;
  private autopilotEnabled = false;
  private landingApproachActive = false;

  constructor() {
    const initial = document.body.dataset.equipment as EquipmentId | undefined;
    if (initial && EQUIPMENT[initial]) this.equipment = initial;

    this.canvas = document.createElement('canvas');
    this.canvas.id = 'projectile-effects';
    this.panel = document.createElement('div');
    this.panel.id = 'cockpit-dashboard';
    this.panel.innerHTML = `
      <div class="dashboard-heading"><span>COCKPIT / STORES</span><span>SIM TRAINING</span></div>
      <div class="dashboard-readout" id="dashboard-readout"></div>
      <div class="dashboard-controls">
        <button type="button" data-fire>MISSILE / 導彈發射</button>
        <button type="button" data-autopilot>自動駕駛：OFF</button>
      </div>
      <div class="dashboard-note" id="combat-feedback">F 發射 · 按住 G 機砲 · Tab 切換目標</div>
    `;
    this.status = document.createElement('div');
    this.status.id = 'contact-status';
    this.status.innerHTML = `
      <div class="combat-head"><span>TRAINING RADAR</span><span id="radar-readout">20 KM</span></div>
      <canvas id="combat-radar" width="180" height="180" aria-label="訓練雷達"></canvas>
      <div class="combat-section"><small>CONTACTS / 接觸點</small><div class="contact-actions" id="contact-actions"></div></div>
      <div class="combat-section"><small>LANDING BEACONS / 降落信標</small><div class="landing-beacon-actions" id="landing-beacon-actions"></div></div>
      <div class="combat-focus"><span id="contact-name">等待雷達接觸</span><button type="button" id="focus-state" data-focus>鎖定</button></div>
      <div class="combat-hint" id="radar-hint">目標：選取並鎖定後發射；機場／航艦：點選信標開始進場導引。</div>
    `;
    this.reticle = document.createElement('div');
    this.reticle.id = 'view-reticle';
    this.reticle.setAttribute('aria-hidden', 'true');
    this.reticle.innerHTML = '<i></i><b></b>';
    document.body.append(this.canvas, this.panel, this.status, this.reticle);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Combat display canvas unavailable');
    this.ctx = ctx;

    this.panel.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement)) return;
      if (target.hasAttribute('data-fire')) this.launch();
      if (target.hasAttribute('data-autopilot')) window.dispatchEvent(new Event('cfs:autopilot-toggle'));
    });
    this.status.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement)) return;
      if (target.dataset.landingId) {
        this.selectLandingSite(target.dataset.landingId);
        return;
      }
      if (target.dataset.contactId) this.selectContact(target.dataset.contactId);
      if (target.hasAttribute('data-focus')) this.toggleFocus();
    });
    const landingActions = this.status.querySelector<HTMLElement>('#landing-beacon-actions');
    landingActions?.replaceChildren(...SITE_MARKERS.map((site) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.landingId = site.id;
      button.textContent = site.kind === 'carrier' ? 'PETREL 航艦' : site.id.toUpperCase();
      button.title = `${site.name} · 點選以啟用降落導引`;
      return button;
    }));
    window.addEventListener('cfs:flight-start', () => this.resetFlight());
    window.addEventListener('cfs:flight-snapshot', (event) => this.onSnapshot(event as FlightSnapshotEvent));
    window.addEventListener('cfs:landing-approach-state', (event) => {
      const state = (event as CustomEvent<{ active?: boolean; siteId?: string | null }>).detail;
      if (state?.siteId) this.landingSiteId = state.siteId;
      this.landingApproachActive = Boolean(state?.active);
      this.updatePanel(true);
    });
    window.addEventListener('cfs:missile-launch', () => this.launch());
    window.addEventListener('cfs:cannon-trigger', () => { this.cannonBurstUntil = performance.now() + 260; });
    window.addEventListener('cfs:equipment-select', (event) => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (id && EQUIPMENT[id]) {
        this.equipment = id;
        this.lastUiSignature = '';
        this.renderPanel();
      }
    });
    window.addEventListener('cfs:target-display-config', (event) => {
      const config = (event as CustomEvent<{ rangeKm?: number; sensitivity?: number }>).detail;
      if (Number.isFinite(config?.rangeKm)) this.radarRange = clamp(config.rangeKm! * 1000, 2000, 80_000);
      if (Number.isFinite(config?.sensitivity)) this.radarSensitivity = clamp(config.sensitivity!, 0.1, 1);
      this.lastUiSignature = '';
    });
    window.addEventListener('cfs:autopilot-state', (event) => {
      this.autopilotEnabled = Boolean((event as CustomEvent<{ enabled?: boolean }>).detail?.enabled);
      const button = this.panel.querySelector<HTMLButtonElement>('[data-autopilot]');
      if (button) {
        button.textContent = this.autopilotEnabled ? '自動駕駛：ON' : '自動駕駛：OFF';
        button.dataset.active = String(this.autopilotEnabled);
      }
    });
    window.addEventListener('keydown', (event) => {
      if (event.code === 'KeyF' && !event.repeat) {
        event.preventDefault();
        this.launch();
      } else if (event.code === 'KeyG' && document.body.dataset.mode === 'flying') {
        event.preventDefault();
        this.cannonHeld = true;
      } else if (event.code === 'Tab' && !event.repeat && document.body.dataset.mode === 'flying') {
        event.preventDefault();
        this.cycleContact();
      }
    });
    window.addEventListener('keyup', (event) => {
      if (event.code === 'KeyG') this.cannonHeld = false;
    });
    window.addEventListener('blur', () => { this.cannonHeld = false; });

    this.renderPanel();
    requestAnimationFrame(this.frame);
  }

  private resetFlight(): void {
    this.initialized = false;
    this.selectedTargetId = null;
    this.focused = false;
    this.cannonHeld = false;
    this.cannonBurstUntil = 0;
    this.cannonAccumulator = 0;
    this.ammo = Object.fromEntries(weaponCatalog.map((weapon) => [weapon.id, weapon.capacity]));
    this.cooldowns = Object.fromEntries(weaponCatalog.map((weapon) => [weapon.id, 0]));
    this.autopilotEnabled = false;
    this.notifiedDestroyed.clear();
    this.lastContactsSignature = '';
    this.lastUiSignature = '';
    this.setMessage('任務開始 · 雷達掃描中', 1800);
    this.renderPanel();
  }

  private onSnapshot(event: FlightSnapshotEvent): void {
    const { snapshot, camera } = event.detail;
    const mode = document.body.dataset.mode ?? '';
    if (!this.initialized) {
      const forward = quatRotate(snapshot.orientation, [1, 0, 0]);
      const heading = Math.atan2(forward[0], -forward[2]);
      this.simulation.reset(snapshot.position, heading);
      this.initialized = true;
      this.lastSimTime = snapshot.time;
      this.selectedTargetId = this.simulation.contacts[0]?.id ?? null;
      this.focused = false;
      this.lastUiSignature = '';
    }

    if (mode === 'flying') {
      const dt = clamp(snapshot.time - this.lastSimTime, 0, 0.05);
      this.lastSimTime = snapshot.time;
      this.simulation.update(dt);
      for (const contact of this.simulation.contacts) {
        if (!contact.alive && !this.notifiedDestroyed.has(contact.id)) this.notifyDestroyed(contact);
      }
      for (const id of Object.keys(this.cooldowns)) this.cooldowns[id] = Math.max(0, this.cooldowns[id] - dt);
      this.cannonAccumulator += dt;
      const cannonActive = this.cannonHeld || performance.now() < this.cannonBurstUntil;
      while (cannonActive && this.cannonAccumulator >= 0.08) {
        this.cannonAccumulator -= 0.08;
        this.fireCannon(snapshot);
      }
      if (!cannonActive) this.cannonAccumulator = 0;
    }

    this.latestSnapshot = snapshot;
    this.latestCamera = camera;
    this.updatePanel(false);
  }

  private latestSnapshot: AircraftSnapshot | null = null;
  private latestCamera: CameraState | null = null;

  private selectLandingSite(id: string): void {
    const site = SITE_MARKERS.find((item) => item.id === id);
    if (!site) return;
    this.landingSiteId = site.id;
    window.dispatchEvent(new CustomEvent('cfs:landing-site-select', { detail: { id: site.id } }));
    this.setMessage(`${site.name} · 降落導引啟用`, 1800);
    this.lastUiSignature = '';
    this.updatePanel(true);
  }

  private selectedContact(): CombatContact | undefined {
    return this.selectedTargetId ? this.simulation.getContact(this.selectedTargetId) : undefined;
  }

  private selectContact(id: string): void {
    const contact = this.simulation.getContact(id);
    if (!contact) return;
    this.selectedTargetId = id;
    this.focused = false;
    this.dispatchFocus();
    this.setMessage(`${contact.id} · ${contact.className} 已選取`, 1400);
    this.lastUiSignature = '';
    this.updatePanel(true);
  }

  private cycleContact(): void {
    const contacts = this.simulation.contacts.filter((contact) => contact.alive);
    if (contacts.length === 0) return;
    const index = contacts.findIndex((contact) => contact.id === this.selectedTargetId);
    this.selectContact(contacts[(index + 1) % contacts.length].id);
  }

  private toggleFocus(): void {
    const contact = this.selectedContact();
    if (!contact?.alive) {
      this.setMessage('無有效接觸點', 1600);
      return;
    }
    if (!this.withinRadarRange(contact)) {
      this.setMessage('目標超出目前雷達範圍', 1800);
      return;
    }
    this.focused = !this.focused;
    this.dispatchFocus();
    this.setMessage(this.focused ? `${contact.id} · LOCK` : '鎖定解除', 1400);
    this.lastUiSignature = '';
    this.updatePanel(true);
  }

  private dispatchFocus(): void {
    window.dispatchEvent(new CustomEvent('cfs:contact-select', {
      detail: { id: this.selectedTargetId, index: this.simulation.contacts.findIndex((item) => item.id === this.selectedTargetId) },
    }));
    window.dispatchEvent(new CustomEvent('cfs:contact-focus', { detail: { focused: this.focused } }));
  }

  private withinRadarRange(contact: CombatContact): boolean {
    if (!this.latestSnapshot) return false;
    const maxRange = this.radarRange * (0.65 + this.radarSensitivity * 0.7);
    return distanceBetween(contact.position, this.latestSnapshot.position) <= maxRange;
  }

  private launch(): void {
    if (document.body.dataset.mode !== 'flying' || !this.latestSnapshot) return;
    const spec = EQUIPMENT[this.equipment];
    if (!spec || this.ammo[this.equipment] <= 0 || this.cooldowns[this.equipment] > 0) {
      this.setMessage(this.ammo[this.equipment] <= 0 ? '裝備彈藥耗盡' : '裝備冷卻中', 1300);
      this.missileFlash = 0.12;
      return;
    }
    if (!this.focused || !this.selectedTargetId) {
      this.setMessage('請先選取雷達接觸點並鎖定', 1800);
      return;
    }
    const contact = this.selectedContact();
    if (!contact?.alive || !this.withinRadarRange(contact)) {
      this.focused = false;
      this.dispatchFocus();
      this.setMessage('鎖定中斷 · 目標超出雷達範圍', 1800);
      return;
    }
    const kind = this.equipmentKind(spec.category);
    if (kind !== contact.kind) {
      this.setMessage(kind === 'air' ? '此裝備僅適用空中接觸點' : '此裝備僅適用地面接觸點', 1800);
      return;
    }
    if (!this.simulation.fireMissile(this.latestSnapshot, contact.id, spec.color)) {
      this.setMessage('目標已失效，請重新選取', 1600);
      return;
    }
    this.ammo[this.equipment] -= 1;
    this.cooldowns[this.equipment] = spec.cooldown;
    this.missileFlash = 0.18;
    this.setMessage(`${spec.name} 發射 · ${contact.id}`, 1500);
    this.lastUiSignature = '';
    this.updatePanel(true);
    window.dispatchEvent(new CustomEvent('cfs:equipment-fire', { detail: { id: this.equipment, targetId: contact.id } }));
  }

  private equipmentKind(category: string): CombatTargetKind {
    return category.includes('AIR-TO-AIR') ? 'air' : 'ground';
  }

  private fireCannon(snapshot: AircraftSnapshot): void {
    const result = this.simulation.fireCannon(snapshot);
    if (!result.fired) {
      this.cannonHeld = false;
      this.cannonBurstUntil = 0;
      this.setMessage('機砲彈藥耗盡', 1800);
      return;
    }
    this.cannonFlash = 0.09;
    if (result.hitId) {
      const contact = this.simulation.getContact(result.hitId);
      this.setMessage(contact?.alive ? `${result.hitId} · 命中` : `${result.hitId} · 目標摧毀`, 1000);
      if (!contact?.alive) this.notifyDestroyed(contact);
    }
    this.lastUiSignature = '';
    this.updatePanel(true);
  }

  private notifyDestroyed(contact: CombatContact | undefined): void {
    if (!contact || this.notifiedDestroyed.has(contact.id)) return;
    this.notifiedDestroyed.add(contact.id);
    this.setMessage(`${contact.id} 摧毀 · 任務目標 ${this.simulation.destroyedCount}`, 2200);
    if (contact.kind === 'ground') window.dispatchEvent(new CustomEvent('cfs:terrain-damaged', { detail: { id: contact.id } }));
  }

  private setMessage(text: string, durationMs: number): void {
    this.message = text;
    this.messageUntil = performance.now() + durationMs;
    this.lastUiSignature = '';
  }

  private renderPanel(): void {
    this.updatePanel(true);
  }

  private updatePanel(force: boolean): void {
    const spec = EQUIPMENT[this.equipment];
    const contact = this.selectedContact();
    const remaining = this.ammo[this.equipment] ?? 0;
    const cooldown = this.cooldowns[this.equipment] ?? 0;
    const state = cooldown > 0 ? `冷卻 ${cooldown.toFixed(1)} s` : remaining > 0 ? 'READY' : 'EMPTY';
    const signature = [
      this.equipment, remaining, state, this.selectedTargetId, this.focused,
      contact?.health, contact?.alive, this.simulation.cannonRounds, this.simulation.destroyedCount,
      this.landingSiteId, this.landingApproachActive,
    ].join('|');
    if (!force && signature === this.lastUiSignature && performance.now() - this.lastUiTime < 150) return;
    this.lastUiSignature = signature;
    this.lastUiTime = performance.now();

    const readout = this.panel.querySelector<HTMLElement>('#dashboard-readout');
    if (readout) readout.textContent = `${spec.name} · ${remaining}/${spec.capacity} · ${state} · 機砲 ${this.simulation.cannonRounds}`;
    this.panel.style.setProperty('--equipment-color', spec.color);
    this.panel.dataset.state = remaining > 0 && cooldown <= 0 ? 'ready' : 'busy';
    const fire = this.panel.querySelector<HTMLButtonElement>('[data-fire]');
    if (fire) fire.disabled = !this.focused || !contact?.alive || !this.withinRadarRange(contact) || remaining <= 0 || cooldown > 0 || this.equipmentKind(spec.category) !== contact?.kind;

    const name = this.status.querySelector<HTMLElement>('#contact-name');
    const focus = this.status.querySelector<HTMLButtonElement>('#focus-state');
    const hint = this.status.querySelector<HTMLElement>('#radar-hint');
    const radarReadout = this.status.querySelector<HTMLElement>('#radar-readout');
    if (name) {
      const range = contact && this.latestSnapshot ? distanceBetween(contact.position, this.latestSnapshot.position) / 1000 : 0;
      name.textContent = contact
        ? `${contact.id} · ${contact.className} · ${contact.alive ? `${range.toFixed(1)} km` : 'DESTROYED'}`
        : '沒有有效接觸點';
    }
    if (focus) {
      focus.textContent = this.focused ? '已鎖定' : '鎖定';
      focus.dataset.active = String(this.focused);
      focus.disabled = !contact?.alive || !this.withinRadarRange(contact);
    }
    this.status.dataset.focused = String(this.focused);
    if (hint) hint.textContent = contact?.alive
      ? `${this.withinRadarRange(contact) ? (this.focused ? 'LOCK VALID' : '選取後鎖定，再發射') : '目標超出雷達範圍'} · ${this.equipmentKind(spec.category) === contact.kind ? '裝備相符' : (this.equipmentKind(spec.category) === 'air' ? '請選空中目標' : '請選地面目標')} · ${contact.health} HP · 點降落信標啟用進場`
      : '按 Tab 或點選接觸點切換目標；點降落信標啟用進場';
    if (radarReadout) radarReadout.textContent = `${Math.round(this.radarRange / 1000)} KM`;
    const feedback = this.panel.querySelector<HTMLElement>('#combat-feedback');
    if (feedback) feedback.textContent = performance.now() < this.messageUntil
      ? this.message
      : 'F 發射 · 按住 G 機砲 · Tab 切換目標';

    const actions = this.status.querySelector<HTMLElement>('#contact-actions');
    const contactSignature = this.simulation.contacts.map((item) => `${item.id}:${item.alive}`).join('|');
    if (actions && contactSignature !== this.lastContactsSignature) {
      this.lastContactsSignature = contactSignature;
      const buttons = this.simulation.contacts.map((item) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.contactId = item.id;
        button.dataset.active = String(item.id === this.selectedTargetId);
        button.dataset.destroyed = String(!item.alive);
        button.textContent = item.id;
        button.title = `${item.className} · ${item.kind === 'air' ? '空中' : '地面'} · ${item.alive ? `${item.health} HP` : '已摧毀'}`;
        button.disabled = !item.alive;
        return button;
      });
      actions.replaceChildren(...buttons);
    }
    if (actions) {
      actions.querySelectorAll<HTMLButtonElement>('[data-contact-id]').forEach((button) => {
        const item = this.simulation.getContact(button.dataset.contactId ?? '');
        button.dataset.active = String(item?.id === this.selectedTargetId);
        button.dataset.destroyed = String(!item?.alive);
        button.disabled = !item?.alive;
      });
    }
    const landingActions = this.status.querySelector<HTMLElement>('#landing-beacon-actions');
    landingActions?.querySelectorAll<HTMLButtonElement>('[data-landing-id]').forEach((button) => {
      button.dataset.active = String(button.dataset.landingId === this.landingSiteId && this.landingApproachActive);
    });
    this.drawRadar();
  }

  private drawRadar(): void {
    const radar = this.status.querySelector<HTMLCanvasElement>('#combat-radar');
    const snapshot = this.latestSnapshot;
    if (!radar || !snapshot || !this.initialized) return;
    const ctx = radar.getContext('2d');
    if (!ctx) return;
    const { width, height } = radar;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.42;
    const forward = quatRotate(snapshot.orientation, [1, 0, 0]);
    const right = quatRotate(snapshot.orientation, [0, 0, 1]);
    const range = this.radarRange * (0.65 + this.radarSensitivity * 0.7);
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.strokeStyle = 'rgba(125,255,154,.25)';
    ctx.lineWidth = 1;
    for (const scale of [0.33, 0.66, 1]) {
      ctx.beginPath(); ctx.arc(cx, cy, radius * scale, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy); ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius); ctx.stroke();
    ctx.fillStyle = '#7dff9a';
    ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
    const sweep = performance.now() / 1200;
    ctx.strokeStyle = 'rgba(125,255,154,.55)';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(sweep) * radius, cy - Math.cos(sweep) * radius); ctx.stroke();

    for (const contact of this.simulation.contacts) {
      if (!contact.alive) continue;
      const offset = relative(contact.position, snapshot.position);
      const ahead = dot(offset, forward);
      const across = dot(offset, right);
      const distance = Math.hypot(ahead, across);
      if (distance > range) continue;
      const scale = distance / range;
      const x = cx + (across / Math.max(distance, 1)) * radius * scale;
      const y = cy - (ahead / Math.max(distance, 1)) * radius * scale;
      ctx.fillStyle = contact.id === this.selectedTargetId ? '#ffc56b' : contact.kind === 'air' ? '#7de7ff' : '#ff9878';
      ctx.fillRect(x - 3, y - 3, 6, 6);
      if (contact.id === this.selectedTargetId) {
        ctx.strokeStyle = this.focused ? '#7dff9a' : '#ffc56b';
        ctx.strokeRect(x - 6, y - 6, 12, 12);
      }
    }
    for (const site of SITE_MARKERS) {
      const offset: Vec3 = [site.x - snapshot.position[0], 0, site.z - snapshot.position[2]];
      const ahead = dot(offset, forward);
      const across = dot(offset, right);
      const distance = Math.hypot(ahead, across);
      if (distance > range) continue;
      const scale = distance / range;
      const x = cx + (across / Math.max(distance, 1)) * radius * scale;
      const y = cy - (ahead / Math.max(distance, 1)) * radius * scale;
      const active = site.id === this.landingSiteId && this.landingApproachActive;
      ctx.strokeStyle = active ? '#7dff9a' : '#f4f7f2';
      ctx.lineWidth = active ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, y - 5);
      ctx.lineTo(x + 5, y);
      ctx.lineTo(x, y + 5);
      ctx.lineTo(x - 5, y);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  private project(position: Vec3, camera: CameraState, width: number, height: number): ProjectedPoint | null {
    const offset = relative(position, camera.position);
    const depth = dot(offset, camera.forward);
    if (depth <= 2) return null;
    const tan = Math.tan(camera.fovY / 2);
    const x = dot(offset, camera.right) / (depth * tan * (width / height));
    const y = dot(offset, camera.up) / (depth * tan);
    return { x: width * (0.5 + x * 0.5), y: height * (0.5 - y * 0.5), depth };
  }

  private readonly frame = (now: number): void => {
    const dt = Math.min((now - this.lastFrameTime) / 1000, 0.05);
    this.lastFrameTime = now;
    this.cannonFlash = Math.max(0, this.cannonFlash - dt);
    this.missileFlash = Math.max(0, this.missileFlash - dt);
    const mode = document.body.dataset.mode ?? '';
    if (mode === 'menu' && this.lastMode !== 'menu') this.resetFlight();
    this.lastMode = mode;
    this.resizeAndDraw(mode, now);
    if (now - this.lastUiTime > 150) this.updatePanel(false);
    requestAnimationFrame(this.frame);
  };

  private resizeAndDraw(mode: string, now: number): void {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const visible = mode === 'flying' || mode === 'crashed';
    this.panel.hidden = !visible;
    this.status.hidden = !visible;
    this.reticle.hidden = !visible;
    if (!visible || !this.latestSnapshot || !this.latestCamera) return;

    const camera = this.latestCamera;
    const cx = w / 2;
    const cy = h / 2;
    if (this.cannonFlash > 0) {
      const amount = this.cannonFlash / 0.09;
      ctx.save();
      ctx.globalAlpha = amount * 0.6;
      ctx.strokeStyle = '#ffe7a3';
      ctx.beginPath(); ctx.arc(cx, cy, 8 + (1 - amount) * 16, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    if (this.missileFlash > 0) {
      ctx.save();
      ctx.globalAlpha = this.missileFlash / 0.18;
      ctx.fillStyle = '#ffc56b';
      ctx.beginPath(); ctx.arc(cx, cy + h * 0.2, 5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    for (const contact of this.simulation.contacts) {
      if (!contact.alive) continue;
      const point = this.project(contact.position, camera, w, h);
      if (!point || point.x < -40 || point.x > w + 40 || point.y < -40 || point.y > h + 40) continue;
      const selected = contact.id === this.selectedTargetId;
      const color = this.focused && selected ? '#7dff9a' : selected ? '#ffc56b' : contact.kind === 'air' ? '#7de7ff' : '#ff9878';
      const size = clamp(2400 / point.depth, 7, 18);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = selected ? 1.8 : 1.2;
      ctx.globalAlpha = Math.max(0.35, 1 - point.depth / 30_000);
      ctx.beginPath();
      ctx.moveTo(point.x, point.y - size);
      ctx.lineTo(point.x + size, point.y);
      ctx.lineTo(point.x, point.y + size);
      ctx.lineTo(point.x - size, point.y);
      ctx.closePath();
      ctx.stroke();
      if (selected) {
        const distance = this.latestSnapshot ? distanceBetween(contact.position, this.latestSnapshot.position) : 0;
        ctx.font = '11px ui-monospace, Menlo, monospace';
        ctx.fillText(`${contact.id} · ${(distance / 1000).toFixed(1)} KM · ${contact.health} HP`, point.x + size + 8, point.y - 5);
        if (this.focused) {
          ctx.beginPath();
          ctx.arc(point.x, point.y, size + 8, -Math.PI * 0.75, Math.PI * 0.75);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    for (const missile of this.simulation.missiles) {
      const point = this.project(missile.position, camera, w, h);
      if (!point || point.x < -10 || point.x > w + 10 || point.y < -10 || point.y > h + 10) continue;
      ctx.save();
      ctx.fillStyle = missile.color;
      ctx.shadowColor = missile.color;
      ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(point.x, point.y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    for (const impact of this.simulation.impacts) {
      const point = this.project(impact.position, camera, w, h);
      if (!point || point.x < -60 || point.x > w + 60 || point.y < -60 || point.y > h + 60) continue;
      const fade = impact.age < 0.8 ? 1 : 0.72;
      const radius = clamp(impact.radius * 120 / point.depth, 3, 28);
      ctx.save();
      ctx.globalAlpha = fade * 0.68;
      ctx.fillStyle = '#17120e';
      ctx.strokeStyle = impact.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(point.x, point.y, radius, radius * 0.45, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    if (now < this.messageUntil) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = '600 13px ui-monospace, Menlo, monospace';
      ctx.fillStyle = '#d9f7e1';
      ctx.shadowColor = '#00140b';
      ctx.shadowBlur = 5;
      ctx.fillText(this.message, cx, h * 0.69);
      ctx.restore();
    }
  }
}
