import { describe, expect, it } from 'vitest';
import { applyLook, bodyDirToView } from '../src/cockpit/camera';
import type { CameraState } from '../src/rendering/Renderer';
import { FreeLook } from '../src/ui/look';

const cam = (): CameraState => ({ position: [0, 0, 0], forward: [1, 0, 0], up: [0, 1, 0], right: [0, 0, 1], fovY: 1 });
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const near = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('applyLook', () => {
  it('is the identity for zero angles', () => {
    expect(applyLook(cam(), 0, 0)).toEqual(cam());
  });

  it('yaw +90 deg looks along the right wing; pitch +90 looks along the canopy axis', () => {
    const r = applyLook(cam(), Math.PI / 2, 0);
    near(r.forward[2], 1);
    const u = applyLook(cam(), 0, Math.PI / 2);
    near(u.forward[1], 1);
  });

  it('keeps the basis orthonormal for arbitrary angles', () => {
    const c = applyLook(cam(), 1.1, -0.7);
    near(dot(c.forward, c.forward), 1);
    near(dot(c.up, c.up), 1);
    near(dot(c.right, c.right), 1);
    near(dot(c.forward, c.up), 0);
    near(dot(c.forward, c.right), 0);
    near(dot(c.up, c.right), 0);
  });
});

describe('bodyDirToView', () => {
  it('maps the nose to straight ahead when not looking and to the left of view when looking right', () => {
    const a = bodyDirToView([1, 0, 0], 0, 0);
    expect(a).toEqual([1, 0, 0]);
    const b = bodyDirToView([1, 0, 0], 0.5, 0); // head turned right: the nose appears on the left
    expect(b[2]).toBeLessThan(0);
    const c = bodyDirToView([1, 0, 0], 0, 0.5); // head turned up: the nose appears below centre
    expect(c[1]).toBeLessThan(0);
  });
});

describe('FreeLook', () => {
  it('mouse right turns the head right and rotation remains unlimited across full turns', () => {
    const l = new FreeLook();
    l.move(100, 0);
    expect(l.yaw).toBeGreaterThan(0);
    l.move(0, -100);
    expect(l.pitch).toBeGreaterThan(0);
    l.move(1e6, -1e6);
    expect(l.yaw).toBeGreaterThan(Math.PI * 2);
    expect(l.pitch).toBeGreaterThan(Math.PI * 2);
  });

  it('recentering eases back to exactly zero and moving cancels it', () => {
    const l = new FreeLook();
    l.move(300, 100);
    l.recenter();
    for (let i = 0; i < 120; i++) l.update(1 / 60);
    expect(l.active).toBe(false);
    l.move(100, 0);
    l.recenter();
    l.move(10, 0);
    expect(l.recentering).toBe(false);
  });
});
