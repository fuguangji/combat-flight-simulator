/**
 * Warning table. Bit numbers and levels mirror wasm/physics-engine/src/warnings.rs
 * (bit 0 = highest priority). Level 3 = warning (red), 2 = caution (amber), 1 = advisory.
 */
export interface WarningDef {
  bit: number;
  level: 1 | 2 | 3;
  text: string;
  /** Spoken / displayed short form used by the audio layer to pick a tone. */
  tone: 'continuous' | 'fast' | 'slow' | 'chime' | 'none';
}

export const WARNINGS: readonly WarningDef[] = [
  { bit: 0, level: 3, text: 'PULL UP', tone: 'fast' },
  { bit: 1, level: 3, text: 'STALL', tone: 'continuous' },
  { bit: 2, level: 3, text: 'OVERSPEED', tone: 'continuous' },
  { bit: 3, level: 3, text: 'ENGINE FLAMEOUT', tone: 'fast' },
  { bit: 4, level: 3, text: 'OVER G', tone: 'fast' },
  { bit: 5, level: 2, text: 'TERRAIN', tone: 'slow' },
  { bit: 6, level: 2, text: 'SINK RATE', tone: 'slow' },
  { bit: 7, level: 2, text: 'AOA', tone: 'slow' },
  { bit: 8, level: 2, text: 'SPEED', tone: 'slow' },
  { bit: 9, level: 2, text: 'BANK ANGLE', tone: 'slow' },
  { bit: 10, level: 2, text: 'FUEL LOW', tone: 'chime' },
  { bit: 11, level: 1, text: 'LOW ALT', tone: 'none' },
  { bit: 12, level: 1, text: 'G LIMIT', tone: 'none' },
  { bit: 13, level: 1, text: 'BINGO FUEL', tone: 'none' },
];

/** Active warnings, highest priority first. */
export function activeWarnings(mask: number): WarningDef[] {
  return WARNINGS.filter((w) => (mask & (1 << w.bit)) !== 0);
}
