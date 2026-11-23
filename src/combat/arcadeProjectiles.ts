/**
 * Fictional arcade equipment and contact-focus UI.
 *
 * Contacts are abstract training labels. Focus is a UI state only:
 * there is no sensor model, spatial acquisition, tracking, guidance, collision,
 * damage, or real-world weapon behavior.
 */
type EquipmentId = 'pulse' | 'arc' | 'prism';
type Contact = { id: string; className: string };
type VisualEffect = { age: number; lane: number; equipment: EquipmentId };

const EQUIPMENT: Record<EquipmentId, { short: string; capacity: number; cooldown: number; color: string; life: number }> = {
  pulse: { short: 'PULSE', capacity: 8, cooldown: 0.65, color: '#ffc56b', life: 0.72 },
  arc: { short: 'ARC', capacity: 5, cooldown: 1.05, color: '#7de7ff', life: 1.0 },
  prism: { short: 'PRISM', capacity: 3, cooldown: 1.45, color: '#d4a1ff', life: 1.25 },
};
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
  private readonly active: VisualEffect[] = [];
  private equipment: EquipmentId = 'pulse';
  private ammo: Record<EquipmentId, number> = { pulse: 8, arc: 5, prism: 3 };
  private cooldown = 0;
  private previousMode = '';
  private lastTime = performance.now();
  private flash = 0;
  private contactIndex = 0;
  private focused = false;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'projectile-effects';
    this.panel = document.createElement('div');
    this.panel.id = 'equipment-status';
    this.status = document.createElement('div');
    this.status.id = 'contact-status';
    this.status.innerHTML = `
      <div class="combat-head"><span>TACTICAL DISPLAY</span><span>SIM / TRAINING</span></div>
      <div class="combat-section"><small>EQUIPMENT</small><div class="combat-actions">
        <button type="button" data-equip="pulse">1 PULSE</button>
        <button type="button" data-equip="arc">2 ARC</button>
        <button type="button" data-equip="prism">3 PRISM</button>
      </div></div>
      <div class="combat-section"><small>CONTACT LIST</small><div class="contact-actions">
        <button type="button" data-contact="0">ECHO-01</button>
        <button type="button" data-contact="1">ECHO-02</button>
        <button type="button" data-contact="2">ECHO-03</button>
      </div></div>
      <div class="combat-focus"><span id="contact-name">ECHO-01 · DRONE</span><strong id="focus-state">NO FOCUS</strong></div>
      <div class="combat-hint">TAB：切換接觸點　T：切換焦點　F：觸發效果</div>
    `;
    document.body.append(this.canvas, this.panel, this.status);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Equipment effect canvas unavailable');
    this.ctx = ctx;

    window.addEventListener('keydown', (event) => {
      if (document.body.dataset.mode !== 'flying' || event.repeat) return;
      if (event.code === 'KeyF') { event.preventDefault(); this.launch(); }
      else if (event.code === 'Digit1') this.selectEquipment('pulse');
      else if (event.code === 'Digit2') this.selectEquipment('arc');
      else if (event.code === 'Digit3') this.selectEquipment('prism');
      else if (event.code === 'Tab') { event.preventDefault(); this.cycleContact(); }
      else if (event.code === 'KeyT') this.toggleFocus();
    });
    this.status.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement)) return;
      if (target.dataset.equip) this.selectEquipment(target.dataset.equip as EquipmentId);
      if (target.dataset.contact) this.selectContact(Number(target.dataset.contact));
    });
    requestAnimationFrame(this.frame);
  }

  private selectEquipment(id: EquipmentId): void {
    if (!EQUIPMENT[id]) return;
    this.equipment = id;
    this.cooldown = 0;
    this.renderPanel();
  }
  private selectContact(index: number): void {
    this.contactIndex = (index + CONTACTS.length) % CONTACTS.length;
    this.focused = false;
    this.renderPanel();
  }
  private cycleContact(): void { this.selectContact(this.contactIndex + 1); }
  private toggleFocus(): void { this.focused = !this.focused; this.renderPanel(); }

  private launch(): void {
    const spec = EQUIPMENT[this.equipment];
    if (this.ammo[this.equipment] <= 0 || this.cooldown > 0) { this.flash = 0.16; return; }
    // Cosmetic screen-space flourish only; it is not connected to the selected contact.
    this.active.push({ age: 0, lane: (this.active.length % 2 ? -1 : 1) * 0.018, equipment: this.equipment });
    this.ammo[this.equipment] -= 1;
    this.cooldown = spec.cooldown;
    this.flash = 0.12;
    this.renderPanel();
  }

  private renderPanel(): void {
    const spec = EQUIPMENT[this.equipment];
    const remaining = this.ammo[this.equipment];
    const state = this.cooldown > 0 ? 'RECHARGING' : remaining > 0 ? 'READY' : 'EMPTY';
    this.panel.textContent = `${spec.short}  ·  ${String(remaining).padStart(2, '0')} / ${spec.capacity}  ·  ${state}  ·  F`;
    this.panel.dataset.state = remaining > 0 && this.cooldown <= 0 ? 'ready' : 'busy';
    this.panel.style.setProperty('--equipment-color', spec.color);
    this.status.querySelectorAll<HTMLButtonElement>('[data-equip]').forEach((button) => {
      const id = button.dataset.equip as EquipmentId;
      button.dataset.active = String(id === this.equipment);
      button.textContent = `${id === 'pulse' ? '1 PULSE' : id === 'arc' ? '2 ARC' : '3 PRISM'} · ${this.ammo[id]}`;
    });
    this.status.querySelectorAll<HTMLButtonElement>('[data-contact]').forEach((button) => {
      button.dataset.active = String(Number(button.dataset.contact) === this.contactIndex);
    });
    const contact = CONTACTS[this.contactIndex];
    const name = this.status.querySelector('#contact-name');
    const focus = this.status.querySelector('#focus-state');
    if (name) name.textContent = `${contact.id} · ${contact.className}`;
    if (focus) focus.textContent = this.focused ? 'FOCUS SELECTED' : 'NO FOCUS';
    this.status.dataset.focused = String(this.focused);
  }

  private readonly frame = (now: number): void => {
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    const mode = document.body.dataset.mode ?? '';
    if (mode === 'menu' && this.previousMode !== 'menu') {
      this.ammo = { pulse: 8, arc: 5, prism: 3 };
      this.cooldown = 0;
      this.active.length = 0;
      this.focused = false;
      this.contactIndex = 0;
      this.equipment = 'pulse';
    }
    this.previousMode = mode;
    if (mode === 'flying') {
      this.cooldown = Math.max(0, this.cooldown - dt);
      for (const effect of this.active) effect.age += dt;
      for (let i = this.active.length - 1; i >= 0; i--) {
        if (this.active[i].age >= EQUIPMENT[this.active[i].equipment].life) this.active.splice(i, 1);
      }
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
    if (!visible) return;
    const cx = w / 2;
    const cy = h / 2;
    for (const effect of this.active) {
      const spec = EQUIPMENT[effect.equipment];
      const t = Math.min(1, effect.age / spec.life);
      const y = h * (0.72 - t * 0.64);
      const x = cx + effect.lane * w * (0.2 + t);
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t) * 0.9;
      ctx.strokeStyle = spec.color;
      ctx.fillStyle = spec.color;
      ctx.lineWidth = effect.equipment === 'pulse' ? 2.5 : effect.equipment === 'arc' ? 3.5 : 1.8;
      ctx.shadowColor = spec.color;
      ctx.shadowBlur = effect.equipment === 'prism' ? 18 : 12;
      if (effect.equipment === 'arc') {
        ctx.beginPath(); ctx.moveTo(x, y + 26); ctx.lineTo(x - 7, y + 10);
        ctx.lineTo(x + 6, y - 2); ctx.lineTo(x - 4, y - 18); ctx.stroke();
      } else if (effect.equipment === 'prism') {
        ctx.beginPath(); ctx.moveTo(x, y - 18); ctx.lineTo(x + 9, y);
        ctx.lineTo(x, y + 18); ctx.lineTo(x - 9, y); ctx.closePath(); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.beginPath(); ctx.moveTo(x, y + 34); ctx.lineTo(x, y - 8); ctx.stroke();
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
