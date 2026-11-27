import { describe, expect, it } from 'vitest';
import { CARRIER, SITE_MARKERS } from '../src/world/sites';
import {
  calculateLandingGuidance,
  createLandingApproach,
  landingAdvice,
} from '../src/navigation/landingGuidance';

const alpha = SITE_MARKERS.find((site) => site.id === 'alpha')!;
const carrier = SITE_MARKERS.find((site) => site.id === 'carrier')!;

describe('landing guidance', () => {
  it('creates reciprocal airport approaches from either side of the runway', () => {
    const north = createLandingApproach(alpha, [alpha.x, 1200, alpha.z - 20_000], 0);
    expect(north.course).toBeCloseTo(Math.PI);
    expect(north.thresholdZ).toBe(alpha.z - 1200);
    expect(north.entryZ).toBe(north.thresholdZ - 10_000);

    const south = createLandingApproach(alpha, [alpha.x, 1200, alpha.z + 20_000], 0);
    expect(south.course).toBeCloseTo(0);
    expect(south.thresholdZ).toBe(alpha.z + 1200);
    expect(south.entryZ).toBe(south.thresholdZ + 10_000);
  });

  it('accounts for carrier deck height and gives LOC, glide, heading and sink-rate cues', () => {
    const approach = createLandingApproach(carrier, [CARRIER.cx, 1500, CARRIER.cz - 12_000], 0);
    const altitude = approach.surfaceHeight + 5000 * Math.tan(3 * Math.PI / 180) + 40;
    const state = {
      position: [CARRIER.cx + 100, altitude, approach.thresholdZ - 5000] as [number, number, number],
      heading: approach.course + 0.1,
      altitude,
      speed: 80,
      verticalSpeed: -4,
    };
    const guidance = calculateLandingGuidance(approach, state);

    expect(approach.surfaceHeight).toBe(CARRIER.deckY);
    expect(guidance.phase).toBe('FINAL');
    expect(guidance.lateralError).toBeCloseTo(-100);
    expect(guidance.glideError).toBeCloseTo(40);
    expect(guidance.headingError).toBeCloseTo(-0.1);
    expect(guidance.targetSinkRate).toBeCloseTo(-80 * Math.sin(3 * Math.PI / 180));
    expect(landingAdvice(guidance)).toContain('CORRECT RIGHT');
    expect(landingAdvice({ ...guidance, lateralError: 0 })).toContain('ABOVE GLIDE PATH');
  });
});
