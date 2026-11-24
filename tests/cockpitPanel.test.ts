import { describe, expect, it } from 'vitest';
import { panelAngle } from '../src/cockpit/cockpitShell';

const PERSPECTIVE = 1600;

describe('panelAngle', () => {
  it('is the identity when the 3D camera matches the CSS perspective', () => {
    for (const a of [-1.2, -0.3, 0, 0.5, 1.1]) expect(panelAngle(a, PERSPECTIVE)).toBeCloseTo(a, 9);
  });

  it('is odd (left and right look the same) and zero at zero', () => {
    expect(panelAngle(0, 700)).toBe(0);
    expect(panelAngle(0.7, 700)).toBeCloseTo(-panelAngle(-0.7, 700), 12);
  });

  it('moves a point straight ahead by the same pixels as the 3D scene', () => {
    // the scene shifts by pxPerTan * tan(angle); the panel by PERSPECTIVE * tan(cssAngle)
    for (const pxPerTan of [500, 732, 1200, 2400]) {
      for (const a of [0.1, 0.4, 0.9]) {
        const panelPx = PERSPECTIVE * Math.tan(panelAngle(a, pxPerTan));
        expect(panelPx).toBeCloseTo(pxPerTan * Math.tan(a), 6);
      }
    }
  });

  it('stays finite and monotonic far behind the pilot', () => {
    const a = panelAngle((150 * Math.PI) / 180, 732);
    expect(Number.isFinite(a)).toBe(true);
    expect(a).toBeGreaterThan(panelAngle(1, 732));
    expect(a).toBeLessThan(Math.PI / 2);
  });
});
