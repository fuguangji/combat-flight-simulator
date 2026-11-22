import { describe, expect, it } from 'vitest';
import { DynamicResolution } from '../src/rendering/dynamicResolution';

describe('DynamicResolution', () => {
  it('stays at full scale when frames are on time', () => {
    const d = new DynamicResolution();
    for (let i = 0; i < 600; i++) d.update(16.7);
    expect(d.scale).toBe(1);
  });

  it('lowers the scale under sustained load, never below the minimum', () => {
    const d = new DynamicResolution({ min: 0.6 });
    for (let i = 0; i < 5000; i++) d.update(30);
    expect(d.scale).toBeCloseTo(0.6);
  });

  it('probes upward again once frames are on time', () => {
    const d = new DynamicResolution();
    for (let i = 0; i < 400; i++) d.update(30);
    const low = d.scale;
    for (let i = 0; i < 3000; i++) d.update(16.7);
    expect(d.scale).toBeGreaterThan(low);
  });

  it('ignores huge stalls such as a background tab', () => {
    const d = new DynamicResolution();
    d.update(5000);
    expect(d.scale).toBe(1);
  });
});
