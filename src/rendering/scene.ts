import { SEA_LEVEL, sampleTerrain } from '../terrain/procedural';

/**
 * Phase-1 test scene: an instanced field of boxes ("towers" and "massifs") over a procedural
 * ground. Deterministic, so every run and every backend draws the same world.
 */
export interface TestScene {
  /** Interleaved position(3) + normal(3), unit box with base at y=0. */
  vertices: Float32Array;
  indices: Uint32Array;
  /** Per instance: x, z, width, height. */
  instances: Float32Array;
  instanceCount: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FACES: { n: [number, number, number]; v: [number, number, number][] }[] = [
  { n: [0, 0, 1], v: [[-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 1, 0.5], [-0.5, 1, 0.5]] },
  { n: [0, 0, -1], v: [[0.5, 0, -0.5], [-0.5, 0, -0.5], [-0.5, 1, -0.5], [0.5, 1, -0.5]] },
  { n: [1, 0, 0], v: [[0.5, 0, 0.5], [0.5, 0, -0.5], [0.5, 1, -0.5], [0.5, 1, 0.5]] },
  { n: [-1, 0, 0], v: [[-0.5, 0, -0.5], [-0.5, 0, 0.5], [-0.5, 1, 0.5], [-0.5, 1, -0.5]] },
  { n: [0, 1, 0], v: [[-0.5, 1, 0.5], [0.5, 1, 0.5], [0.5, 1, -0.5], [-0.5, 1, -0.5]] },
];

export function buildTestScene(towers = 3600, massifs = 400, halfExtent = 25_000): TestScene {
  const vertices = new Float32Array(FACES.length * 4 * 6);
  const indices = new Uint32Array(FACES.length * 6);
  FACES.forEach((face, fi) => {
    face.v.forEach((p, vi) => vertices.set([...p, ...face.n], (fi * 4 + vi) * 6));
    const b = fi * 4;
    indices.set([b, b + 1, b + 2, b, b + 2, b + 3], fi * 6);
  });

  const rnd = mulberry32(1337);
  const count = towers + massifs;
  const instances = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const big = i >= towers;
    // Re-roll the position (bounded, deterministic) until it lands on dry ground, so no tower
    // stands in the sea or a river. The same instance array is uploaded to the physics worker.
    let x = 0;
    let z = 0;
    for (let tries = 0; tries < 12; tries++) {
      x = (rnd() * 2 - 1) * halfExtent;
      z = (rnd() * 2 - 1) * halfExtent;
      const t = sampleTerrain(x, z);
      if (t.biome !== 'water' && t.height > SEA_LEVEL + 15) break;
    }
    const w = big ? 400 + rnd() * 1100 : 25 + rnd() * rnd() * 160;
    const h = big ? 250 + rnd() * rnd() * 1300 : 15 + rnd() * rnd() * rnd() * 520;
    instances.set([x, z, w, h], i * 4);
  }
  return { vertices, indices, instances, instanceCount: count };
}
