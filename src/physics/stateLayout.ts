import { lerp, lerpVec3, quatSlerp, type Quat, type Vec3 } from '../core/math';

/** Must match the table in wasm/physics-engine/src/lib.rs. */
export const STATE_LEN = 32;

export const S = {
  POS: 0, // x y z
  QUAT: 3, // x y z w
  VEL: 7,
  OMEGA: 10,
  TIME: 13,
  CRASHED: 14,
  AIRSPEED: 15,
  ALTITUDE: 16,
  MACH: 17,
  ALPHA: 18,
  BETA: 19,
  LOAD: 20,
  THROTTLE: 21,
  QBAR: 22,
  STALL_WARN: 23,
} as const;

export interface AircraftSnapshot {
  /** Simulated seconds since reset. */
  time: number;
  position: Vec3; // world metres (x east, y up, -z north)
  orientation: Quat; // body -> world
  velocity: Vec3;
  angularVelocity: Vec3; // body rad/s
  crashed: boolean;
  airspeed: number; // m/s
  altitude: number; // m
  mach: number;
  alpha: number; // rad
  beta: number; // rad
  loadFactor: number; // g
  throttle: number;
  dynamicPressure: number;
  stallWarning: boolean;
}

export function decodeSnapshot(b: ArrayLike<number>): AircraftSnapshot {
  return {
    time: b[S.TIME],
    position: [b[S.POS], b[S.POS + 1], b[S.POS + 2]],
    orientation: [b[S.QUAT], b[S.QUAT + 1], b[S.QUAT + 2], b[S.QUAT + 3]],
    velocity: [b[S.VEL], b[S.VEL + 1], b[S.VEL + 2]],
    angularVelocity: [b[S.OMEGA], b[S.OMEGA + 1], b[S.OMEGA + 2]],
    crashed: b[S.CRASHED] > 0.5,
    airspeed: b[S.AIRSPEED],
    altitude: b[S.ALTITUDE],
    mach: b[S.MACH],
    alpha: b[S.ALPHA],
    beta: b[S.BETA],
    loadFactor: b[S.LOAD],
    throttle: b[S.THROTTLE],
    dynamicPressure: b[S.QBAR],
    stallWarning: b[S.STALL_WARN] > 0.5,
  };
}

/** Linear interpolation of positions/scalars, slerp of orientation. */
export function interpolateSnapshots(a: AircraftSnapshot, b: AircraftSnapshot, t: number): AircraftSnapshot {
  const pick = t < 0.5 ? a : b;
  return {
    time: lerp(a.time, b.time, t),
    position: lerpVec3(a.position, b.position, t),
    orientation: quatSlerp(a.orientation, b.orientation, t),
    velocity: lerpVec3(a.velocity, b.velocity, t),
    angularVelocity: lerpVec3(a.angularVelocity, b.angularVelocity, t),
    crashed: b.crashed,
    airspeed: lerp(a.airspeed, b.airspeed, t),
    altitude: lerp(a.altitude, b.altitude, t),
    mach: lerp(a.mach, b.mach, t),
    alpha: lerp(a.alpha, b.alpha, t),
    beta: lerp(a.beta, b.beta, t),
    loadFactor: lerp(a.loadFactor, b.loadFactor, t),
    throttle: lerp(a.throttle, b.throttle, t),
    dynamicPressure: lerp(a.dynamicPressure, b.dynamicPressure, t),
    stallWarning: pick.stallWarning,
  };
}
