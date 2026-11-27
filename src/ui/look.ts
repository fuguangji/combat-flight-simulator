import { clamp, damp } from '../core/math';

/** Radians of head rotation per pixel of mouse movement. */
export const LOOK_SENSITIVITY = 0.0022;

/**
 * Head orientation relative to the airframe (yaw + = look right, pitch + = look up).
 * It only moves the camera; the flight controls still act on the nose, never on the view.
 */
export class FreeLook {
  yaw = 0;
  pitch = 0;
  /** When true the view eases back to straight ahead only after an explicit recenter command. */
  recentering = false;

  /** Mouse movement in pixels. Cancels any recentering in progress. */
  move(dx: number, dy: number, sensitivity = LOOK_SENSITIVITY): void {
    this.recentering = false;
    // No angular stops: the pilot can rotate through any number of full turns.
    this.yaw += dx * sensitivity;
    this.pitch -= dy * sensitivity;
  }

  /** Explicitly recenter only when requested by the pilot (C / recenter control). */
  recenter(): void {
    this.recentering = true;
  }

  /** Jump straight ahead (new flight). */
  reset(): void {
    this.yaw = 0;
    this.pitch = 0;
    this.recentering = false;
  }

  get active(): boolean {
    return Math.abs(this.yaw) > 1e-4 || Math.abs(this.pitch) > 1e-4;
  }

  update(dtSeconds: number): void {
    if (!this.recentering) return;
    const k = damp(9, clamp(dtSeconds, 0, 0.1));
    this.yaw -= this.yaw * k;
    this.pitch -= this.pitch * k;
    if (Math.abs(this.yaw) < 1e-3 && Math.abs(this.pitch) < 1e-3) {
      this.yaw = 0;
      this.pitch = 0;
      this.recentering = false;
    }
  }
}
