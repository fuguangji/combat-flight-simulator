/**
 * Fictional arcade payload presentation.
 *
 * These are non-guided, screen-space visual effects only. They are not connected
 * to contacts, world coordinates, collision, damage, sensors, tracking or guidance.
 */
type EquipmentId = string;
type Contact = { id: string; className: string };
type VisualEffect = { age: number; equipment: EquipmentId };
import weaponCatalog from './weapons.json';

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
  private equipment: EquipmentId = 'nova17';
  private ammo: Record<EquipmentId, number> = Object.fromEntries(weaponCatalog.map((weapon) => [weapon.id, weapon.capacity]));
  private cooldowns: Record<EquipmentId, number> = Object.fromEntries(weaponCatalog.map((weapon) => [weapon.id, 0]));
  private previousMode = '';
  private lastTime = performance.now();
  private flash = 0;
  private cannonFlash = 0;
  private contactIndex = 0;
  private focused = false;
  private lastPanelSignature = '';
  private autopilotEnabled = false;

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
        <button type="button" data-fire>發射展示</button>
        <button type="button" data-autopilot>自動駕駛：OFF</button>
      </div>
      <div class="dashboard-note">螢幕空間視覺演出 · 不含目標、碰撞或地形作用</div>
    `;
    this.status = document.createElement('div');
    this.status.id = 'contact-status';
    this.status.innerHTML = `
      <div class="combat-head"><span>CONTACT DISPLAY</span><span>SIM / TRAINING</span></div>
      <div class="combat-section"><small>TRAINING CONTACTS</small><div class="contact-actions">
        <button type="button" data-contact="0">ECHO-01</button>
        <button type="button" data-contact="1">ECHO-02</button>
        <button type="button" data-contact="2">ECHO-03</button>
      </div></div>
      <div class="combat-focus"><span id="contact-name">ECHO-01 · DRONE</span><button type="button" id="focus-state" data-focus="toggle">NO FOCUS</button></div>
      <div class="combat-hint">接觸點僅供介面操作練習，不含感測或追蹤</div>
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
      if (target.hasAttribute('data-autopilot')) window.dispatchEvent(new Event('cfs:autopilot-toggle'));
    });
    this.status.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement)) return;
      if (target.dataset.contact) this.selectContact(Number(target.dataset.contact));
      if (target.dataset.focus) this.toggleFocus();
    });
    window.addEventListener('cfs:missile-launch', () => this.launch());
    window.addEventListener('cfs:cannon-trigger', () => this.triggerCannonPresentation());
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
    this.renderPanel();
    window.dispatchEvent(new CustomEvent('cfs:contact-select', { detail: { index: this.contactIndex } }));
  }
  private toggleFocus(): void {
    this.focused = !this.focused;
    this.renderPanel();
    window.dispatchEvent(new CustomEvent('cfs:contact-focus', { detail: { focused: this.focused } }));
  }

  private triggerCannonPresentation(): void {
    if (document.body.dataset.mode !== 'flying') return;
    // Decorative reticle flash only. No rounds, projectile motion, aim ray, collision or damage.
    this.cannonFlash = 0.11;
  }

  private launch(): void {
    const spec = EQUIPMENT[this.equipment];
    if (this.ammo[this.equipment] <= 0 || this.cooldowns[this.equipment] > 0) {
      this.flash = 0.16;
      return;
    }
    // Fixed-position HUD pulse only: no projectile path, target interaction or impact.
    this.active.push({ age: 0, equipment: this.equipment });
    this.ammo[this.equipment] -= 1;
    this.cooldowns[this.equipment] = spec.cooldown;
    this.flash = 0.12;
    this.lastPanelSignature = '';
    this.renderPanel();
    window.dispatchEvent(new CustomEvent('cfs:equipment-fire', { detail: { id: this.equipment } }));
  }

  private renderPanel(): void {
    const spec = EQUIPMENT[this.equipment];
    const remaining = this.ammo[this.equipment];
    const state = this.cooldowns[this.equipment] > 0 ? 'RECHARGING' : remaining > 0 ? 'READY' : 'EMPTY';
    const signature = [this.equipment, remaining, state, this.contactIndex, this.focused].join('|');
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
      if (focus) focus.textContent = this.focused ? 'FOCUS SELECTED' : 'NO FOCUS';
      this.status.dataset.focused = String(this.focused);
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
      this.focused = false;
      this.contactIndex = 0;
      this.autopilotEnabled = false;
      this.lastPanelSignature = '';
      const ap = this.panel.querySelector<HTMLButtonElement>('[data-autopilot]');
      if (ap) { ap.textContent = '自動駕駛：OFF'; ap.dataset.active = 'false'; }
    }
    this.previousMode = mode;
    if (mode === 'flying') {
      for (const id of Object.keys(this.cooldowns) as EquipmentId[]) this.cooldowns[id] = Math.max(0, this.cooldowns[id] - dt);
      for (const effect of this.active) effect.age += dt;
      for (let i = this.active.length - 1; i >= 0; i--) {
        if (this.active[i].age >= EQUIPMENT[this.active[i].equipment].life) this.active.splice(i, 1);
      }
      this.flash = Math.max(0, this.flash - dt);
      this.cannonFlash = Math.max(0, this.cannonFlash - dt);
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
      const x = cx;
      const y = cy + h * 0.20;
      const radius = 10 + t * 34;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t) * 0.88;
      ctx.strokeStyle = spec.color;
      ctx.fillStyle = spec.color;
      ctx.lineWidth = 2.2;
      ctx.shadowColor = spec.color;
      ctx.shadowBlur = 14;
      if (effect.equipment === 'nova17') {
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();
        for (let i = 0; i < 8; i++) {
          const a = i * Math.PI / 4;
          ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * (radius + 4), y + Math.sin(a) * (radius + 4));
          ctx.lineTo(x + Math.cos(a) * (radius + 12), y + Math.sin(a) * (radius + 12)); ctx.stroke();
        }
      } else if (effect.equipment === 'meteor88' || effect.equipment === 'phoenix54') {
        for (let i = 0; i < (effect.equipment === 'phoenix54' ? 4 : 2); i++) {
          ctx.beginPath(); ctx.arc(x, y, radius * (0.45 + i * 0.28), 0, Math.PI * 2); ctx.stroke();
        }
      } else if (effect.equipment === 'hellfire09') {
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, radius * 0.45, 0, Math.PI * 2); ctx.stroke();
      } else if (effect.equipment === 'vortex33') {
        for (let i = 0; i < 3; i++) {
          ctx.beginPath(); ctx.arc(x, y, radius * (0.55 + i * 0.2), i * 1.7, i * 1.7 + Math.PI * 1.35); ctx.stroke();
        }
      } else if (effect.equipment === 'stinger05') {
        for (let i = 0; i < 8; i++) {
          const a = i * Math.PI / 4;
          ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * 5, y + Math.sin(a) * 5);
          ctx.lineTo(x + Math.cos(a) * radius, y + Math.sin(a) * radius); ctx.stroke();
        }
      } else if (effect.equipment === 'thunder66') {
        ctx.beginPath(); ctx.moveTo(x - radius, y); ctx.lineTo(x - radius * 0.45, y - 8);
        ctx.lineTo(x - 5, y + 7); ctx.lineTo(x + radius * 0.4, y - 8);
        ctx.lineTo(x + radius, y); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, radius * 0.7, 0, Math.PI * 2); ctx.stroke();
      } else if (effect.equipment === 'gungnir01') {
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(x, y - radius); ctx.lineTo(x, y + radius); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, radius * 0.62, 0, Math.PI * 2); ctx.stroke();
      } else if (effect.equipment === 'frostbite12') {
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, radius * 0.72, 0, Math.PI * 2); ctx.stroke();
      } else if (effect.equipment === 'ironhammer20') {
        ctx.strokeRect(x - radius, y - radius, radius * 2, radius * 2);
        ctx.beginPath(); ctx.arc(x, y, radius * 0.55, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
    if (this.cannonFlash > 0) {
      const pulse = this.cannonFlash / 0.11;
      const x = cx;
      const y = cy + h * 0.20;
      ctx.save();
      ctx.globalAlpha = pulse * 0.72;
      ctx.strokeStyle = '#ffe7a3';
      ctx.fillStyle = '#fff3c7';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#ffc56b';
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(x, y, 8 + (1 - pulse) * 12, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(angle) * 5, y + Math.sin(angle) * 5);
        ctx.lineTo(x + Math.cos(angle) * (15 + (1 - pulse) * 8), y + Math.sin(angle) * (15 + (1 - pulse) * 8));
        ctx.stroke();
      }
      ctx.restore();
    }
    if (this.flash > 0) {
      ctx.save(); ctx.globalAlpha = Math.min(0.35, this.flash * 2);
      ctx.fillStyle = EQUIPMENT[this.equipment].color;
      ctx.fillRect(cx - 2, cy + h * 0.18, 4, 4); ctx.restore();
    }
  }
}
