import { describe, expect, it } from 'vitest';
import { quatRotate, quatSlerp, type Quat } from '../src/core/math';
import { attitudeFromQuat } from '../src/cockpit/camera';
import { multiply, perspective, viewRotation } from '../src/rendering/mat4';

const s = Math.SQRT1_2;
const HEADING_NORTH: Quat = [0, s, 0, s]; // +90 deg about +Y: nose -> -Z

describe('quaternion math', () => {
  it('maps body axes to world for a north-facing aircraft', () => {
    const f = quatRotate(HEADING_NORTH, [1, 0, 0]);
    const r = quatRotate(HEADING_NORTH, [0, 0, 1]);
    expect(f[0]).toBeCloseTo(0);
    expect(f[2]).toBeCloseTo(-1);
    expect(r[0]).toBeCloseTo(1);
  });

  it('slerp hits endpoints and midpoint', () => {
    const a: Quat = [0, 0, 0, 1];
    const b: Quat = [0, s, 0, s]; // 90 deg
    expect(quatSlerp(a, b, 0)).toEqual(a);
    const mid = quatSlerp(a, b, 0.5);
    expect(mid[1]).toBeCloseTo(Math.sin(Math.PI / 8));
    expect(mid[3]).toBeCloseTo(Math.cos(Math.PI / 8));
  });

  it('slerp takes the shortest arc for opposite-sign quaternions', () => {
    const a: Quat = [0, 0, 0, 1];
    const b: Quat = [0, 0, 0, -1]; // same rotation
    const m = quatSlerp(a, b, 0.5);
    expect(Math.abs(m[3])).toBeCloseTo(1);
  });
});

describe('attitude extraction', () => {
  it('north-facing level flight', () => {
    const a = attitudeFromQuat(HEADING_NORTH);
    // heading wraps at 0/360, so compare on the circle (rounding noise can give 2*pi - 1e-16)
    expect(Math.cos(a.heading)).toBeCloseTo(1);
    expect(Math.sin(a.heading)).toBeCloseTo(0);
    expect(a.pitch).toBeCloseTo(0);
    expect(a.roll).toBeCloseTo(0);
  });

  it('heading 90 deg for an east-facing aircraft', () => {
    // identity: nose along +X = east
    const a = attitudeFromQuat([0, 0, 0, 1]);
    expect(a.heading).toBeCloseTo(Math.PI / 2);
  });

  it('positive roll means right wing down', () => {
    const half = 0.3 / 2; // roll right 0.3 rad about body X (forward) after heading north
    const roll: Quat = [Math.sin(half), 0, 0, Math.cos(half)];
    // q = heading * roll
    const [ax, ay, az, aw] = HEADING_NORTH;
    const [bx, by, bz, bw] = roll;
    const q: Quat = [
      aw * bx + ax * bw + ay * bz - az * by,
      aw * by - ax * bz + ay * bw + az * bx,
      aw * bz + ax * by - ay * bx + az * bw,
      aw * bw - ax * bx - ay * by - az * bz,
    ];
    expect(attitudeFromQuat(q).roll).toBeCloseTo(0.3);
  });
});

describe('mat4', () => {
  it('a point straight ahead projects to the screen centre in both clip conventions', () => {
    for (const zo of [true, false]) {
      const p = perspective(Math.PI / 2, 1, 1, 1000, zo);
      const v = viewRotation([1, 0, 0], [0, 1, 0], [0, 0, -1]); // looking down -Z
      const m = multiply(p, v);
      const pt = [0, 0, -10, 1];
      const clip = [0, 1, 2, 3].map((r) => m[r] * pt[0] + m[4 + r] * pt[1] + m[8 + r] * pt[2] + m[12 + r] * pt[3]);
      expect(clip[0] / clip[3]).toBeCloseTo(0);
      expect(clip[1] / clip[3]).toBeCloseTo(0);
      const z = clip[2] / clip[3];
      expect(z).toBeGreaterThan(zo ? 0 : -1);
      expect(z).toBeLessThan(1);
    }
  });

  it('near and far planes map to the clip-space limits', () => {
    const p = perspective(1, 1, 1, 100, true);
    const zAt = (d: number) => (p[10] * -d + p[14]) / (p[11] * -d);
    expect(zAt(1)).toBeCloseTo(0);
    expect(zAt(100)).toBeCloseTo(1);
  });
});
