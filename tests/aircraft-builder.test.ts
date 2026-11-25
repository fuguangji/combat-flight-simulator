import { describe, expect, it } from 'vitest';
import { createModularAircraft, createAircraftPart, type AircraftVisualConfig } from '../src/aircraft/builder/modularAircraft';

describe('modular aircraft geometry builder', () => {
  it('creates independently named polygon parts from editable vertices', () => {
    const config: AircraftVisualConfig = {
      version: 1,
      name: 'Test aircraft',
      parts: [
        { id: 'root-wing', shape: 'polygon', plane: 'xz', depth: 0.12, vertices: [[1, 0], [0, 1], [-1, 0]], color: '#789abc' },
        { id: 'wing-tip', shape: 'polygon', plane: 'xz', parent: 'root-wing', vertices: [[0, 0], [0, 1], [-1, 1]], color: '#abcdef' },
      ],
    };
    const model = createModularAircraft(config);
    expect(model.name).toBe('Test aircraft');
    expect(model.children).toHaveLength(1);
    expect(model.children[0].name).toBe('root-wing');
    expect(model.children[0].children[0].name).toBe('root-wing:mesh');
    expect(model.children[0].children[0].geometry.getAttribute('position').count).toBeGreaterThan(0);
    expect(model.children[0].children[0].children).toHaveLength(0);
  });

  it('supports visibility, transforms and primitive dimensions', () => {
    const part = createAircraftPart({
      id: 'engine', shape: 'cylinder', radiusTop: 0.2, radiusBottom: 0.3, height: 2,
      position: [1, 2, 3], rotation: [0, 0, 1], scale: [2, 1, 1], visible: false,
    });
    expect(part.visible).toBe(false);
    expect(part.position.toArray()).toEqual([1, 2, 3]);
    expect(part.scale.toArray()).toEqual([2, 1, 1]);
    expect((part.children[0] as import('three').Mesh).geometry.type).toBe('CylinderGeometry');
  });
});
