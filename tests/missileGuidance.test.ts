import { describe, expect, it } from 'vitest';
import { MISSILE_CATALOG } from '../src/combat/missileCatalog';
import { guideMissile } from '../src/combat/missileGuidance';
import weaponCatalog from '../src/combat/weapons.json';

const movingTarget = {
  position: [1000, 0, 0] as [number, number, number],
  velocity: [0, 0, 200] as [number, number, number],
};
const missile = {
  position: [0, 0, 0] as [number, number, number],
  velocity: [200, 0, 0] as [number, number, number],
  targetPosition: movingTarget.position,
  targetVelocity: movingTarget.velocity,
  deltaTime: 1 / 30,
};

describe('missile guidance programs', () => {
  it('keeps pure pursuit aimed at the target current position', () => {
    expect(guideMissile(missile, { program: 'pure-pursuit' })[2]).toBe(0);
  });

  it('leads a moving target when lead-pursuit is selected', () => {
    expect(guideMissile(missile, { program: 'lead-pursuit' })[2]).toBeGreaterThan(0);
  });

  it('uses configured proportional navigation to account for target motion', () => {
    const direction = guideMissile(missile, { program: 'proportional-navigation', navigationConstant: 3.5 });
    expect(direction[2]).toBeGreaterThan(0);
  });
});

describe('missile database', () => {
  it('defines independent guidance and 3D model data for every equipment missile', () => {
    const entries = Object.values(MISSILE_CATALOG);
    expect(entries).toHaveLength(10);
    expect(Object.keys(MISSILE_CATALOG)).toEqual(weaponCatalog.map(({ id }) => id));
    expect(new Set(entries.map(({ guidance }) => guidance.program)).size).toBeGreaterThan(1);
    for (const missile of entries) {
      expect(missile.launchSpeed).toBeGreaterThan(0);
      expect(missile.flightTime).toBeGreaterThan(0);
      expect(missile.model.length).toBeGreaterThan(0);
      expect(missile.model.radius).toBeGreaterThan(0);
      expect(missile.model.fins).toBeGreaterThan(0);
    }
  });
});
