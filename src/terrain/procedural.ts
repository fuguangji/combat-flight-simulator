/**
 * Deterministic, coordinate-based terrain sampler; the world does not depend on loaded chunks.
 *
 * The very same functions are written in GLSL and WGSL in `terrainShader.ts`. Keep the constants
 * (frequencies, amplitudes, offsets) in sync: the minimap, the scene builder and both renderers
 * must agree on where the sea, rivers and mountains are.
 */
export type Biome = 'water' | 'shore' | 'desert' | 'plain' | 'forest' | 'ridge' | 'snow';
export interface TerrainSample {
  height: number;
  /** 0 (dry) .. 1 (wet); drives desert / forest. */
  moisture: number;
  biome: Biome;
}

/** Heights below this are sea / lake (metres). */
export const SEA_LEVEL = -55;

const fract = (v: number): number => v - Math.floor(v);

/** Sine-free hash (Hoskins "hash12"): cheap and precise in float32 on the GPU. */
export function terrainHash(x: number, z: number): number {
  let a = fract(x * 0.1031);
  let b = fract(z * 0.1031);
  let c = a;
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d;
  b += d;
  c += d;
  return fract((a + b) * c);
}

export function terrainNoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  let fx = fract(x);
  let fz = fract(z);
  fx = fx * fx * (3 - 2 * fx);
  fz = fz * fz * (3 - 2 * fz);
  const a = terrainHash(ix, iz);
  const b = terrainHash(ix + 1, iz);
  const c = terrainHash(ix, iz + 1);
  const d = terrainHash(ix + 1, iz + 1);
  const ab = a + (b - a) * fx;
  const cd = c + (d - c) * fx;
  return ab + (cd - ab) * fz;
}

/** Low-frequency height (broad hills, medium relief, ridge lines). */
export function terrainBase(x: number, z: number): number {
  const r = 1 - Math.abs(terrainNoise(x * 0.00014, z * 0.00014) * 2 - 1);
  const broad = (terrainNoise(x * 0.000055, z * 0.000055) - 0.5) * 900;
  const medium = (terrainNoise(x * 0.00022, z * 0.00022) - 0.5) * 420;
  const ridges = r * r * r * 420;
  const valleys = Math.pow(Math.abs(terrainNoise(x * 0.000085 + 17.1, z * 0.000085 - 9.4) * 2 - 1), 5) * -115;
  return broad + medium + ridges + valleys;
}

export function terrainFine(x: number, z: number): number {
  const fine = (terrainNoise(x * 0.0011, z * 0.0011) - 0.5) * 90;
  const detail = (terrainNoise(x * 0.0038 + 43.2, z * 0.0038 - 21.7) - 0.5) * 28;
  const micro = (terrainNoise(x * 0.012 + 8.6, z * 0.012 + 61.4) - 0.5) * 8;
  return fine + detail + micro;
}

export function terrainMoisture(x: number, z: number): number {
  return (
    terrainNoise(x * 0.00007 + 31.7, z * 0.00007 + 11.3) * 0.7 +
    terrainNoise(x * 0.00031 + 5.1, z * 0.00031 + 73.9) * 0.3
  );
}

const smoothstep = (a: number, b: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 0..1 coverage of meandering rivers; they only exist in the lowlands. */
export function riverMask(x: number, z: number, h: number): number {
  const warp = (terrainNoise(x * 0.0004, z * 0.0004) - 0.5) * 3000;
  const qx = x + warp;
  const qz = z - warp;
  const r = Math.abs(terrainNoise(qx * 0.00009 + 91.3, qz * 0.00009 + 47.7) * 2 - 1);
  return (1 - smoothstep(0.02, 0.03, r)) * (1 - smoothstep(400, 650, h));
}

/** Infinite deterministic height field in metres, suitable for chunk generation and minimap sampling. */
export function sampleTerrain(x: number, z: number, seed = 0): TerrainSample {
  const ox = x + seed * 1237.7;
  const oz = z + seed * 911.3;
  const height = Math.max(-180, Math.min(1850, terrainBase(ox, oz) + terrainFine(ox, oz)));
  const moisture = terrainMoisture(ox, oz);
  let biome: Biome;
  if (height < SEA_LEVEL || riverMask(ox, oz, height) > 0.5) biome = 'water';
  else if (height < SEA_LEVEL + 22) biome = 'shore';
  else if (height > 1150) biome = 'snow';
  else if (height > 700) biome = 'ridge';
  else if (moisture < 0.3 && height < 500) biome = 'desert';
  else if (moisture > 0.55) biome = 'forest';
  else biome = 'plain';
  return { height, moisture, biome };
}

/** True for open water (sea, lake or river). */
export const isWater = (x: number, z: number): boolean => sampleTerrain(x, z).biome === 'water';
