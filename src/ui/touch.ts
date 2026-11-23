import { clamp } from '../core/math';

export interface TouchAxes {
  pitch: number; // +1 = stick back (nose up) = finger dragged down
  roll: number; // +1 = right
  yaw: number; // +1 = right rudder
}

/** Dead zone and response curve shared by the stick (pure functions, unit-tested). */
export const STICK_DEADZONE = 0.08;

/** Map a normalised stick deflection (-1..1) to a control value: dead zone, then a soft curve. */
export function stickCurve(v: number): number {
  const a = Math.abs(v);
  if (a <= STICK_DEADZONE) return 0;
  const n = (a - STICK_DEADZONE) / (1 - STICK_DEADZONE); // 0..1 outside the dead zone
  return Math.sign(v) * Math.min(1, 0.6 * n + 0.4 * n * n * n);
}

/** Pixel offset of the finger from the stick centre -> clamped to the stick radius, plus the normalised vector. */
export function stickVector(dx: number, dy: number, radius: number): { x: number; y: number; kx: number; ky: number } {
  const len = Math.hypot(dx, dy);
  const k = len > radius ? radius / len : 1;
  const x = dx * k;
  const y = dy * k;
  return { x, y, kx: x / radius, ky: y / radius };
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
 * On-screen flight controls for phones and tablets (landscape): a virtual stick (pitch / roll),
 * a throttle slider with an afterburner zone, rudder buttons, pause and look-ahead buttons.
 * Dragging anywhere else turns the head (handled by the caller through `onLook`).
 */
export class TouchControls {
  readonly axes: TouchAxes = { pitch: 0, roll: 0, yaw: 0 };
  onThrottle: ((v: number) => void) | null = null;
  onPause: (() => void) | null = null;
  onRecenter: (() => void) | null = null;

  private readonly root: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly handle: HTMLDivElement;
  private stickPointer = -1;
  private sliderPointer = -1;
  private readonly rudder = { left: false, right: false };

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'touch';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="t-stick" aria-label="搖桿：左右滾轉、上下俯仰"><div class="t-knob"></div></div>
      <div class="t-rudder">
        <button type="button" class="t-btn" data-rudder="left" aria-label="左方向舵">◀</button>
        <button type="button" class="t-btn" data-rudder="right" aria-label="右方向舵">▶</button>
      </div>
      <div class="t-throttle" aria-label="油門"><div class="t-ab"></div><div class="t-fill"></div><div class="t-handle"></div></div>
      <div class="t-top">
        <button type="button" class="t-btn small" data-act="recenter" aria-label="視角回正">⌖</button>
        <button type="button" class="t-btn small" data-act="pause" aria-label="暫停">❚❚</button>
      </div>`;
    parent.appendChild(this.root);
    this.knob = this.root.querySelector('.t-knob') as HTMLDivElement;
    this.fill = this.root.querySelector('.t-fill') as HTMLDivElement;
    this.handle = this.root.querySelector('.t-handle') as HTMLDivElement;

    const stick = this.root.querySelector('.t-stick') as HTMLDivElement;
    const slider = this.root.querySelector('.t-throttle') as HTMLDivElement;

    const moveStick = (e: PointerEvent): void => {
      const r = stick.getBoundingClientRect();
      const radius = r.width / 2;
      const v = stickVector(e.clientX - (r.left + radius), e.clientY - (r.top + radius), radius);
      this.knob.style.transform = `translate(${v.x}px, ${v.y}px)`;
      this.axes.roll = stickCurve(v.kx);
      this.axes.pitch = stickCurve(v.ky); // finger down = pull back = nose up
    };
    stick.addEventListener('pointerdown', (e) => {
      if (this.stickPointer !== -1) return;
      e.preventDefault();
      this.stickPointer = e.pointerId;
      stick.setPointerCapture(e.pointerId);
      moveStick(e);
    });
    stick.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickPointer) moveStick(e);
    });
    const endStick = (e: PointerEvent): void => {
      if (e.pointerId !== this.stickPointer) return;
      this.stickPointer = -1;
      this.axes.roll = 0;
      this.axes.pitch = 0;
      this.knob.style.transform = 'translate(0, 0)';
    };
    stick.addEventListener('pointerup', endStick);
    stick.addEventListener('pointercancel', endStick);

    const moveSlider = (e: PointerEvent): void => {
      const r = slider.getBoundingClientRect();
      const v = sliderValue(e.clientY, r.top, r.height);
      this.setThrottle(v);
      this.onThrottle?.(v);
    };
    slider.addEventListener('pointerdown', (e) => {
      if (this.sliderPointer !== -1) return;
      e.preventDefault();
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

    const applyRudder = (): void => {
      this.axes.yaw = (this.rudder.right ? 1 : 0) - (this.rudder.left ? 1 : 0);
    };
    this.root.querySelectorAll<HTMLButtonElement>('[data-rudder]').forEach((b) => {
      const side = b.dataset.rudder as 'left' | 'right';
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        this.rudder[side] = true;
        applyRudder();
      });
      const up = (): void => {
        this.rudder[side] = false;
        applyRudder();
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
    });
    this.root.querySelector('[data-act="pause"]')?.addEventListener('click', () => this.onPause?.());
    this.root.querySelector('[data-act="recenter"]')?.addEventListener('click', () => this.onRecenter?.());
  }

  /** Reflect the current throttle (0..1) on the slider. */
  setThrottle(v: number): void {
    const pct = `${(clamp(v, 0, 1) * 100).toFixed(1)}%`;
    this.fill.style.height = pct;
    this.handle.style.bottom = `calc(${pct} - 14px)`;
  }

  /** Release every control (new flight, pause). */
  reset(): void {
    this.stickPointer = -1;
    this.sliderPointer = -1;
    this.rudder.left = this.rudder.right = false;
    this.axes.pitch = this.axes.roll = this.axes.yaw = 0;
    this.knob.style.transform = 'translate(0, 0)';
  }

  show(on: boolean): void {
    this.root.hidden = !on;
    if (!on) this.reset();
  }
}
