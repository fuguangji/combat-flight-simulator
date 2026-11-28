import { describe, expect, it } from 'vitest';
import { CombatSimulation, distanceBetween } from '../src/combat/simulation';

const aircraft = {
  position: [0, 1000, 0] as [number, number, number],
  velocity: [0, 0, -180] as [number, number, number],
  orientation: [0, Math.SQRT1_2, 0, Math.SQRT1_2] as [number, number, number, number],
};

describe('combat simulation', () => {
  it('creates radar contacts in world space around the mission start', () => {
    const sim = new CombatSimulation();
    sim.reset(aircraft.position, 0);

    expect(sim.contacts).toHaveLength(5);
    expect(sim.contacts.filter((contact) => contact.kind === 'air')).toHaveLength(3);
    expect(sim.contacts.filter((contact) => contact.kind === 'ground')).toHaveLength(2);
    expect(distanceBetween(sim.contacts[0].position, aircraft.position)).toBeGreaterThan(1000);
    expect(sim.contacts[3].position[1]).toBe(0);
  });

  it('keeps air contacts stationary until a physics entity reports its state', () => {
    const sim = new CombatSimulation();
    sim.reset(aircraft.position, 0);
    const target = sim.getContact('ECHO-01')!;
    const initial = [...target.position];
    sim.update(0.05);
    expect(target.position).toEqual(initial);

    sim.updateAirContact(target.id, [120, 1100, -2000], [20, 0, -175]);
    expect(target.position).toEqual([120, 1100, -2000]);
    expect(target.velocity).toEqual([20, 0, -175]);
  });

  it('guides a missile to its selected target and records target destruction', () => {
    const sim = new CombatSimulation();
    sim.reset(aircraft.position, 0);
    const target = sim.getContact('ECHO-01')!;
    target.position = [0, 1000, -300];
    target.previousPosition = [...target.position];

    expect(sim.fireMissile(aircraft, target.id, '#7de7ff', {
      id: 'meteor88',
      effect: 'COMET TRAIL',
      life: 1.4,
    })).toBe(true);
    expect(target.alive).toBe(true);
    expect(sim.missiles).toHaveLength(1);
    expect(sim.missiles[0]).toMatchObject({ equipmentId: 'meteor88', effect: 'COMET TRAIL', life: 1.4 });
    sim.update(0.05);
    expect(sim.missiles[0].position[2]).toBeLessThan(0);
    expect(sim.missiles[0].velocity[1]).toBeLessThan(0);
    for (let i = 0; i < 30 && target.alive; i++) sim.update(0.05);

    expect(target.alive).toBe(false);
    expect(sim.destroyedCount).toBe(1);
    expect(sim.impacts).toHaveLength(1);
    expect(sim.impacts[0]).toMatchObject({ kind: 'missile', effect: 'COMET TRAIL', color: '#7de7ff' });
  });

  it('gives different missile equipment distinct launch and guidance performance', () => {
    const sim = new CombatSimulation();
    sim.reset(aircraft.position, 0);
    const target = sim.getContact('ECHO-01')!;
    target.position = [0, 1000, -3000];
    target.previousPosition = [...target.position];

    sim.fireMissile(aircraft, target.id, '#ffc56b', { id: 'stinger05', effect: 'SPARK DART' });
    sim.fireMissile(aircraft, target.id, '#7de7ff', { id: 'meteor88', effect: 'COMET TRAIL' });
    sim.update(0.05);

    expect(sim.missiles[0].velocity).not.toEqual(sim.missiles[1].velocity);
    expect(sim.missiles[0].trail).toHaveLength(2);
    expect(sim.missiles[1].trail).toHaveLength(2);
  });

  it('launches finite-speed cannon rounds that damage a target only after flight and collision', () => {
    const sim = new CombatSimulation();
    sim.reset(aircraft.position, 0);
    const target = sim.getContact('ECHO-01')!;
    target.position = [0, 1000, -300];
    target.previousPosition = [...target.position];

    for (let i = 0; i < 5; i++) {
      expect(sim.fireCannon(aircraft)).toBe(true);
    }
    expect(target.health).toBe(5);
    expect(sim.bullets).toHaveLength(5);
    for (let i = 0; i < 10 && target.alive; i++) sim.update(0.05);

    expect(target.alive).toBe(false);
    expect(sim.cannonRounds).toBe(595);
    expect(sim.drainProjectileHits()).toEqual([
      { targetId: target.id, weapon: 'cannon' },
      { targetId: target.id, weapon: 'cannon' },
      { targetId: target.id, weapon: 'cannon' },
      { targetId: target.id, weapon: 'cannon' },
      { targetId: target.id, weapon: 'cannon' },
    ]);
    expect(sim.fireCannon(aircraft)).toBe(true);
  });

  it('destroys a ground site and leaves a persistent crater impact', () => {
    const sim = new CombatSimulation();
    sim.reset(aircraft.position, 0);
    const site = sim.getContact('SITE-01')!;
    site.position = [0, 0, -2000];

    sim.fireMissile(aircraft, site.id, '#ff985c');
    for (let i = 0; i < 120 && site.alive; i++) sim.update(0.05);

    expect(site.alive).toBe(false);
    expect(sim.impacts[0]).toMatchObject({ radius: 58, age: expect.any(Number) });
  });
});
