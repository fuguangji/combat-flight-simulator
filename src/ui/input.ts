import { clamp } from '../core/math';
import type { ControlInput } from '../physics/PhysicsClient';

const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'KeyW', 'KeyS']);

/**
 * Keyboard → smoothed control axes. Axes ramp toward the pressed direction and return to centre
 * when released, which approximates a spring-loaded stick.
 */
export class KeyboardControls {
  readonly state: ControlInput;
  onReset: (() => void) | null = null;
  onManualInput: (() => void) | null = null;
  onPause: (() => void) | null = null;
  /** Enter / Space: confirm the primary action of whatever overlay is showing. */
  onConfirm: (() => void) | null = null;
  /** C: put the head back straight ahead. */
  onRecenter: (() => void) | null = null;
  /** N: skip the current tutorial step. */
  onSkip: (() => void) | null = null;
  private readonly down = new Set<string>();
  /** Added to the keyboard axes (virtual stick / rudder on touch devices). */
  touch: { pitch: number; roll: number; yaw: number } | null = null;
  private readonly kb = { pitch: 0, roll: 0, yaw: 0 };

  constructor(startThrottle: number) {
    this.state = { throttle: startThrottle, pitch: 0, roll: 0, yaw: 0 };
    window.addEventListener('keydown', (e) => {
      if (GAME_KEYS.has(e.code)) { e.preventDefault(); this.onManualInput?.(); }
      if (e.code === 'KeyW' || e.code === 'KeyS') this.onManualInput?.();
      if (!e.repeat) {
        if (e.code === 'KeyR') this.onReset?.();
        else if (e.code === 'KeyN') this.onSkip?.();
        else if (e.code === 'KeyC') this.onRecenter?.();
        else if (e.code === 'Escape' || e.code === 'KeyP') this.onPause?.();
        else if (e.code === 'Enter' || e.code === 'Space') this.onConfirm?.();
      }
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  /** Set the throttle directly (touch slider). */
  setThrottle(v: number): void {
    this.state.throttle = clamp(v, 0, 1);
  }

  /** Back to neutral; used after a simulation reset. */
  reset(startThrottle: number): void {
    Object.assign(this.state, { throttle: startThrottle, pitch: 0, roll: 0, yaw: 0 });
    Object.assign(this.kb, { pitch: 0, roll: 0, yaw: 0 });
  }

  private axis(current: number, neg: boolean, pos: boolean, dt: number, rate = 4, centre = 6): number {
    const target = (pos ? 1 : 0) - (neg ? 1 : 0);
    if (target === 0) {
      const step = centre * dt;
      return Math.abs(current) <= step ? 0 : current - Math.sign(current) * step;
    }
    return clamp(current + target * rate * dt, -1, 1);
  }

  update(dt: number): void {
    const k = this.down;
    const s = this.state;
    // ArrowDown = stick back = nose up (+1)
    const kb = this.kb;
    kb.pitch = this.axis(kb.pitch, k.has('ArrowUp'), k.has('ArrowDown'), dt);
    kb.roll = this.axis(kb.roll, k.has('ArrowLeft'), k.has('ArrowRight'), dt);
    kb.yaw = this.axis(kb.yaw, k.has('KeyA'), k.has('KeyD'), dt);
    const t = this.touch;
    s.pitch = clamp(kb.pitch + (t?.pitch ?? 0), -1, 1);
    s.roll = clamp(kb.roll + (t?.roll ?? 0), -1, 1);
    s.yaw = clamp(kb.yaw + (t?.yaw ?? 0), -1, 1);
    if (k.has('KeyW')) s.throttle = clamp(s.throttle + 0.4 * dt, 0, 1);
    if (k.has('KeyS')) s.throttle = clamp(s.throttle - 0.4 * dt, 0, 1);
  }
}
