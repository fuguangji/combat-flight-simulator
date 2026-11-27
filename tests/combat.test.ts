import { describe, expect, it } from 'vitest';
import { CombatSimulation, distanceBetween } from '../src/combat/simulation';

const aircraft = {
  position: [0, 1000, 0] as [number, number, number],
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

  it('guides a missile to its selected target and records target destruction', () => {
    const sim = new CombatSimulation();
    sim.reset(aircraft.position, 0);
    const target = sim.getContact('ECHO-01')!;
    target.position = [0, 1000, -300];

    expect(sim.fireMissile(aircraft, target.id, '#7de7ff')).toBe(true);
    for (let i = 0; i < 30 && target.alive; i++) sim.update(0.05);

    expect(target.alive).toBe(false);
    expect(sim.destroyedCount).toBe(1);
    expect(sim.impacts).toHaveLength(1);
  });

  it('uses the cannon ammo supply and damages a target inside the firing line', () => {
    const sim = new CombatSimulation();
    sim.reset(aircraft.position, 0);
    const target = sim.getContact('ECHO-01')!;
    target.position = [0, 1000, -300];

    for (let i = 0; i < 5; i++) {
      expect(sim.fireCannon(aircraft)).toMatchObject({ fired: true, hitId: target.id });
    }

    expect(target.alive).toBe(false);
    expect(sim.cannonRounds).toBe(595);
    expect(sim.fireCannon(aircraft).fired).toBe(true);
  });

  it('destroys a ground site and leaves a persistent crater impact', () => {
    const sim = new CombatSimulation();
    sim.reset(aircraft.position, 0);
    const site = sim.getContact('SITE-01')!;
    site.position = [0, 0, -80];

    sim.fireMissile(aircraft, site.id, '#ff985c');
    for (let i = 0; i < 120 && site.alive; i++) sim.update(0.05);

    expect(site.alive).toBe(false);
    expect(sim.impacts[0]).toMatchObject({ radius: 58, age: expect.any(Number) });
  });
});
