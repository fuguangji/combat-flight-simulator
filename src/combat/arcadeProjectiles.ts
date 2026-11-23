/**
 * Fictional arcade equipment effect.
 *
 * This module intentionally stays in the presentation/gameplay layer:
 * it creates short-lived screen-space effects and an ammo/cooldown HUD.
 * It does not model real guidance, seekers, fuzing, or real-world weapon behavior.
 */
type VisualProjectile = { age: number; lane: number; id: number };

export class ArcadeProjectileSystem {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly panel: HTMLDivElement;
  private readonly active: VisualProjectile[] = [];
  private readonly capacity = 6;
  private ammo = this.capacity;
  private cooldown = 0;
  private previousMode = '';
  private lastTime = performance.now();
  private nextId = 1;
  private flash = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'projectile-effects';
    this.panel = document.createElement('div');
    this.panel.id = 'equipment-status';
    this.panel.setAttribute('aria-live', 'polite');
    document.body.append(this.canvas, this.panel);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Equipment effect canvas unavailable');
    this.ctx = ctx;
    window.addEventListener('keydown', (event) => {
      if (event.code !== 'KeyF' || event.repeat || document.body.dataset.mode !== 'flying') return;
      event.preventDefault();
      this.launch();
    });
    requestAnimationFrame(this.frame);
  }

  private launch(): void {
    if (this.ammo <= 0 || this.cooldown > 0) {
      this.flash = 0.18;
      return;
    }
    // A deliberately stylized screen-space effect, not a physical or guided projectile.
    this.active.push({ age: 0, lane: (this.nextId % 2 ? -1 : 1) * 0.018, id: this.nextId++ });
    this.ammo -= 1;
    this.cooldown = 1.1;
    this.flash = 0.12;
    this.renderPanel();
  }

  private renderPanel(): void {
    const state = this.cooldown > 0 ? 'RECHARGING' : this.ammo > 0 ? 'READY' : 'EMPTY';
    this.panel.textContent = `AUX POD  ·  ${String(this.ammo).padStart(2, '0')} / ${this.capacity}  ·  ${state}  ·  F`;
    this.panel.dataset.state = this.ammo > 0 && this.cooldown <= 0 ? 'ready' : 'busy';
  }

  private readonly frame = (now: number): void => {
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    const mode = document.body.dataset.mode ?? '';
    if (mode === 'menu' && this.previousMode !== 'menu') {
      this.ammo = this.capacity;
      this.cooldown = 0;
      this.active.length = 0;
    }
    this.previousMode = mode;
    if (mode === 'flying') {
      this.cooldown = Math.max(0, this.cooldown - dt);
      for (const p of this.active) p.age += dt;
      for (let i = this.active.length - 1; i >= 0; i--) {
        if (this.active[i].age >= 0.9) this.active.splice(i, 1);
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
    if (!visible) return;
    const cx = w / 2;
    const cy = h / 2;
    for (const p of this.active) {
      const t = Math.min(1, p.age / 0.9);
      const y = h * (0.72 - t * 0.64);
      const x = cx + p.lane * w * (0.2 + t);
      const alpha = Math.max(0, 1 - t) * 0.9;
      const length = 18 + t * 36;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = '#ffc56b';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = '#ff8b45';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.moveTo(x, y + length);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.restore();
    }
    if (this.flash > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.35, this.flash * 2);
      ctx.fillStyle = '#ffc56b';
      ctx.fillRect(cx - 2, cy + h * 0.18, 4, 4);
      ctx.restore();
    }
  }
}
