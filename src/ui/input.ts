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
  private readonly down = new Set<string>();

  constructor(startThrottle: number) {
    this.state = { throttle: startThrottle, pitch: 0, roll: 0, yaw: 0 };
    window.addEventListener('keydown', (e) => {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (e.code === 'KeyR' && !e.repeat) this.onReset?.();
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  /** Back to neutral; used after a simulation reset. */
  reset(startThrottle: number): void {
    Object.assign(this.state, { throttle: startThrottle, pitch: 0, roll: 0, yaw: 0 });
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
    s.pitch = this.axis(s.pitch, k.has('ArrowUp'), k.has('ArrowDown'), dt);
    s.roll = this.axis(s.roll, k.has('ArrowLeft'), k.has('ArrowRight'), dt);
    s.yaw = this.axis(s.yaw, k.has('KeyA'), k.has('KeyD'), dt);
    if (k.has('KeyW')) s.throttle = clamp(s.throttle + 0.4 * dt, 0, 1);
    if (k.has('KeyS')) s.throttle = clamp(s.throttle - 0.4 * dt, 0, 1);
  }
}
