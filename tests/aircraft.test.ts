import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AircraftDataError,
  AircraftDefinition,
  AircraftRegistry,
  PHYSICS_KEYS,
  aircraftRegistry,
} from '../src/aircraft/registry';

const dir = fileURLToPath(new URL('../src/aircraft/data/', import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
const raw = (f: string): any => JSON.parse(readFileSync(dir + f, 'utf8'));

describe('aircraft JSON files', () => {
  it('every file validates and produces a parameter array of the right length', () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const f of files) {
      const def = AircraftDefinition.fromJson(raw(f), f);
      const hullPoints = raw(f).physics.hull.length;
      expect(def.toPhysicsArray().length, f).toBe(PHYSICS_KEYS.length + 3 * hullPoints);
      expect(def.fovY).toBeGreaterThan(0.5);
    }
  });

  it('stores engine thrust in newtons and keeps display thrust in kilonewtons', () => {
    for (const f of files) {
      const json = raw(f);
      const p = json.physics;
      const thrustKN = json.specs?.thrustKN;
      expect(p.max_thrust_sl, f).toBeGreaterThan(10_000);
      expect(p.ab_thrust_sl, f).toBeGreaterThanOrEqual(p.max_thrust_sl);
      expect(thrustKN, f).toBeGreaterThan(0);
      const maxPhysicsThrust = p.ab_thrust_sl > p.max_thrust_sl * 1.001 ? p.ab_thrust_sl : p.max_thrust_sl;
      expect(maxPhysicsThrust / 1000, f).toBeCloseTo(thrustKN, 6);
    }
  });

  it('ids and keys are unique, and the registry glob finds every file', () => {
    const reg = aircraftRegistry.list();
    expect(reg.length).toBe(files.length);
    expect(new Set(reg.map((a) => a.id)).size).toBe(reg.length);
    expect(new Set(reg.map((a) => a.key)).size).toBe(reg.length);
    expect(aircraftRegistry.default.id).toBe(Math.min(...reg.map((a) => a.id)));
  });

  it('the parameter array follows the key order', () => {
    const f = files[0];
    const json = raw(f);
    const arr = AircraftDefinition.fromJson(json, f).toPhysicsArray();
    PHYSICS_KEYS.forEach((k, i) => expect(arr[i], k).toBe(json.physics[k]));
  });
});

describe('validation and registry', () => {
  it('reports every problem at once', () => {
    const bad = raw(files[0]);
    delete bad.physics.mass_nonexistent;
    delete bad.physics.wing_area;
    bad.physics.surprise = 1;
    bad.key = 'Not Kebab';
    bad.physics.hull = [];
    try {
      AircraftDefinition.fromJson(bad, 'bad.json');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e instanceof AircraftDataError).toBe(true);
      const msg = (e as AircraftDataError).problems.join(' | ');
      expect(msg).toContain('wing_area');
      expect(msg).toContain('surprise');
      expect(msg).toContain('key');
      expect(msg).toContain('hull');
    }
  });

  it('rejects non-numbers and duplicate registrations', () => {
    const bad = raw(files[0]);
    bad.physics.cd0 = 'high';
    expect(() => AircraftDefinition.fromJson(bad)).toThrow(AircraftDataError);
    expect(() => AircraftDefinition.fromJson(null)).toThrow(AircraftDataError);
    const a = AircraftDefinition.fromJson(raw(files[0]));
    const reg = new AircraftRegistry().register(a);
    expect(() => reg.register(a)).toThrow(/Duplicate/);
    expect(() => reg.get(999)).toThrow(/Unknown/);
  });

  it('derived facts follow the data (trainer has no afterburner, fighter does)', () => {
    const heavy = aircraftRegistry.find('apollo-castle-37');
    const fighter = aircraftRegistry.find('viper-t21');
    expect(heavy?.hasAfterburner).toBe(false);
    expect(fighter?.hasAfterburner).toBe(true);
  });
});
