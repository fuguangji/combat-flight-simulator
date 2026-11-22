import { describe, expect, it } from 'vitest';
import { STATE_LEN, decodeSnapshot, S } from '../src/physics/stateLayout';
import { WARNINGS, activeWarnings } from '../src/physics/warnings';

describe('warning table', () => {
  it('lists bits 0..n-1 in order with non-increasing level (priority order)', () => {
    WARNINGS.forEach((w, i) => expect(w.bit).toBe(i));
    for (let i = 1; i < WARNINGS.length; i++) expect(WARNINGS[i].level).toBeLessThanOrEqual(WARNINGS[i - 1].level);
  });

  it('returns active warnings highest priority first', () => {
    const mask = (1 << 5) | (1 << 0) | (1 << 12);
    expect(activeWarnings(mask).map((w) => w.text)).toEqual(['PULL UP', 'TERRAIN', 'G LIMIT']);
    expect(activeWarnings(0)).toEqual([]);
  });
});

describe('snapshot v3 decoding', () => {
  it('reads the warning / engine fields from their fixed offsets', () => {
    const b = new Float64Array(STATE_LEN);
    b[S.WARN_MASK] = 33;
    b[S.WARN_LEVEL] = 3;
    b[S.WARN_PRIMARY] = 0;
    b[S.FUEL] = 1234;
    b[S.AFTERBURNER] = 1;
    b[S.G_AVAIL] = 7.5;
    const s = decodeSnapshot(b);
    expect(s.warnMask).toBe(33);
    expect(s.warnLevel).toBe(3);
    expect(s.warnPrimary).toBe(0);
    expect(s.fuel).toBe(1234);
    expect(s.afterburner).toBe(true);
    expect(s.gAvailable).toBe(7.5);
  });
});
