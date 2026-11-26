/** Rotary-knob maths (a knob sweeps 270°, from -135° to +135°). */
export const KNOB_SWEEP = 270;

export function knobAngle(value: number, min: number, max: number): number {
  if (!(max > min)) return -KNOB_SWEEP / 2;
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return -KNOB_SWEEP / 2 + t * KNOB_SWEEP;
}

/** Value after dragging by `deltaPx` (right/up = increase); 200 px sweeps the whole range. Snapped to `step`. */
export function knobDrag(start: number, deltaPx: number, min: number, max: number, step: number, pxPerRange = 200): number {
  const raw = start + (deltaPx / pxPerRange) * (max - min);
  const snapped = Math.round((raw - min) / step) * step + min;
  return Math.max(min, Math.min(max, snapped));
}

/** Heading knobs wrap around instead of stopping. */
export function wrapValue(v: number, min: number, max: number): number {
  const span = max - min + 1;
  return ((((v - min) % span) + span) % span) + min;
}
