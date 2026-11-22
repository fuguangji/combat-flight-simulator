import type { AircraftDefinition } from '../aircraft/registry';
import {
  clamp,
  damp,
  smoothstep,
  vecAdd,
  vecCross,
  vecNormalize,
  vecScale,
  quatRotate,
  type Quat,
  type Vec3,
} from '../core/math';
import type { CameraState } from '../rendering/Renderer';
import type { AircraftSnapshot } from '../physics/stateLayout';

/** Lowest the eye may go; keeps the camera above the ground plane after a crash. */
const MIN_EYE_HEIGHT = 0.8;

/** First-person camera rigidly attached to the pilot's eye point. */
export function cameraFromSnapshot(s: AircraftSnapshot, def: AircraftDefinition): CameraState {
  const q = s.orientation;
  const eye = quatRotate(q, def.eyeOffset);
  return {
    position: [s.position[0] + eye[0], Math.max(MIN_EYE_HEIGHT, s.position[1] + eye[1]), s.position[2] + eye[2]],
    right: quatRotate(q, [0, 0, 1]),
    up: quatRotate(q, [0, 1, 0]),
    forward: quatRotate(q, [1, 0, 0]),
    fovY: def.fovY,
  };
}

/**
 * Rotate the camera basis by small angles about its own axes (radians), keeping it orthonormal.
 * pitch + = look up, yaw + = look right, roll + = tilt clockwise (right side down).
 */
export function perturbBasis(cam: CameraState, pitch: number, yaw: number, roll: number): CameraState {
  const forward = vecNormalize(vecAdd(vecAdd(cam.forward, vecScale(cam.right, yaw)), vecScale(cam.up, pitch)));
  const upTilted = vecNormalize(vecAdd(cam.up, vecScale(cam.right, roll)));
  const right = vecNormalize(vecCross(forward, upTilted));
  const up = vecCross(right, forward);
  return { ...cam, forward, right, up };
}

/** Sum of three incommensurate sines: cheap, deterministic, smooth "noise" in about [-1, 1]. */
function wobble(t: number, f1: number, f2: number, f3: number, phase: number): number {
  return (
    0.5 * Math.sin(t * f1 * 2 * Math.PI + phase) +
    0.3 * Math.sin(t * f2 * 2 * Math.PI + phase * 1.7 + 1.3) +
    0.2 * Math.sin(t * f3 * 2 * Math.PI + phase * 2.3 + 2.1)
  );
}

/**
 * Turns the physics snapshot into a living camera: rigid cockpit view plus
 *  - speed-dependent field of view (a little "stretch" when fast),
 *  - head sag / lift under G (the pilot's head moves in the seat),
 *  - engine vibration, transonic and stall buffet,
 *  - a decaying impact shake after a crash.
 * All effects are small and purely visual; they never feed back into the physics.
 */
export class CameraRig {
  /** Last camera produced; reused while the game is paused so the picture freezes exactly. */
  last: CameraState | null = null;
  private fov = Number.NaN;
  private headY = 0;
  private stall = 0;
  private lastNow = Number.NaN;

  reset(): void {
    this.fov = Number.NaN;
    this.headY = 0;
    this.stall = 0;
    this.lastNow = Number.NaN;
    this.last = null;
  }

  update(s: AircraftSnapshot, def: AircraftDefinition, nowMs: number): CameraState {
    const dt = Number.isNaN(this.lastNow) ? 1 / 60 : clamp((nowMs - this.lastNow) / 1000, 0, 0.1);
    this.lastNow = nowMs;
    const t = nowMs / 1000;

    // --- Field of view widens with speed (100 m/s -> 350 m/s adds up to 9 %).
    const fovTarget = def.fovY * (1 + 0.09 * smoothstep(100, 350, s.airspeed));
    this.fov = Number.isNaN(this.fov) ? fovTarget : this.fov + (fovTarget - this.fov) * damp(3, dt);

    // --- Head sag under G (body-frame Y). 1 g is neutral.
    const headTarget = clamp(-0.045 * (s.loadFactor - 1), -0.18, 0.08);
    this.headY += (headTarget - this.headY) * damp(8, dt);

    const q: Quat = s.orientation;
    const eyeBody: Vec3 = [def.eyeOffset[0], def.eyeOffset[1] + this.headY, def.eyeOffset[2]];
    const eye = quatRotate(q, eyeBody);
    const base: CameraState = {
      position: [s.position[0] + eye[0], Math.max(MIN_EYE_HEIGHT, s.position[1] + eye[1]), s.position[2] + eye[2]],
      right: quatRotate(q, [0, 0, 1]),
      up: quatRotate(q, [0, 1, 0]),
      forward: quatRotate(q, [1, 0, 0]),
      fovY: this.fov,
    };

    // --- Vibration / buffet (radians).
    this.stall += ((s.stallWarning && !s.crashed ? 1 : 0) - this.stall) * damp(6, dt);
    const transonic = Math.exp(-(((s.mach - 1.0) / 0.12) ** 2)); // peaks around Mach 1
    const engine = 0.0005 * s.throttle;
    const amp = s.crashed ? 0 : engine + 0.0035 * transonic + 0.012 * this.stall;
    let pitch = amp * wobble(t, 17, 23, 31, 0.0);
    let yaw = amp * wobble(t, 19, 27, 13, 1.1);
    let roll = amp * 0.6 * wobble(t, 11, 29, 37, 2.2);

    // --- Crash: sharp shake that dies out, then the view settles into a slight tilt.
    if (s.crashed) {
      const since = Math.max(0, s.time - s.crashTime);
      const shake = 0.09 * Math.exp(-since * 2.4);
      pitch += shake * wobble(t, 9, 14, 23, 0.4);
      yaw += shake * wobble(t, 8, 15, 21, 1.4);
      roll += shake * 1.4 * wobble(t, 7, 12, 19, 2.4) + 0.12 * (1 - Math.exp(-since * 2));
    }

    this.last = perturbBasis(base, pitch, yaw, roll);
    return this.last;
  }
}

export interface Attitude {
  pitch: number; // rad, + nose up
  roll: number; // rad, + right wing down
  heading: number; // rad 0..2pi, 0 = north, pi/2 = east
}

export function attitudeFromQuat(q: Quat): Attitude {
  const f: Vec3 = quatRotate(q, [1, 0, 0]);
  const u: Vec3 = quatRotate(q, [0, 1, 0]);
  const r: Vec3 = quatRotate(q, [0, 0, 1]);
  let heading = Math.atan2(f[0], -f[2]); // east component, north component (north = -Z)
  if (heading < 0) heading += Math.PI * 2;
  return {
    pitch: Math.asin(Math.max(-1, Math.min(1, f[1]))),
    roll: Math.atan2(-r[1], u[1]),
    heading,
  };
}
