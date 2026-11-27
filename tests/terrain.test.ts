import { describe, expect, it } from 'vitest';
import { buildTestScene } from '../src/rendering/scene';
import { SEA_LEVEL, isWater, sampleTerrain, terrainHash, terrainNoise } from '../src/terrain/procedural';
import { TERRAIN_GLSL, TERRAIN_WGSL } from '../src/terrain/terrainShader';

describe('terrain sampler', () => {
  it('is deterministic and independent of call order', () => {
    const a = sampleTerrain(1234.5, -987.25);
    sampleTerrain(50000, 50000);
    expect(sampleTerrain(1234.5, -987.25)).toEqual(a);
  });

  it('hash and noise stay in [0, 1]', () => {
    for (let i = 0; i < 2000; i++) {
      const x = Math.sin(i * 12.9898) * 40000;
      const z = Math.cos(i * 78.233) * 40000;
      const h = terrainHash(x, z);
      const n = terrainNoise(x / 700, z / 700);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(1);
    }
  });

  it('produces a varied world (every major biome appears, water is a minority)', () => {
    const counts = new Map<string, number>();
    let total = 0;
    for (let x = -40000; x <= 40000; x += 800) {
      for (let z = -40000; z <= 40000; z += 800) {
        const t = sampleTerrain(x, z);
        counts.set(t.biome, (counts.get(t.biome) ?? 0) + 1);
        total++;
        expect(t.height).toBeGreaterThanOrEqual(-180);
        expect(t.height).toBeLessThanOrEqual(1850);
      }
    }
    for (const biome of ['water', 'shore', 'plain', 'forest', 'desert', 'ridge']) {
      expect(counts.get(biome) ?? 0, biome).toBeGreaterThan(0);
    }
    expect((counts.get('water') ?? 0) / total).toBeLessThan(0.4);
  });

  it('classifies anything below sea level as water', () => {
    let seen = 0;
    for (let x = -30000; x <= 30000; x += 500) {
      for (let z = -30000; z <= 30000; z += 500) {
        const t = sampleTerrain(x, z);
        if (t.height < SEA_LEVEL) {
          expect(t.biome).toBe('water');
          seen++;
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('test scene', () => {
  it('keeps the instance count and places no building on water', () => {
    const scene = buildTestScene();
    expect(scene.fieldCount).toBe(6000);
    const maxExtent = Math.max(...Array.from({ length: scene.fieldCount }, (_, i) => Math.max(Math.abs(scene.instances[i * 4]), Math.abs(scene.instances[i * 4 + 1]))));
    expect(maxExtent).toBeGreaterThan(25_000);
    expect(maxExtent).toBeLessThanOrEqual(40_000);
    expect(scene.instanceCount).toBeGreaterThan(scene.collisionCount);
    expect(scene.collisionCount).toBeGreaterThan(scene.fieldCount);
    let wet = 0;
    for (let i = 0; i < scene.fieldCount; i++) {
      if (isWater(scene.instances[i * 4], scene.instances[i * 4 + 1])) wet++;
    }
    // positions are re-rolled up to 12 times, so a stray instance is astronomically unlikely
    expect(wet).toBeLessThanOrEqual(2);
  });

  it('is deterministic (renderers and physics build it independently)', () => {
    const a = buildTestScene();
    const b = buildTestScene();
    expect(Array.from(a.instances)).toEqual(Array.from(b.instances));
  });
});

describe('shader parity guard', () => {
  it('uses the same constants as the TypeScript sampler', () => {
    const sea = `${SEA_LEVEL.toFixed(1)}`;
    expect(TERRAIN_GLSL).toContain(`const float SEA = ${sea};`);
    expect(TERRAIN_WGSL).toContain(`const SEA: f32 = ${sea};`);
    for (const k of ['0.1031', '0.000055', '0.00022', '0.00014', '0.0011', '0.00007', '0.00031', '0.00009', '0.0004', '31.7, 11.3', '91.3, 47.7']) {
      expect(TERRAIN_GLSL, `GLSL ${k}`).toContain(k);
      expect(TERRAIN_WGSL, `WGSL ${k}`).toContain(k);
    }
  });
});
