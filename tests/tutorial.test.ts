import { describe, expect, it } from 'vitest';
import type { AircraftSnapshot } from '../src/physics/stateLayout';
import { TUTORIAL_CHAPTERS, Tutorial, bearingTo, chapterSteps } from '../src/ui/tutorial';

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
    thrust: 0, gAvailable: 9, elevator: 0, landed: false, landingKind: 0, landingSink: 0, ...rest,
  };
}

/** Feed the same state for `seconds` at 30 Hz; returns the last view. */
function feed(t: Tutorial, from: number, seconds: number, o: Parameters<typeof snap>[1] = {}) {
  let v = t.update(snap(from, o));
  for (let i = 1; i <= seconds * 30; i++) v = t.update(snap(from + i / 30, o));
  return v;
}

const [CONTROLS, SETUP, KNOWLEDGE] = TUTORIAL_CHAPTERS;
const all = { afterburner: true, touch: false };
const steps = (c: (typeof TUTORIAL_CHAPTERS)[number], o = all) => chapterSteps(c, o);
/** A chapter-1 tutorial already past the overview page. */
const flying = (): Tutorial => {
  const t = new Tutorial(steps(CONTROLS));
  t.update(snap(0));
  t.acknowledge();
  return t;
};

describe('chapters', () => {
  it('has three chapters in the intended order', () => {
    expect(TUTORIAL_CHAPTERS.map((c) => c.id)).toEqual(['controls', 'setup', 'knowledge']);
    for (const c of TUTORIAL_CHAPTERS) expect(c.steps.length).toBeGreaterThan(5);
  });

  it('filters steps by aircraft and input device', () => {
    const ids = (o: { afterburner: boolean; touch: boolean }) => steps(CONTROLS, o).map((x) => x.id);
    expect(ids(all)).toContain('afterburner');
    expect(ids(all)).toContain('rudder');
    expect(ids({ afterburner: false, touch: false })).not.toContain('afterburner');
    expect(ids({ afterburner: true, touch: true })).not.toContain('rudder');
  });

  it('every step has a title, a hint and unique ids within its chapter', () => {
    for (const c of TUTORIAL_CHAPTERS) {
      const seenIds = new Set<string>();
      for (const st of c.steps) {
        expect(st.title.length).toBeGreaterThan(0);
        expect(st.hint.length).toBeGreaterThan(0);
        expect(seenIds.has(st.id), st.id).toBe(false);
        seenIds.add(st.id);
        if (st.kind === 'read') expect((st.body ?? []).length).toBeGreaterThan(0);
      }
    }
  });
});

describe('Tutorial (chapter 1)', () => {
  it('opens on a reading page that the autopilot covers, and only advances on acknowledge', () => {
    const t = new Tutorial(steps(CONTROLS));
    const v = feed(t, 0, 5);
    expect(v.index).toBe(0);
    expect(v.kind).toBe('read');
    expect(v.wantsAutopilot).toBe(true);
    t.acknowledge();
    const next = t.update(snap(6));
    expect(next.index).toBe(1);
    expect(next.kind).toBe('action');
    expect(next.wantsAutopilot).toBe(false);
  });

  it('advances only after the condition has been held for the dwell time', () => {
    const t = flying();
    expect(feed(t, 0, 0.1, { pitch: 15 }).index).toBe(1);
    expect(feed(t, 0.1, 0.6, { pitch: 15 }).index).toBe(2);
  });

  it('resets the dwell timer when the condition breaks', () => {
    const t = flying();
    feed(t, 0, 0.2, { pitch: 15 });
    feed(t, 0.2, 0.1, { pitch: 0 });
    expect(feed(t, 0.3, 0.15, { pitch: 15 }).index).toBe(1);
  });

  it('walks through every step and reports done', () => {
    const list = steps(CONTROLS);
    const t = new Tutorial(list);
    const states: Record<string, Parameters<typeof snap>[1]> = {
      pitch: { pitch: 15 },
      level: { pitch: 0, roll: 0 },
      roll: { roll: 60 },
      unroll: { roll: 0 },
      rudder: { beta: 0.1 },
      throttle: { throttle: 0.9 },
      afterburner: { afterburner: true, throttle: 1 },
      idle: { throttle: 0.3 },
    };
    let time = 0;
    t.update(snap(0));
    t.acknowledge();
    let v = t.update(snap(0.1));
    for (const st of list.slice(1)) {
      if (st.id === 'look') t.note('look');
      if (st.id === 'recenter') t.note('recenter');
      v = feed(t, time, 2, states[st.id] ?? {});
      time += 3;
    }
    expect(v.done).toBe(true);
    expect(v.index).toBe(v.total);
  });

  it('event steps need the event to happen during the step', () => {
    const t = new Tutorial(steps(CONTROLS).filter((x) => x.id === 'look'));
    t.update(snap(0));
    expect(feed(t, 0.1, 2).index).toBe(0);
    t.note('look');
    expect(feed(t, 3, 1).done).toBe(true);
  });

  it('skip moves to the next step; a crash freezes progress', () => {
    const t = flying();
    t.skip();
    expect(t.update(snap(0.1)).index).toBe(2);
    expect(feed(t, 1, 3, { crashed: true }).index).toBe(2);
  });

  it('warns about PULL UP / low altitude outside the terrain step, but not on reading pages', () => {
    const t = flying();
    expect(t.update(snap(1, { warnMask: 1 })).caution).toContain('PULL UP');
    expect(t.update(snap(1.1, { altitude: 300 })).caution).toContain('高度');
    const r = new Tutorial(steps(CONTROLS));
    expect(r.update(snap(0, { warnMask: 1 })).caution).toBeNull();
  });
});

describe('Tutorial (chapter 2)', () => {
  it('follows panel switches, waypoint, contact and autopilot', () => {
    const t = new Tutorial(steps(SETUP));
    t.update(snap(0));
    let v = feed(t, 0, 1);
    expect(v.title).toBe('開啟地圖');
    t.setFlag('map', true);
    v = feed(t, 1, 1);
    expect(v.title).toBe('開啟導航資料');
    t.setFlag('nav', true);
    v = feed(t, 2, 1);
    expect(v.title).toBe('設定航點');
    t.note('waypoint');
    v = feed(t, 3, 0.1);
    expect(v.title).toBe('飛向航點');
  });

  it('steering needs the heading within 20 degrees of the waypoint bearing', () => {
    const list = steps(SETUP).filter((x) => x.id === 'steer');
    const t = new Tutorial(list);
    // aircraft at the origin flying north (heading 0); waypoint due east then due north
    t.setWaypoint({ x: 10000, z: 0 });
    expect(feed(t, 0, 3).done).toBe(false);
    t.setWaypoint({ x: 0, z: -10000 });
    expect(feed(t, 4, 3).done).toBe(true);
  });

  it('bearingTo uses the map convention (north = -z, east = +x)', () => {
    expect(bearingTo({ x: 0, z: 0 }, { x: 0, z: -5 })).toBeCloseTo(0);
    expect(bearingTo({ x: 0, z: 0 }, { x: 5, z: 0 })).toBeCloseTo(Math.PI / 2);
    expect(bearingTo({ x: 0, z: 0 }, { x: 0, z: 5 })).toBeCloseTo(Math.PI);
  });

  it('teaches selecting a landing beacon and waits for approach guidance to activate', () => {
    const list = steps(SETUP).filter((x) => x.id === 'landing-site' || x.id === 'landing-guide');
    const t = new Tutorial(list);
    t.update(snap(0));
    t.note('landing-site');
    expect(t.update(snap(0.1)).title).toBe('跟隨進場導引');
    t.setFlag('landingGuide', true);
    expect(feed(t, 0.2, 1).done).toBe(true);
  });

  it('autopilot on then off completes the pair of steps', () => {
    const list = steps(SETUP).filter((x) => x.id === 'autopilot-on' || x.id === 'autopilot-off');
    const t = new Tutorial(list);
    t.update(snap(0));
    t.setFlag('autopilot', true);
    expect(feed(t, 0.1, 1).title).toBe('手動接管');
    t.setFlag('autopilot', false);
    expect(feed(t, 2, 1).done).toBe(true);
  });
});

describe('Tutorial (chapter 3)', () => {
  it('starts with reading pages and ends with the hands-on warning drills', () => {
    const list = steps(KNOWLEDGE);
    expect(list[0].kind).toBe('read');
    expect(list.slice(-3).map((x) => x.id)).toEqual(['aoa', 'terrain', 'recover']);
    const t = new Tutorial(list);
    t.update(snap(0));
    for (const st of list) if (st.kind === 'read') t.acknowledge();
    expect(t.update(snap(1)).title).toContain('迎角');
    let v = feed(t, 1, 2, { warnMask: 1 << 7, altitude: 2000 });
    v = feed(t, 4, 2, { warnMask: 1 });
    v = feed(t, 7, 2, { warnMask: 0, altitude: 2000 });
    expect(v.done).toBe(true);
  });
});
