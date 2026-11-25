/**
 * Fictional arcade payload presentation.
 *
 * These are non-guided, screen-space visual effects only. They are not connected
 * to contacts, world coordinates, collision, damage, sensors, tracking or guidance.
 */
type EquipmentId = string;
type Contact = { id: string; className: string };
type VisualEffect = { age: number; lane: number; equipment: EquipmentId; x: number; y: number; vx: number; vy: number };
type TerrainMark = { x: number; age: number; radius: number };
type MissileVisual = { age: number; id: string; targetIndex: number; endX: number; endY: number };
import weaponCatalog from './weapons.json';
import missileCatalog from './missiles.json';

const EQUIPMENT: Record<EquipmentId, { name: string; short: string; capacity: number; cooldown: number; color: string; life: number }> = Object.fromEntries(
  weaponCatalog.map((weapon) => [weapon.id, {
    name: weapon.name,
    short: weapon.id.toUpperCase(),
    capacity: weapon.capacity,
    cooldown: weapon.cooldown,
    color: weapon.color,
    life: weapon.life,
  }]),
);
const MISSILES = Object.fromEntries(missileCatalog.map((missile) => [missile.id, missile]));
type MissileId = keyof typeof MISSILES;
const CONTACTS: Contact[] = [
  { id: 'ECHO-01', className: 'DRONE' },
  { id: 'ECHO-02', className: 'DRONE' },
  { id: 'ECHO-03', className: 'BEACON' },
];

export class ArcadeProjectileSystem {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly panel: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly reticle: HTMLDivElement;
  private readonly active: VisualEffect[] = [];
  private readonly activeMissiles: MissileVisual[] = [];
  /** Persistent arcade crater decals; these are presentation marks, not a physical heightfield. */
  private readonly terrainMarks: TerrainMark[] = [];
  private equipment: EquipmentId = 'nova17';
  private ammo: Record<EquipmentId, number> = Object.fromEntries(weaponCatalog.map((weapon) => [weapon.id, weapon.capacity]));
  private cooldowns: Record<EquipmentId, number> = Object.fromEntries(weaponCatalog.map((weapon) => [weapon.id, 0]));
  private previousMode = '';
  private lastTime = performance.now();
  private flash = 0;
  private contactIndex = 0;
  private focused = false;
  private lastPanelSignature = '';
  private autopilotEnabled = false;
  private selectedMissile: MissileId = missileCatalog[0].id as MissileId;
  private missileAmmo: Record<string, number> = Object.fromEntries(missileCatalog.map((m) => [m.id, m.capacity]));
  private missileCooldowns: Record<string, number> = Object.fromEntries(missileCatalog.map((m) => [m.id, 0]));
  private focusProgress = 0;

  constructor() {
    const initial = document.body.dataset.equipment as EquipmentId | undefined;
    if (initial && EQUIPMENT[initial]) this.equipment = initial;

    this.canvas = document.createElement('canvas');
    this.canvas.id = 'projectile-effects';
    this.panel = document.createElement('div');
    this.panel.id = 'cockpit-dashboard';
    this.panel.innerHTML = `
      <div class="dashboard-heading"><span>COCKPIT / STORES</span><span>SIM</span></div>
      <div class="dashboard-readout" id="dashboard-readout"></div>
      <div class="dashboard-controls">
        <button type="button" data-fire>發射裝備</button>
        <button type="button" data-missile-fire>發射導彈</button>
        <button type="button" data-autopilot>自動駕駛：OFF</button>
      </div>
      <div class="dashboard-note">虛構街機物理 · 地表破壞為持續視覺印記</div>
    `;
    this.status = document.createElement('div');
    this.status.id = 'contact-status';
    this.status.innerHTML = `
      <div class="combat-head"><span>CONTACT DISPLAY</span><span>SIM / TRAINING</span></div>
      <div class="combat-section"><small>MISSILE CATALOG / 導彈配置</small><select data-missile-select aria-label="選擇虛構導彈"></select></div>
      <div class="combat-section"><small>ARCADE TRAINING CONTACTS</small><div class="contact-actions">
        <button type="button" data-contact="0">ECHO-01</button>
        <button type="button" data-contact="1">ECHO-02</button>
        <button type="button" data-contact="2">ECHO-03</button>
      </div></div>
      <div class="combat-focus"><span id="contact-name">ECHO-01 · DRONE</span><button type="button" id="focus-state" data-focus="toggle">FOCUS</button></div>
      <div class="guidance-track"><i id="guidance-progress"></i></div>
      <div id="guidance-readout" class="guidance-readout">ARCADE ASSIST / STANDBY</div>
      <div class="combat-hint">純介面進度與預設動畫路徑；不使用真實感測、追蹤或武器導引</div>
    `;
    this.reticle = document.createElement('div');
    this.reticle.id = 'view-reticle';
    this.reticle.setAttribute('aria-hidden', 'true');
    this.reticle.innerHTML = '<i></i><b></b>';
    document.body.append(this.canvas, this.panel, this.status, this.reticle);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Equipment effect canvas unavailable');
    this.ctx = ctx;

    this.panel.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement)) return;
      if (target.hasAttribute('data-fire')) this.launch();
      if (target.hasAttribute('data-missile-fire')) this.launchMissile();
      if (target.hasAttribute('data-autopilot')) window.dispatchEvent(new Event('cfs:autopilot-toggle'));
    });
    this.status.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement)) return;
      if (target.dataset.contact) this.selectContact(Number(target.dataset.contact));
      if (target.dataset.focus) this.toggleFocus();
    });
    const missileSelect = this.status.querySelector<HTMLSelectElement>('[data-missile-select]');
    if (missileSelect) {
      for (const missile of missileCatalog) missileSelect.add(new Option(missile.name, missile.id));
      missileSelect.value = this.selectedMissile;
      missileSelect.addEventListener('change', () => {
        if (MISSILES[missileSelect.value]) this.selectedMissile = missileSelect.value as MissileId;
        this.focused = false;
        this.focusProgress = 0;
        this.renderPanel();
      });
    }
    window.addEventListener('cfs:missile-launch', () => this.launchMissile());
    window.addEventListener('cfs:equipment-select', (event) => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id as EquipmentId | undefined;
      if (id && EQUIPMENT[id]) {
        this.equipment = id;
        this.lastPanelSignature = '';
        this.renderPanel();
      }
    });
    window.addEventListener('cfs:autopilot-state', (event) => {
      this.autopilotEnabled = Boolean((event as CustomEvent<{ enabled?: boolean }>).detail?.enabled);
      const button = this.panel.querySelector<HTMLButtonElement>('[data-autopilot]');
      if (button) {
        button.textContent = this.autopilotEnabled ? '自動駕駛：ON' : '自動駕駛：OFF';
        button.dataset.active = String(this.autopilotEnabled);
      }
    });
    this.renderPanel();
    requestAnimationFrame(this.frame);
  }

  private selectContact(index: number): void {
    this.contactIndex = (index + CONTACTS.length) % CONTACTS.length;
    this.focused = false;
    this.focusProgress = 0;
    this.status.dataset.lockBlocked = 'false';
    this.renderPanel();
  }
  private toggleFocus(): void {
    this.focused = !this.focused;
    if (!this.focused) this.focusProgress = 0;
    this.status.dataset.lockBlocked = 'false';
    this.renderPanel();
  }

  private launch(): void {
    const spec = EQUIPMENT[this.equipment];
    if (this.ammo[this.equipment] <= 0 || this.cooldowns[this.equipment] > 0) {
      this.flash = 0.16;
      return;
    }
    // Decorative screen-space animation only; it never travels toward a target.
    const lane = (this.active.length % 2 ? -1 : 1) * 0.018;
    this.active.push({ age: 0, lane, equipment: this.equipment, x: 0.5 + lane, y: 0.72, vx: lane * 0.32, vy: -0.78 });
    this.ammo[this.equipment] -= 1;
    this.cooldowns[this.equipment] = spec.cooldown;
    this.flash = 0.12;
    this.lastPanelSignature = '';
    this.renderPanel();
  }

  private launchMissile(): void {
    const spec = MISSILES[this.selectedMissile];
    if (!spec || this.missileAmmo[this.selectedMissile] <= 0 || this.missileCooldowns[this.selectedMissile] > 0) {
      this.flash = 0.16;
      return;
    }
    if (spec.lockRequired && this.focusProgress < 1) {
      this.status.dataset.lockBlocked = 'true';
      this.flash = 0.16;
      this.renderPanel();
      return;
    }
    // Screen-space authored path to fixed UI anchors only. No world coordinates,
    // sensor data, homing, steering law, target state or physical interception.
    const anchors = [0.3, 0.5, 0.7];
    this.activeMissiles.push({
      age: 0,
      id: this.selectedMissile,
      targetIndex: this.contactIndex,
      endX: spec.lockRequired ? anchors[this.contactIndex] : 0.5,
      endY: spec.lockRequired ? 0.27 : 0.42,
    });
    this.missileAmmo[this.selectedMissile] -= 1;
    this.missileCooldowns[this.selectedMissile] = spec.cooldown;
    this.focused = false;
    this.focusProgress = 0;
    this.status.dataset.lockBlocked = 'false';
    this.flash = 0.12;
    this.lastPanelSignature = '';
    this.renderPanel();
  }

  private renderPanel(): void {
    const spec = EQUIPMENT[this.equipment];
    const remaining = this.ammo[this.equipment];
    const state = this.cooldowns[this.equipment] > 0 ? 'RECHARGING' : remaining > 0 ? 'READY' : 'EMPTY';
    const missile = MISSILES[this.selectedMissile];
    const missileRemaining = this.missileAmmo[this.selectedMissile];
    const missileState = this.missileCooldowns[this.selectedMissile] > 0 ? 'RECHARGING' : missileRemaining > 0 ? 'READY' : 'EMPTY';
    const signature = [this.equipment, remaining, state, this.contactIndex, this.focused, this.focusProgress.toFixed(2), this.selectedMissile, missileRemaining, missileState].join('|');
    if (signature !== this.lastPanelSignature) {
      this.lastPanelSignature = signature;
      const readout = this.panel.querySelector('#dashboard-readout');
      if (readout) readout.textContent = `${spec.name}  ·  ${String(remaining).padStart(2, '0')} / ${spec.capacity}  ·  ${state}`;
      this.panel.style.setProperty('--equipment-color', spec.color);
      this.panel.dataset.state = remaining > 0 && this.cooldowns[this.equipment] <= 0 ? 'ready' : 'busy';
      const contact = CONTACTS[this.contactIndex];
      const name = this.status.querySelector('#contact-name');
      const focus = this.status.querySelector('#focus-state');
      if (name) name.textContent = `${contact.id} · ${contact.className}`;
      if (focus) focus.textContent = this.focused ? 'FOCUS ACTIVE' : 'FOCUS';
      const progress = this.status.querySelector<HTMLElement>('#guidance-progress');
      const guidance = this.status.querySelector<HTMLElement>('#guidance-readout');
      if (progress) progress.style.width = String(Math.round(this.focusProgress * 100)) + '%';
      if (guidance) guidance.textContent = missile.lockRequired
        ? 'ARCADE ASSIST · ' + Math.round(this.focusProgress * 100) + '% · ' + missileState + ' · ' + missileRemaining + '/' + missile.capacity
        : 'AREA EFFECT · ' + missileState + ' · ' + missileRemaining + '/' + missile.capacity;
      const selector = this.status.querySelector<HTMLSelectElement>('[data-missile-select]');
      if (selector && selector.value !== this.selectedMissile) selector.value = this.selectedMissile;
      this.status.dataset.focused = String(this.focused);
      this.status.dataset.locked = String(this.focusProgress >= 1);
      this.status.dataset.lockBlocked = this.status.dataset.lockBlocked || 'false';
      this.status.querySelectorAll<HTMLButtonElement>('[data-contact]').forEach((button) => {
        button.dataset.active = String(Number(button.dataset.contact) === this.contactIndex);
      });
    }
  }

  private readonly frame = (now: number): void => {
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    const mode = document.body.dataset.mode ?? '';
    if (mode === 'menu' && this.previousMode !== 'menu') {
      this.ammo = Object.fromEntries(weaponCatalog.map((weapon) => [weapon.id, weapon.capacity]));
      this.cooldowns = Object.fromEntries(weaponCatalog.map((weapon) => [weapon.id, 0]));
      this.active.length = 0;
      this.activeMissiles.length = 0;
      this.terrainMarks.length = 0;
      this.missileAmmo = Object.fromEntries(missileCatalog.map((m) => [m.id, m.capacity]));
      this.missileCooldowns = Object.fromEntries(missileCatalog.map((m) => [m.id, 0]));
      this.focused = false;
      this.focusProgress = 0;
      this.contactIndex = 0;
      this.autopilotEnabled = false;
      this.lastPanelSignature = '';
      const ap = this.panel.querySelector<HTMLButtonElement>('[data-autopilot]');
      if (ap) { ap.textContent = '自動駕駛：OFF'; ap.dataset.active = 'false'; }
    }
    this.previousMode = mode;
    if (mode === 'flying') {
      for (const id of Object.keys(this.cooldowns) as EquipmentId[]) this.cooldowns[id] = Math.max(0, this.cooldowns[id] - dt);
      for (const id of Object.keys(this.missileCooldowns)) this.missileCooldowns[id] = Math.max(0, this.missileCooldowns[id] - dt);
      if (this.focused) this.focusProgress = Math.min(1, this.focusProgress + dt * 0.72);
      for (const effect of this.active) {
        effect.age += dt;
        // Deliberately arcade-only screen-space kinematics: capped drift and a soft curve.
        // No target selection, homing, sensor input or real-world propulsion model.
        effect.x += effect.vx * dt;
        effect.y += effect.vy * dt;
        effect.vy += 0.16 * dt;
        effect.vx *= Math.exp(-0.18 * dt);
      }
      for (let i = this.active.length - 1; i >= 0; i--) {
        const effect = this.active[i];
        if (effect.age >= EQUIPMENT[effect.equipment].life || effect.y < 0.06 || effect.x < 0.04 || effect.x > 0.96) {
          this.terrainMarks.push({ x: Math.max(0.08, Math.min(0.92, effect.x)), age: 0, radius: 8 + (effect.equipment === 'ironhammer20' ? 12 : 0) });
          this.active.splice(i, 1);
        }
      }
      for (const missile of this.activeMissiles) missile.age += dt;
      for (let i = this.activeMissiles.length - 1; i >= 0; i--) {
        const missile = this.activeMissiles[i];
        if (missile.age >= MISSILES[missile.id].life) {
          this.terrainMarks.push({ x: missile.endX, age: 0, radius: 7 });
          this.activeMissiles.splice(i, 1);
        }
      }
      for (const mark of this.terrainMarks) mark.age += dt;
      for (let i = this.terrainMarks.length - 1; i >= 0; i--) if (this.terrainMarks[i].age > 45) this.terrainMarks.splice(i, 1);
      this.flash = Math.max(0, this.flash - dt);
    }
    this.resizeAndDraw(mode);
    this.renderPanel();
    requestAnimationFrame(this.frame);
  };

  private resizeAndDraw(mode: string): void {
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
    if (!visible) return;
    const cx = w / 2;
    const cy = h / 2;
    for (const effect of this.active) {
      const spec = EQUIPMENT[effect.equipment];
      const t = Math.min(1, effect.age / spec.life);
      const y = h * effect.y;
      const x = w * effect.x;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t) * 0.9;
      ctx.strokeStyle = spec.color;
      ctx.fillStyle = spec.color;
      ctx.lineWidth = effect.equipment === 'arc' ? 3.5 : 2.2;
      ctx.shadowColor = spec.color;
      ctx.shadowBlur = effect.equipment === 'prism' || effect.equipment === 'nova' ? 18 : 12;
      if (effect.equipment === 'arc') {
        // Stylised capsule silhouette with a luminous exhaust; no realistic internal geometry.
        ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(effect.vy, effect.vx) + Math.PI / 2);
        ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(6, 8); ctx.lineTo(0, 15); ctx.lineTo(-6, 8); ctx.closePath(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, 15); ctx.lineTo(0, 30 + Math.sin(effect.age * 24) * 4); ctx.stroke(); ctx.restore();
      } else if (effect.equipment === 'prism') {
        ctx.beginPath(); ctx.moveTo(x, y - 18); ctx.lineTo(x + 9, y); ctx.lineTo(x, y + 18); ctx.lineTo(x - 9, y); ctx.closePath(); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      } else if (effect.equipment === 'nova' || effect.equipment === 'vortex33' || effect.equipment === 'ironhammer20') {
        const radius = 7 + t * (effect.equipment === 'ironhammer20' ? 34 : 24);
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, radius * 0.48, 0, Math.PI * 2); ctx.stroke();
        if (effect.equipment === 'vortex33') { ctx.beginPath(); ctx.arc(x, y, radius * 0.72, t, t + Math.PI * 1.5); ctx.stroke(); }
      } else if (effect.equipment === 'lumen' || effect.equipment === 'frostbite12') {
        const rays = effect.equipment === 'frostbite12' ? 2 : 5;
        for (let ray = 0; ray < rays; ray++) {
          const offset = effect.equipment === 'frostbite12' ? (ray ? 7 : -7) : (ray - 2) * 5;
          ctx.beginPath(); ctx.moveTo(x + offset, y + 25); ctx.lineTo(x + offset * 0.5, y - 18); ctx.stroke();
        }
      } else if (effect.equipment === 'meteor88' || effect.equipment === 'phoenix54') {
        const spread = effect.equipment === 'phoenix54' ? 9 : 4;
        for (let ray = -1; ray <= 1; ray++) {
          ctx.beginPath(); ctx.moveTo(x + ray * spread, y + 36); ctx.lineTo(x + ray * spread * 0.35, y - 18); ctx.stroke();
        }
        if (effect.equipment === 'phoenix54') { ctx.beginPath(); ctx.arc(x, y + 12, 10 + t * 12, 0, Math.PI * 2); ctx.stroke(); }
      } else if (effect.equipment === 'hellfire09' || effect.equipment === 'stinger05') {
        ctx.beginPath(); ctx.moveTo(x, y + 30); ctx.lineTo(x, y - 12); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y - 12, effect.equipment === 'hellfire09' ? 7 : 3, 0, Math.PI * 2); ctx.stroke();
        if (effect.equipment === 'hellfire09') { ctx.beginPath(); ctx.arc(x, y - 12, 14 + t * 10, 0, Math.PI * 2); ctx.stroke(); }
      } else if (effect.equipment === 'thunder66') {
        ctx.beginPath(); ctx.moveTo(x, y + 25); ctx.lineTo(x - 12, y + 10); ctx.lineTo(x + 12, y - 4); ctx.lineTo(x - 8, y - 20); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, 20 + t * 8, 0, Math.PI * 2); ctx.stroke();
      } else if (effect.equipment === 'gungnir01') {
        ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x, y + 40); ctx.lineTo(x, y - 30); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y + 16, 10 + t * 16, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.moveTo(x, y + 34); ctx.lineTo(x, y - 8); ctx.stroke();
      }
      ctx.restore();
    }
    // Scripted 2D Bézier paths to fixed display anchors; presentation only.
    for (const missile of this.activeMissiles) {
      const spec = MISSILES[missile.id];
      const t = Math.min(1, missile.age / spec.life);
      const startX = 0.5, startY = 0.78;
      const controlX = (startX + missile.endX) * 0.5 + (missile.targetIndex - 1) * 0.12;
      const controlY = 0.12;
      const inv = 1 - t;
      const x = inv * inv * startX + 2 * inv * t * controlX + t * t * missile.endX;
      const y = inv * inv * startY + 2 * inv * t * controlY + t * t * missile.endY;
      const alpha = Math.max(0, 1 - t) * 0.95;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = spec.color;
      ctx.fillStyle = spec.color;
      ctx.shadowColor = spec.color;
      ctx.shadowBlur = 16;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(w * startX, h * startY);
      ctx.quadraticCurveTo(w * controlX, h * controlY, w * missile.endX, h * missile.endY);
      ctx.stroke();
      ctx.translate(w * x, h * y);
      const dx = 2 * inv * (controlX - startX) + 2 * t * (missile.endX - controlX);
      const dy = 2 * inv * (controlY - startY) + 2 * t * (missile.endY - controlY);
      ctx.rotate(Math.atan2(dy, dx) + Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(0, -12); ctx.lineTo(4, 5); ctx.lineTo(0, 10); ctx.lineTo(-4, 5); ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    // Persistent ground-damage decals: darkened centre, broken rim and fading dust ring.
    for (const mark of this.terrainMarks) {
      const alpha = Math.max(0, 1 - mark.age / 45) * 0.72;
      const mx = mark.x * w;
      const my = h * 0.88;
      ctx.save(); ctx.globalAlpha = alpha; ctx.lineWidth = 2;
      ctx.fillStyle = 'rgba(12,18,14,.78)'; ctx.strokeStyle = 'rgba(202,177,126,.8)';
      ctx.beginPath(); ctx.ellipse(mx, my, mark.radius * 1.8, mark.radius * 0.7, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(220,205,166,.5)'; ctx.beginPath(); ctx.ellipse(mx, my, mark.radius * (2.2 + mark.age * 0.01), mark.radius * (0.9 + mark.age * 0.004), 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    if (this.flash > 0) {
      ctx.save(); ctx.globalAlpha = Math.min(0.35, this.flash * 2);
      ctx.fillStyle = EQUIPMENT[this.equipment].color;
      ctx.fillRect(cx - 2, cy + h * 0.18, 4, 4); ctx.restore();
    }
  }
}
