import { describe, expect, it } from 'vitest';
import { FixedStepper } from '../src/core/fixedStep';

describe('FixedStepper', () => {
  it('runs exactly one step per dt of elapsed time', () => {
    const s = new FixedStepper(1 / 30, 100, 10); // limits raised so only dt matters here
    let n = 0;
    s.advance(1, () => n++);
    expect(n).toBe(30);
  });

  it('carries the remainder between calls', () => {
    const s = new FixedStepper(0.25); // powers of two keep the arithmetic exact
    let n = 0;
    for (let i = 0; i < 16; i++) s.advance(0.0625, () => n++);
    expect(n).toBe(4); // 1.0 s total
  });

  it('caps steps per call and drops the surplus instead of spiralling', () => {
    const s = new FixedStepper(1 / 30, 5, 10);
    let n = 0;
    s.advance(5, () => n++);
    expect(n).toBe(5);
    expect(s.dropEvents).toBe(1);
    n = 0;
    s.advance(1 / 30, () => n++); // no backlog left
    expect(n).toBe(1);
  });

  it('clamps a single huge elapsed time', () => {
    const s = new FixedStepper(0.1, 100, 0.25);
    let n = 0;
    s.advance(60, () => n++);
    expect(n).toBe(2);
  });

  it('ignores invalid elapsed values', () => {
    const s = new FixedStepper(0.1);
    let n = 0;
    s.advance(Number.NaN, () => n++);
    s.advance(-1, () => n++);
    expect(n).toBe(0);
  });
});
