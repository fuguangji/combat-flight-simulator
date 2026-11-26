import { lerp, lerpVec3, quatIntegrate, quatSlerp, type Quat, type Vec3 } from '../core/math';

/** Must match the table in wasm/physics-engine/src/lib.rs. */
export const STATE_LEN = 40;

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
  CRASH_KIND: 24, // 0 none, 1 ground, 2 building
  IMPACT_TIME: 25, // s until the straight-line flight path meets terrain (99 = clear)
  CRASH_TIME: 26, // simulated time of the crash
  WARN_MASK: 27, // bit mask, see physics/warnings.ts
  WARN_LEVEL: 28, // 0 none, 1 advisory, 2 caution, 3 warning
  WARN_PRIMARY: 29, // lowest set bit (highest priority), -1 = none
  FUEL: 30, // kg
  POWER: 31, // spooled throttle 0..1
  AFTERBURNER: 32,
  G_LIMITING: 33, // flight-control limiter is reducing the pitch command
  THRUST: 34, // N
  G_AVAIL: 35, // load factor the airframe can currently produce
  ELEVATOR: 36, // surface position -1..1
  LANDED: 37, // touched down within the limits (0/1)
  LAND_KIND: 38, // 0 none, 1 runway, 2 carrier deck
  LAND_SINK: 39, // sink rate at touchdown, m/s
} as const;

export const CRASH_NONE = 0;
export const CRASH_GROUND = 1;
export const CRASH_BUILDING = 2;
export const LAND_NONE = 0;
export const LAND_RUNWAY = 1;
export const LAND_DECK = 2;
export const IMPACT_CLEAR = 99;

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
  crashKind: number; // CRASH_*
  crashTime: number; // simulated seconds; meaningful only when crashed
  impactTime: number; // seconds to predicted impact, IMPACT_CLEAR when none
  warnMask: number;
  warnLevel: number; // 0..3
  warnPrimary: number; // bit index or -1
  fuel: number; // kg
  power: number; // 0..1
  afterburner: boolean;
  gLimiting: boolean;
  thrust: number; // N
  gAvailable: number; // g
  elevator: number; // -1..1
  landed: boolean; // safe touchdown on a runway or deck; the aircraft then stays put
  landingKind: number; // LAND_*
  landingSink: number; // m/s at touchdown
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
    crashKind: b[S.CRASH_KIND],
    crashTime: b[S.CRASH_TIME],
    impactTime: b[S.IMPACT_TIME],
    warnMask: b[S.WARN_MASK],
    warnLevel: b[S.WARN_LEVEL],
    warnPrimary: b[S.WARN_PRIMARY],
    fuel: b[S.FUEL],
    power: b[S.POWER],
    afterburner: b[S.AFTERBURNER] > 0.5,
    gLimiting: b[S.G_LIMITING] > 0.5,
    thrust: b[S.THRUST],
    gAvailable: b[S.G_AVAIL],
    elevator: b[S.ELEVATOR],
    landed: b[S.LANDED] > 0.5,
    landingKind: b[S.LAND_KIND],
    landingSink: b[S.LAND_SINK],
  };
}

/** Cubic Hermite position between two snapshots using the velocities as tangents (C1-continuous). */
function hermite(a: AircraftSnapshot, b: AircraftSnapshot, t: number): Vec3 {
  const h = b.time - a.time;
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  const out: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    out[i] = h00 * a.position[i] + h10 * h * a.velocity[i] + h01 * b.position[i] + h11 * h * b.velocity[i];
  }
  return out;
}

/**
 * Interpolation of positions/scalars, slerp of orientation.
 * With `smooth` the position follows a cubic Hermite curve through both velocities instead of a
 * straight segment, which removes the visible "corners" at the 30 Hz snapshot boundaries.
 * The crash step is always interpolated linearly because the velocity jumps to zero there.
 */
export function interpolateSnapshots(a: AircraftSnapshot, b: AircraftSnapshot, t: number, smooth = false): AircraftSnapshot {
  const pick = t < 0.5 ? a : b;
  const useHermite = smooth && !b.crashed && !b.landed && b.time > a.time;
  return {
    time: lerp(a.time, b.time, t),
    position: useHermite ? hermite(a, b, t) : lerpVec3(a.position, b.position, t),
    orientation: quatSlerp(a.orientation, b.orientation, t),
    velocity: lerpVec3(a.velocity, b.velocity, t),
    angularVelocity: lerpVec3(a.angularVelocity, b.angularVelocity, t),
    crashed: t >= 1 ? b.crashed : a.crashed,
    airspeed: lerp(a.airspeed, b.airspeed, t),
    altitude: lerp(a.altitude, b.altitude, t),
    mach: lerp(a.mach, b.mach, t),
    alpha: lerp(a.alpha, b.alpha, t),
    beta: lerp(a.beta, b.beta, t),
    loadFactor: lerp(a.loadFactor, b.loadFactor, t),
    throttle: lerp(a.throttle, b.throttle, t),
    dynamicPressure: lerp(a.dynamicPressure, b.dynamicPressure, t),
    stallWarning: pick.stallWarning,
    crashKind: b.crashKind,
    crashTime: b.crashTime,
    impactTime: lerp(a.impactTime, b.impactTime, t),
    // discrete / slowly varying values follow the nearer snapshot; the mask is never blended
    warnMask: pick.warnMask,
    warnLevel: pick.warnLevel,
    warnPrimary: pick.warnPrimary,
    fuel: lerp(a.fuel, b.fuel, t),
    power: lerp(a.power, b.power, t),
    afterburner: pick.afterburner,
    gLimiting: pick.gLimiting,
    thrust: lerp(a.thrust, b.thrust, t),
    gAvailable: lerp(a.gAvailable, b.gAvailable, t),
    elevator: lerp(a.elevator, b.elevator, t),
    landed: t >= 1 ? b.landed : a.landed,
    landingKind: b.landingKind,
    landingSink: b.landingSink,
  };
}

/** Dead-reckon the newest snapshot forward by `dt` seconds (used when a snapshot is late). */
export function extrapolateSnapshot(s: AircraftSnapshot, dt: number): AircraftSnapshot {
  if (s.crashed || s.landed || dt <= 0) return s;
  return {
    ...s,
    time: s.time + dt,
    position: [
      s.position[0] + s.velocity[0] * dt,
      s.position[1] + s.velocity[1] * dt,
      s.position[2] + s.velocity[2] * dt,
    ],
    orientation: quatIntegrate(s.orientation, s.angularVelocity, dt),
  };
}
