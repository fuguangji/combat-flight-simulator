import { describe, expect, it } from 'vitest';
import { STICK_DEADZONE, sliderValue, stickCurve, stickVector } from '../src/ui/touch';

describe('virtual stick', () => {
  it('has a dead zone, is odd-symmetric, monotonic and reaches exactly +-1', () => {
    expect(stickCurve(0)).toBe(0);
    expect(stickCurve(STICK_DEADZONE * 0.9)).toBe(0);
    expect(stickCurve(1)).toBeCloseTo(1, 12);
    expect(stickCurve(-1)).toBeCloseTo(-1, 12);
    let prev = -Infinity;
    for (let v = -1; v <= 1; v += 0.01) {
      const c = stickCurve(v);
      expect(c).toBeGreaterThanOrEqual(prev);
      expect(Math.abs(c + stickCurve(-v))).toBeLessThan(1e-12);
      prev = c;
    }
  });

  it('is gentler than linear around the middle (fine control)', () => {
    expect(stickCurve(0.5)).toBeLessThan(0.5);
  });

  it('clamps the finger to the stick radius and normalises', () => {
    const inside = stickVector(30, -40, 100);
    expect(inside.kx).toBeCloseTo(0.3);
    expect(inside.ky).toBeCloseTo(-0.4);
    const outside = stickVector(300, 400, 100);
    expect(Math.hypot(outside.x, outside.y)).toBeCloseTo(100);
    expect(Math.hypot(outside.kx, outside.ky)).toBeCloseTo(1);
  });
});

describe('throttle slider', () => {
  it('maps the top of the track to 100 %, the bottom to 0 %, and clamps outside', () => {
    expect(sliderValue(100, 100, 200)).toBe(1);
    expect(sliderValue(300, 100, 200)).toBe(0);
    expect(sliderValue(200, 100, 200)).toBeCloseTo(0.5);
    expect(sliderValue(-50, 100, 200)).toBe(1);
    expect(sliderValue(999, 100, 200)).toBe(0);
  });
});
