/** Pure helpers for the HUD (kept free of canvas types so they can be unit-tested). */

export interface Tick {
  value: number;
  /** Labelled, longer tick. */
  major: boolean;
}

/**
 * Ticks of a scrolling tape centred on `center` and covering ±`halfRange`.
 * `minor` is the tick spacing, `major` (a multiple of `minor`) the labelled spacing.
 */
export function tapeTicks(center: number, halfRange: number, minor: number, major: number): Tick[] {
  if (!(minor > 0) || !(major > 0) || !Number.isFinite(center) || !(halfRange > 0)) return [];
  const first = Math.ceil((center - halfRange) / minor);
  const last = Math.floor((center + halfRange) / minor);
  const out: Tick[] = [];
  for (let i = first; i <= last; i++) {
    const value = i * minor;
    out.push({ value, major: Math.abs(value / major - Math.round(value / major)) < 1e-9 });
  }
  return out;
}

/** Bank-scale graduations, degrees from the vertical. */
export const BANK_MARKS: readonly number[] = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60];

/** 0 = normal, 1 = caution, 2 = warning. Works for "high is bad" (warn > caution) and "low is bad". */
export type Severity = 0 | 1 | 2;
export function severity(value: number, caution: number, warn: number): Severity {
  if (!Number.isFinite(value)) return 0;
  if (warn >= caution) return value >= warn ? 2 : value >= caution ? 1 : 0;
  return value <= warn ? 2 : value <= caution ? 1 : 0;
}

/** Wrap a compass heading in degrees to [0, 360). */
export const wrapDeg = (d: number): number => ((d % 360) + 360) % 360;
