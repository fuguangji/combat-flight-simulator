import { describe, expect, it } from 'vitest';
import { SnapshotBuffer } from '../src/physics/snapshotBuffer';
import { interpolateSnapshots, type AircraftSnapshot } from '../src/physics/stateLayout';

function snap(time: number, x: number): AircraftSnapshot {
  return {
    time, position: [x, 0, 0], orientation: [0, 0, 0, 1], velocity: [0, 0, 0], angularVelocity: [0, 0, 0],
    crashed: false, airspeed: x, altitude: 0, mach: 0, alpha: 0, beta: 0, loadFactor: 1, throttle: 0,
    dynamicPressure: 0, stallWarning: false,
  };
}

describe('SnapshotBuffer', () => {
  it('interpolates between bracketing snapshots (30 Hz -> 60+ Hz)', () => {
    const b = new SnapshotBuffer(0);
    for (let i = 0; i < 5; i++) b.push(snap(i / 30, i * 10), 1000 + (i * 1000) / 30);
    // wall time exactly halfway between snapshot 2 and 3
    const s = b.sample(1000 + (2.5 * 1000) / 30)!;
    expect(s.position[0]).toBeCloseTo(25);
  });

  it('delay shifts the sample into the past', () => {
    const b = new SnapshotBuffer(100);
    for (let i = 0; i < 10; i++) b.push(snap(i / 30, i * 10), (i * 1000) / 30);
    const now = (9 * 1000) / 30; // newest snapshot arrives "now"
    const s = b.sample(now)!;
    expect(s.time).toBeCloseTo(9 / 30 - 0.1, 3);
  });

  it('holds the newest state when starved instead of extrapolating', () => {
    const b = new SnapshotBuffer(0);
    b.push(snap(0, 0), 0);
    b.push(snap(1 / 30, 10), 33);
    expect(b.sample(5000)!.position[0]).toBe(10);
  });

  it('returns null when empty and clears on simulation reset', () => {
    const b = new SnapshotBuffer(0);
    expect(b.sample(0)).toBeNull();
    b.push(snap(5, 1), 0);
    b.push(snap(0, 2), 10); // time went backwards => reset
    expect(b.length).toBe(1);
  });

  it('tolerates arrival jitter without moving the sample clock backwards in sim time', () => {
    const b = new SnapshotBuffer(40);
    let prev = -Infinity;
    for (let i = 0; i < 60; i++) {
      const jitter = i % 3 === 0 ? 12 : 0;
      b.push(snap(i / 30, i), (i * 1000) / 30 + jitter);
      const t = b.sample((i * 1000) / 30 + 16)!.time;
      expect(t).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = t;
    }
  });
});

describe('interpolateSnapshots', () => {
  it('lerps scalars and keeps orientation normalised', () => {
    const r = interpolateSnapshots(snap(0, 0), snap(1, 10), 0.25);
    expect(r.position[0]).toBeCloseTo(2.5);
    expect(Math.hypot(...r.orientation)).toBeCloseTo(1);
  });
});
