import { describe, expect, it } from 'vitest';
import type { AircraftSnapshot } from '../src/physics/stateLayout';
import { TUTORIAL_STEPS, Tutorial } from '../src/ui/tutorial';

function quatPitchRoll(pitchDeg: number, rollDeg: number): [number, number, number, number] {
  // body -> world: heading north (+90 deg about Y), then pitch about Z, then roll about X
  const h = Math.PI / 4;
  const p = (pitchDeg * Math.PI) / 360;
  const r = (rollDeg * Math.PI) / 360;
  const mul = (a: number[], b: number[]): [number, number, number, number] => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
  return mul(mul([0, Math.sin(h), 0, Math.cos(h)], [0, 0, Math.sin(p), Math.cos(p)]), [Math.sin(r), 0, 0, Math.cos(r)]);
}

function snap(t: number, o: Partial<AircraftSnapshot> & { pitch?: number; roll?: number } = {}): AircraftSnapshot {
  const { pitch = 0, roll = 0, ...rest } = o;
  return {
    time: t, position: [0, 2000, 0], orientation: quatPitchRoll(pitch, roll), velocity: [0, 0, -180], angularVelocity: [0, 0, 0],
    crashed: false, airspeed: 180, altitude: 2000, mach: 0.5, alpha: 0.05, beta: 0, loadFactor: 1, throttle: 0.3,
    dynamicPressure: 0, stallWarning: false, crashKind: 0, crashTime: 0, impactTime: 99,
    warnMask: 0, warnLevel: 0, warnPrimary: -1, fuel: 3000, power: 0.3, afterburner: false, gLimiting: false,
    thrust: 0, gAvailable: 9, elevator: 0, ...rest,
  };
}

/** Feed the same state for `seconds` at 30 Hz; returns the last view. */
function feed(t: Tutorial, from: number, seconds: number, o: Parameters<typeof snap>[1] = {}) {
  let v = t.update(snap(from, o));
  for (let i = 1; i <= seconds * 30; i++) v = t.update(snap(from + i / 30, o));
  return v;
}

describe('Tutorial', () => {
  it('starts on the first step and does not advance while the condition is false', () => {
    const t = new Tutorial();
    expect(feed(t, 0, 3).index).toBe(0);
  });

  it('advances only after the condition has been held for the dwell time', () => {
    const t = new Tutorial();
    expect(feed(t, 0, 0.1, { pitch: 15 }).index).toBe(0);
    expect(feed(t, 1, 0.6, { pitch: 15 }).index).toBe(1);
  });

  it('resets the dwell timer when the condition breaks', () => {
    const t = new Tutorial();
    feed(t, 0, 0.2, { pitch: 15 }); // 0.2 s of the required 0.3 s
    feed(t, 0.25, 0.1, { pitch: 0 }); // condition breaks -> timer back to zero
    // another 0.2 s would complete the step (0.4 s total) if the timer had not been reset
    expect(feed(t, 0.4, 0.15, { pitch: 15 }).index).toBe(0);
  });

  it('walks through every step and reports done', () => {
    const t = new Tutorial();
    const states: Parameters<typeof snap>[1][] = [
      { pitch: 15 },
      { pitch: 0, roll: 0 },
      { roll: 60 },
      { roll: 0 },
      { throttle: 0.9 },
      { afterburner: true, throttle: 1 },
      { throttle: 0.3 },
      { warnMask: 1 << 7, altitude: 2000 },
      { warnMask: 1 },
      { warnMask: 0, altitude: 2000 },
    ];
    let time = 0;
    let v = t.update(snap(0));
    states.forEach((o) => {
      v = feed(t, time, 2, o);
      time += 3;
    });
    expect(TUTORIAL_STEPS.length).toBe(states.length);
    expect(v.done).toBe(true);
    expect(v.index).toBe(v.total);
  });

  it('skip moves to the next step; a crash freezes progress', () => {
    const t = new Tutorial();
    t.update(snap(0));
    t.skip();
    expect(t.update(snap(0.1)).index).toBe(1);
    expect(feed(t, 1, 3, { crashed: true, pitch: 0 }).index).toBe(1);
  });

  it('warns about PULL UP / low altitude outside the terrain step', () => {
    const t = new Tutorial();
    expect(t.update(snap(0, { warnMask: 1 })).caution).toContain('PULL UP');
    expect(t.update(snap(0.1, { altitude: 300 })).caution).toContain('高度');
  });
});
