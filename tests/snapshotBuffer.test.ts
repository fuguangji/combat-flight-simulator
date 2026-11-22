import { describe, expect, it } from 'vitest';
import { SnapshotBuffer } from '../src/physics/snapshotBuffer';
import { extrapolateSnapshot, interpolateSnapshots, type AircraftSnapshot } from '../src/physics/stateLayout';

function snap(time: number, x: number): AircraftSnapshot {
  return {
    time, position: [x, 0, 0], orientation: [0, 0, 0, 1], velocity: [0, 0, 0], angularVelocity: [0, 0, 0],
    crashed: false, airspeed: x, altitude: 0, mach: 0, alpha: 0, beta: 0, loadFactor: 1, throttle: 0,
    dynamicPressure: 0, stallWarning: false, crashKind: 0, crashTime: 0, impactTime: 99,
  };
}

/** Snapshot moving along +X at `v` m/s, position consistent with the time stamp. */
function moving(time: number, v: number): AircraftSnapshot {
  return { ...snap(time, v * time), velocity: [v, 0, 0] };
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

  it('can dead-reckon a late snapshot, but only up to the configured limit', () => {
    const b = new SnapshotBuffer(0, { maxExtrapolationMs: 100 });
    b.push(moving(0, 100), 0);
    b.push(moving(1 / 30, 100), 33);
    const last = 100 / 30;
    expect(b.sample(33 + 50)!.position[0]).toBeCloseTo(last + 100 * 0.05, 3);
    expect(b.sample(33 + 5000)!.position[0]).toBeCloseTo(last + 100 * 0.1, 3); // capped at 100 ms
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

describe('smooth (Hermite) interpolation', () => {
  it('reproduces constant-velocity motion exactly', () => {
    const r = interpolateSnapshots(moving(0, 100), moving(1 / 30, 100), 0.3, true);
    expect(r.position[0]).toBeCloseTo(100 * 0.3 / 30, 9);
  });

  it('is continuous in velocity across snapshot boundaries (no corners)', () => {
    // accelerating body: x = t^2 -> v = 2t. Piecewise-linear has a slope jump at every knot; Hermite does not.
    const mk = (t: number): AircraftSnapshot => ({ ...snap(t, t * t), velocity: [2 * t, 0, 0] });
    const [a, b, c] = [mk(0), mk(1 / 30), mk(2 / 30)];
    const eps = 1e-4;
    const slope = (p: AircraftSnapshot, q: AircraftSnapshot, t0: number, t1: number) =>
      (interpolateSnapshots(p, q, t1, true).position[0] - interpolateSnapshots(p, q, t0, true).position[0]) / ((t1 - t0) / 30);
    const endOfFirst = slope(a, b, 1 - eps, 1);
    const startOfSecond = slope(b, c, 0, eps);
    expect(Math.abs(endOfFirst - startOfSecond)).toBeLessThan(0.01);
  });

  it('falls back to a straight line on the crash step', () => {
    const a = moving(0, 100);
    const b = { ...snap(1 / 30, 3), velocity: [0, 0, 0] as [number, number, number], crashed: true };
    expect(interpolateSnapshots(a, b, 0.5, true).position[0]).toBeCloseTo(1.5);
  });
});

describe('extrapolateSnapshot', () => {
  it('moves along the velocity and leaves a wreck where it is', () => {
    expect(extrapolateSnapshot(moving(1, 50), 0.1).position[0]).toBeCloseTo(50 + 5);
    const wreck = { ...moving(1, 50), crashed: true };
    expect(extrapolateSnapshot(wreck, 0.1)).toBe(wreck);
  });

  it('keeps the orientation normalised while rotating', () => {
    const s = { ...snap(0, 0), angularVelocity: [1, 2, 3] as [number, number, number] };
    expect(Math.hypot(...extrapolateSnapshot(s, 0.1).orientation)).toBeCloseTo(1);
  });
});

describe('interpolateSnapshots', () => {
  it('lerps scalars and keeps orientation normalised', () => {
    const r = interpolateSnapshots(snap(0, 0), snap(1, 10), 0.25);
    expect(r.position[0]).toBeCloseTo(2.5);
    expect(Math.hypot(...r.orientation)).toBeCloseTo(1);
  });
});
