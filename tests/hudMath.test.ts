import { describe, expect, it } from 'vitest';
import { BANK_MARKS, severity, tapeTicks, wrapDeg } from '../src/cockpit/hudMath';

describe('tapeTicks', () => {
  it('covers the requested range with aligned ticks', () => {
    const t = tapeTicks(8202, 500, 100, 500);
    expect(t.map((x) => x.value)).toEqual([7800, 7900, 8000, 8100, 8200, 8300, 8400, 8500, 8600, 8700]);
    expect(t.filter((x) => x.major).map((x) => x.value)).toEqual([8000, 8500]);
  });

  it('includes ticks exactly on the range edge and handles negative values', () => {
    const t = tapeTicks(0, 100, 50, 100);
    expect(t.map((x) => x.value)).toEqual([-100, -50, 0, 50, 100]);
    expect(t.filter((x) => x.major).map((x) => x.value)).toEqual([-100, 0, 100]);
  });

  it('returns nothing for invalid input', () => {
    expect(tapeTicks(NaN, 10, 1, 5)).toEqual([]);
    expect(tapeTicks(0, 0, 1, 5)).toEqual([]);
    expect(tapeTicks(0, 10, 0, 5)).toEqual([]);
  });
});

describe('severity', () => {
  it('grades values where high is bad', () => {
    expect([5, 7.5, 8.8].map((g) => severity(g, 7, 8.5))).toEqual([0, 1, 2]);
  });
  it('grades values where low is bad', () => {
    expect([40, 20, 8].map((f) => severity(f, 25, 10))).toEqual([0, 1, 2]);
    expect(severity(200, 150, 40)).toBe(0);
    expect(severity(90, 150, 40)).toBe(1);
    expect(severity(10, 150, 40)).toBe(2);
  });
  it('ignores non-finite values', () => {
    expect(severity(NaN, 1, 2)).toBe(0);
  });
});

describe('misc', () => {
  it('wraps headings', () => {
    expect(wrapDeg(-10)).toBe(350);
    expect(wrapDeg(370)).toBe(10);
    expect(wrapDeg(0)).toBe(0);
  });
  it('bank marks are symmetric and include level', () => {
    expect(BANK_MARKS).toContain(0);
    for (const m of BANK_MARKS) expect(BANK_MARKS).toContain(-m);
  });
});
