import { clamp } from '../core/math';

export interface TouchAxes {
  pitch: number; // +1 = stick back (nose up) = finger dragged down
  roll: number; // +1 = right
  yaw: number; // +1 = right rudder (unused on touch: roll coordinates the turn)
}

/** Which of the four direction buttons are held. */
export interface DpadState { up: boolean; down: boolean; left: boolean; right: boolean }

/**
 * Target control values for the held buttons. Same convention as the keyboard: ▼ = stick back =
 * nose up (+1 pitch), ▲ = nose down; ▶ = roll right (+1). Opposite buttons cancel out.
 */
export function dpadTarget(d: DpadState): { pitch: number; roll: number } {
  return { pitch: (d.down ? 1 : 0) - (d.up ? 1 : 0), roll: (d.right ? 1 : 0) - (d.left ? 1 : 0) };
}

/** Move `current` toward `target` at `rate` per second (so a tap is a nudge, a hold is a full input). */
export function rampAxis(current: number, target: number, dt: number, rate = 2.6, centre = 5): number {
  if (target === 0) {
    const step = centre * dt;
    return Math.abs(current) <= step ? 0 : current - Math.sign(current) * step;
  }
  return clamp(current + target * rate * dt, -1, 1);
}

/** Throttle slider: finger y within the track (top = 100 %). */
export function sliderValue(y: number, top: number, height: number): number {
  return clamp(1 - (y - top) / height, 0, 1);
}

export function isTouchDevice(search = location.search): boolean {
  const q = new URLSearchParams(search).get('touch');
  if (q === '1') return true;
  if (q === '0') return false;
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

/**
 * On-screen flight controls for phones and tablets (landscape): four direction buttons
 * (pitch / roll), a throttle slider with an afterburner zone, pause and look-ahead buttons.
 * Dragging anywhere else turns the head (handled by the caller).
 */
export class TouchControls {
  readonly axes: TouchAxes = { pitch: 0, roll: 0, yaw: 0 };
  onThrottle: ((v: number) => void) | null = null;
  onManualInput: (() => void) | null = null;
  onPause: (() => void) | null = null;
  onRecenter: (() => void) | null = null;

  private readonly root: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly handle: HTMLDivElement;
  private sliderPointer = -1;
  private readonly held: DpadState = { up: false, down: false, left: false, right: false };

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'touch';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="t-dpad" aria-label="方向鍵：俯仰與滾轉">
        <button type="button" class="t-btn t-up" data-dir="up" aria-label="機頭下壓">▲<small>壓</small></button>
        <button type="button" class="t-btn t-left" data-dir="left" aria-label="向左滾轉">◀<small>左滾</small></button>
        <button type="button" class="t-btn t-right" data-dir="right" aria-label="向右滾轉">▶<small>右滾</small></button>
        <button type="button" class="t-btn t-down" data-dir="down" aria-label="機頭拉起">▼<small>拉</small></button>
      </div>
      <div class="t-throttle" aria-label="油門"><div class="t-ab"></div><div class="t-fill"></div><div class="t-handle"></div></div>
      <div class="t-top">
        <button type="button" class="t-btn small" data-act="recenter" aria-label="視角回正">⌖</button>
        <button type="button" class="t-btn small" data-act="pause" aria-label="暫停">❚❚</button>
      </div>`;
    parent.appendChild(this.root);
    this.fill = this.root.querySelector('.t-fill') as HTMLDivElement;
    this.handle = this.root.querySelector('.t-handle') as HTMLDivElement;
    const slider = this.root.querySelector('.t-throttle') as HTMLDivElement;

    this.root.querySelectorAll<HTMLButtonElement>('[data-dir]').forEach((b) => {
      const dir = b.dataset.dir as keyof DpadState;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.onManualInput?.();
        b.setPointerCapture(e.pointerId);
        this.held[dir] = true;
        b.classList.add('on');
      });
      const up = (): void => {
        this.held[dir] = false;
        b.classList.remove('on');
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
    });

    const moveSlider = (e: PointerEvent): void => {
      const r = slider.getBoundingClientRect();
      const v = sliderValue(e.clientY, r.top, r.height);
      this.setThrottle(v);
      this.onThrottle?.(v);
    };
    slider.addEventListener('pointerdown', (e) => {
      if (this.sliderPointer !== -1) return;
      e.preventDefault();
      this.onManualInput?.();
      this.sliderPointer = e.pointerId;
      slider.setPointerCapture(e.pointerId);
      moveSlider(e);
    });
    slider.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.sliderPointer) moveSlider(e);
    });
    const endSlider = (e: PointerEvent): void => {
      if (e.pointerId === this.sliderPointer) this.sliderPointer = -1;
    };
    slider.addEventListener('pointerup', endSlider);
    slider.addEventListener('pointercancel', endSlider);

    this.root.querySelector('[data-act="pause"]')?.addEventListener('click', () => this.onPause?.());
    this.root.querySelector('[data-act="recenter"]')?.addEventListener('click', () => this.onRecenter?.());
  }

  /** Ease the control axes toward the held buttons; call once per frame while flying. */
  update(dt: number): void {
    const t = dpadTarget(this.held);
    this.axes.pitch = rampAxis(this.axes.pitch, t.pitch, dt);
    this.axes.roll = rampAxis(this.axes.roll, t.roll, dt);
  }

  /** Reflect the current throttle (0..1) on the slider. */
  setThrottle(v: number): void {
    const pct = `${(clamp(v, 0, 1) * 100).toFixed(1)}%`;
    this.fill.style.height = pct;
    this.handle.style.bottom = `calc(${pct} - 14px)`;
  }

  /** Release every control (new flight, pause). */
  reset(): void {
    this.sliderPointer = -1;
    this.held.up = this.held.down = this.held.left = this.held.right = false;
    this.root.querySelectorAll('[data-dir]').forEach((b) => b.classList.remove('on'));
    this.axes.pitch = this.axes.roll = this.axes.yaw = 0;
  }

  show(on: boolean): void {
    this.root.hidden = !on;
    if (!on) this.reset();
  }
}
