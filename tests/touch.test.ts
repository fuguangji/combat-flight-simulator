import { describe, expect, it } from 'vitest';
import { dpadTarget, rampAxis, sliderValue } from '../src/ui/touch';

describe('direction buttons', () => {
  const none = { up: false, down: false, left: false, right: false };
  it('maps buttons to pitch / roll with the keyboard convention (down = nose up)', () => {
    expect(dpadTarget(none)).toEqual({ pitch: 0, roll: 0 });
    expect(dpadTarget({ ...none, down: true })).toEqual({ pitch: 1, roll: 0 });
    expect(dpadTarget({ ...none, up: true })).toEqual({ pitch: -1, roll: 0 });
    expect(dpadTarget({ ...none, right: true })).toEqual({ pitch: 0, roll: 1 });
    expect(dpadTarget({ ...none, left: true })).toEqual({ pitch: 0, roll: -1 });
  });
  it('opposite buttons cancel and diagonals combine', () => {
    expect(dpadTarget({ up: true, down: true, left: false, right: false }).pitch).toBe(0);
    expect(dpadTarget({ up: false, down: true, left: true, right: false })).toEqual({ pitch: 1, roll: -1 });
  });
  it('ramps gradually toward a held button, saturates, and re-centres on release', () => {
    let v = 0;
    v = rampAxis(v, 1, 0.1);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(0.5);
    for (let i = 0; i < 100; i++) v = rampAxis(v, 1, 0.1);
    expect(v).toBe(1);
    for (let i = 0; i < 100; i++) v = rampAxis(v, 0, 0.1);
    expect(v).toBe(0);
    expect(rampAxis(-0.5, -1, 1)).toBe(-1);
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
