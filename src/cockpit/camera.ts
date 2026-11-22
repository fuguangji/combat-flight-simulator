import type { AircraftDefinition } from '../aircraft/registry';
import { quatRotate, type Quat, type Vec3 } from '../core/math';
import type { CameraState } from '../rendering/Renderer';
import type { AircraftSnapshot } from '../physics/stateLayout';

/** First-person camera rigidly attached to the pilot's eye point. */
export function cameraFromSnapshot(s: AircraftSnapshot, def: AircraftDefinition): CameraState {
  const q = s.orientation;
  const eye = quatRotate(q, def.eyeOffset);
  return {
    position: [s.position[0] + eye[0], s.position[1] + eye[1], s.position[2] + eye[2]],
    right: quatRotate(q, [0, 0, 1]),
    up: quatRotate(q, [0, 1, 0]),
    forward: quatRotate(q, [1, 0, 0]),
    fovY: def.fovY,
  };
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
