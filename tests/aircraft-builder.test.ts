import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createModularAircraft, createAircraftPart, normalizeAircraftVisualConfig, type AircraftVisualConfig, type AircraftVisualInput, type LegacyAircraftVisualConfig } from '../src/aircraft/builder/modularAircraft';
import { AircraftModelController } from '../src/aircraft/builder/aircraftAnimation';
import { loadAircraftVisual, loadAircraftVisualConfig } from '../src/aircraft/builder/visualRepository';

const visualAssets = import.meta.glob('../src/aircraft/visuals/*.json', { eager: true, import: 'default' });

describe('modular aircraft component hierarchy', () => {
  it('builds geometry details inside their owning component', () => {
    const config: AircraftVisualConfig = {
      version: 2,
      name: 'Test aircraft',
      components: [
        { id: 'aircraft-root', name: '飛機本體' },
        { id: 'left-wing', name: '左機翼', parent: 'aircraft-root' },
      ],
      parts: [
        { id: 'wing-surface', componentId: 'left-wing', shape: 'polygon', plane: 'xz', depth: 0.12, vertices: [[1, 0], [0, 1], [-1, 0]], color: '#789abc' },
        { id: 'wing-tip', componentId: 'left-wing', shape: 'box' },
      ],
    };
    const model = createModularAircraft(config);
    expect(model.name).toBe('Test aircraft');
    expect(model.children).toHaveLength(1);
    expect(model.children[0].name).toBe('飛機本體');
    expect(model.children[0].children[0].name).toBe('左機翼');
    expect(model.children[0].children[0].children).toHaveLength(2);
  });

  it('rejects orphan components and orphan geometry details', () => {
    const orphanComponent: AircraftVisualConfig = {
      version: 2, components: [{ id: 'root', name: '根' }, { id: 'orphan', name: '孤兒', parent: 'missing' }], parts: [],
    };
    expect(() => createModularAircraft(orphanComponent)).toThrow(/孤兒組件/);
    const orphanDetail: AircraftVisualConfig = {
      version: 2, components: [{ id: 'root', name: '根' }], parts: [{ id: 'loose', componentId: 'missing', shape: 'box' }],
    };
    expect(() => createModularAircraft(orphanDetail)).toThrow(/孤兒細節/);
  });

  it('rejects circular component hierarchies and multiple roots', () => {
    const cyclic: AircraftVisualConfig = {
      version: 2, components: [{ id: 'root', name: '根' }, { id: 'a', name: 'A', parent: 'b' }, { id: 'b', name: 'B', parent: 'a' }], parts: [],
    };
    expect(() => createModularAircraft(cyclic)).toThrow(/循環/);
    const multipleRoots: AircraftVisualConfig = {
      version: 2, components: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], parts: [],
    };
    expect(() => createModularAircraft(multipleRoots)).toThrow(/根組件/);
  });

  it('migrates valid legacy version 1 data into a single-root component tree', () => {
    const legacy: LegacyAircraftVisualConfig = {
      version: 1,
      name: 'Legacy',
      parts: [
        { id: 'fuselage', shape: 'box', position: [1, 0, 0] },
        { id: 'nose', shape: 'cone', parent: 'fuselage', position: [2, 0, 0] },
        { id: 'wing', shape: 'box', position: [0, 0, 2] },
      ],
    };
    const migrated = normalizeAircraftVisualConfig(legacy);
    expect(migrated.version).toBe(2);
    expect(migrated.components).toHaveLength(4);
    expect(migrated.components.find((item) => item.id === 'component-nose')?.parent).toBe('component-fuselage');
    expect(migrated.parts.every((part) => migrated.components.some((component) => component.id === part.componentId))).toBe(true);
  });

  it('rejects orphaned legacy parts rather than silently moving them to root', () => {
    const legacy: LegacyAircraftVisualConfig = {
      version: 1, parts: [{ id: 'loose', shape: 'box', parent: 'not-found' }],
    };
    expect(() => normalizeAircraftVisualConfig(legacy)).toThrow(/孤兒零件/);
  });

  it('loads every checked-in aircraft visual through the same runtime builder', () => {
    expect(Object.keys(visualAssets).length).toBeGreaterThan(0);
    for (const [path, raw] of Object.entries(visualAssets)) {
      const model = createModularAircraft(raw as AircraftVisualInput);
      expect(model.children.length, path).toBe(1);
      const componentIds = new Set<string>();
      model.traverse((node) => {
        if (typeof node.userData.componentId === 'string') componentIds.add(node.userData.componentId);
      });
      expect(componentIds.size, path).toBeGreaterThan(0);
      model.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose());
        else if (mesh.material) mesh.material.dispose();
      });
    }
  });

  it('loads the editor asset by aircraft key through the shared game repository', () => {
    const config = loadAircraftVisualConfig('viper-t21');
    expect(config).not.toBeNull();
    expect(config?.version).toBe(2);
    expect(config?.components[0].id).toBe('aircraft-root');
    expect(config?.aircraftKey).toBe('viper-t21');
    expect(config?.components.some((component) => component.id === 'cockpit-interior')).toBe(true);
    expect(config?.components.find((component) => component.id === 'control-stick')?.animation?.channel).toBe('pitch');
    expect(config?.components.find((component) => component.id === 'canopy')?.animation?.channel).toBe('canopy');
    const loaded = loadAircraftVisual('viper-t21', 0);
    expect(loaded.config.version).toBe(2);
    expect(loaded.model.userData.aircraftKey).toBe('viper-t21');
    expect(loaded.model.userData.visualSchemaVersion).toBe(2);
  });

  it('rejects malformed geometry values before Three.js construction', () => {
    const invalid = {
      version: 2,
      components: [{ id: 'root', name: '根' }],
      parts: [{ id: 'bad', componentId: 'root', shape: 'box', position: [0, Number.NaN, 0] }],
    } as unknown as AircraftVisualConfig;
    expect(() => createModularAircraft(invalid)).toThrow(/position 必須是三個有限數值/);
  });

  it('accepts the exact v2 JSON shape exported by the editor', () => {
    const editorExport = JSON.stringify({
      version: 2,
      name: 'Editor export',
      components: [
        { id: 'aircraft-root', name: '飛機本體' },
        { id: 'cannon', name: '機炮', parent: 'aircraft-root', position: [1, 0, 0] },
      ],
      parts: [
        { id: 'cannon-body', componentId: 'cannon', shape: 'hollowCylinder', radius: 0.2, innerRadius: 0.1, height: 1 },
      ],
    });
    const config = JSON.parse(editorExport) as AircraftVisualInput;
    const model = createModularAircraft(config);
    expect(model.children[0].children[0].name).toBe('機炮');
    expect(model.children[0].children[0].children[0].name).toBe('cannon-body');
  });

  it('animates only components with explicit visual animation bindings', () => {
    const config: AircraftVisualConfig = {
      version: 2,
      components: [
        { id: 'aircraft-root', name: '飛機本體' },
        { id: 'gear-door', name: '起落架艙門', parent: 'aircraft-root', animation: { channel: 'gear', axis: 'z', min: 0, max: -Math.PI / 2 } },
        { id: 'control-surface', name: '控制面', parent: 'aircraft-root', animation: { channel: 'roll', axis: 'x', min: -0.2, max: 0.2 } },
      ],
      parts: [
        { id: 'door-panel', componentId: 'gear-door', shape: 'box' },
        { id: 'surface-panel', componentId: 'control-surface', shape: 'box' },
      ],
    };
    const model = createModularAircraft(config);
    const controller = new AircraftModelController(model, config.components);
    controller.setControls({ gear: 1, roll: 1 });
    for (let frame = 0; frame < 24; frame++) controller.update(0.1);
    const gear = controller.getComponent('gear-door');
    const surface = controller.getComponent('control-surface');
    expect(gear?.rotation.z).toBeCloseTo(-Math.PI / 2, 2);
    expect(surface?.rotation.x).toBeCloseTo(0.2, 2);
    controller.reset();
    expect(gear?.rotation.z).toBeCloseTo(0);
    expect(surface?.rotation.x).toBeCloseTo(0);
  });

  it('rejects invalid animation channels and non-finite angles', () => {
    const invalid = {
      version: 2,
      components: [
        { id: 'root', name: '根' },
        { id: 'bad', name: '錯誤動畫', parent: 'root', animation: { channel: 'fire', axis: 'x', min: 0, max: Number.NaN } },
      ],
      parts: [],
    } as unknown as AircraftVisualConfig;
    expect(() => createModularAircraft(invalid)).toThrow(/動畫通道無效/);
  });

  it('supports visibility and primitive dimensions for standalone geometry details', () => {
    const part = createAircraftPart({
      id: 'engine', componentId: 'engine-component', shape: 'cylinder', radiusTop: 0.2, radiusBottom: 0.3, height: 2,
      position: [1, 2, 3], rotation: [0, 0, 1], scale: [2, 1, 1], visible: false,
    });
    expect(part.visible).toBe(false);
    expect(part.position.toArray()).toEqual([1, 2, 3]);
    expect(part.scale.toArray()).toEqual([2, 1, 1]);
    expect((part.children[0] as import('three').Mesh).geometry.type).toBe('CylinderGeometry');
  });
});
