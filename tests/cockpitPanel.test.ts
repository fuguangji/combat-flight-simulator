import { describe, expect, it } from 'vitest';
import { PANEL_VARIANTS, headShift, variantFor } from '../src/cockpit/panelVariants';
import { knobAngle, knobDrag, wrapValue } from '../src/cockpit/knob';
import { aircraftRegistry } from '../src/aircraft/registry';

describe('panel variants', () => {
  it('every aircraft has its own variant', () => {
    for (const a of aircraftRegistry.list()) expect(PANEL_VARIANTS[a.key]).toBeDefined();
  });
  it('variants are visually distinct', () => {
    const sig = Object.values(PANEL_VARIANTS).map((v) => `${v.layout}|${v.canopy}|${v.accent}|${v.dials}`);
    expect(new Set(sig).size).toBe(sig.length);
  });
  it('unknown keys fall back', () => expect(variantFor('nope').plate).toBe('GENERIC'));
});
describe('head shift', () => {
  it('panel slides opposite to the look direction', () => {
    expect(headShift(0.5, 0).x).toBeLessThan(0);
    expect(headShift(-0.5, 0).x).toBeGreaterThan(0);
    expect(headShift(0, 0.5).y).toBeGreaterThan(0);
    expect(headShift(0, 0)).toEqual({ x: -0, y: 0 });
  });
});
describe('knob', () => {
  it('angle spans the sweep', () => {
    expect(knobAngle(0, 0, 10)).toBe(-135);
    expect(knobAngle(10, 0, 10)).toBe(135);
    expect(knobAngle(5, 0, 10)).toBe(0);
  });
  it('drag snaps and clamps', () => {
    expect(knobDrag(500, 100, 500, 12000, 100)).toBe(6300);
    expect(knobDrag(500, -50, 500, 12000, 100)).toBe(500);
    expect(knobDrag(500, 9999, 500, 12000, 100)).toBe(12000);
  });
  it('wraps headings', () => {
    expect(wrapValue(360, 0, 359)).toBe(0);
    expect(wrapValue(-1, 0, 359)).toBe(359);
  });
});
