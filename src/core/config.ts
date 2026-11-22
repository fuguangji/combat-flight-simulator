/** Global timing constants. Physics is authoritative at PHYSICS_HZ regardless of render FPS. */
export const PHYSICS_HZ = 30;
export const PHYSICS_DT = 1 / PHYSICS_HZ;

/** Safety limits for the fixed-step accumulator (prevents the "spiral of death"). */
export const MAX_STEPS_PER_TICK = 5;
export const MAX_TICK_SECONDS = 0.25;

/**
 * How far behind the newest physics snapshot the renderer samples, in ms.
 * Must exceed one physics step plus network/worker jitter or interpolation starves.
 */
export const INTERP_DELAY_MS = PHYSICS_DT * 1000 * 1.25;

/** If a snapshot is late, the renderer may extrapolate the newest one by at most this long. */
export const MAX_EXTRAPOLATION_MS = 100;

export const WASM_API_VERSION = 2;
