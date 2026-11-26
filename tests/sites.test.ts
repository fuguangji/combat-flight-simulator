import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildTestScene } from '../src/rendering/scene';
import { isWater, sampleTerrain } from '../src/terrain/procedural';
import { TERRAIN_GLSL, TERRAIN_WGSL } from '../src/terrain/terrainShader';
import { CARRIER, LANDING, RUNWAYS, airportBuildings, carrierParts, inAirportZone } from '../src/world/sites';

const rust = readFileSync(new URL('../wasm/physics-engine/src/sites.rs', import.meta.url), 'utf8');
const num = (name: string): number => {
  const m = new RegExp(`pub const ${name}: f64 = (-?[0-9.]+);`).exec(rust);
  if (!m) throw new Error(`${name} not found in sites.rs`);
  return Number(m[1]);
};

describe('landing sites: TypeScript and Rust agree', () => {
  it('carrier numbers', () => {
    expect(num('CARRIER_CX')).toBe(CARRIER.cx);
    expect(num('CARRIER_CZ')).toBe(CARRIER.cz);
    expect(num('CARRIER_HALF_LEN')).toBe(CARRIER.halfLen);
    expect(num('CARRIER_HALF_WID')).toBe(CARRIER.halfWid);
    expect(num('CARRIER_DECK_Y')).toBe(CARRIER.deckY);
    expect(num('ISLAND_X')).toBe(CARRIER.islandX);
    expect(num('ISLAND_Z')).toBe(CARRIER.islandZ);
    expect(num('ISLAND_HALF')).toBe(CARRIER.islandHalf);
    expect(num('ISLAND_H')).toBe(CARRIER.islandH);
  });
  it('landing limits', () => {
    expect(num('MAX_SINK')).toBe(LANDING.maxSink);
    expect(num('MAX_ROLL_DEG')).toBe(LANDING.maxRollDeg);
    expect(num('MIN_PITCH_DEG')).toBe(LANDING.minPitchDeg);
    expect(num('MAX_PITCH_DEG')).toBe(LANDING.maxPitchDeg);
    expect(num('MAX_SPEED')).toBe(LANDING.maxSpeed);
    expect(num('MAX_HEADING_DEG')).toBe(LANDING.maxHeadingDeg);
  });
  it('runways', () => {
    const m = /RUNWAYS: \[\(f64, f64, f64, f64\); \d+\] = \[(.*)\];/.exec(rust);
    expect(m).not.toBeNull();
    const nums = [...(m as RegExpExecArray)[1].matchAll(/-?[0-9.]+/g)].map((x) => Number(x[0]));
    expect(nums).toEqual(RUNWAYS.flatMap((r) => [r.cx, r.cz, r.halfWid, r.halfLen]));
  });
});

describe('landing sites in the world', () => {
  it('runways sit on dry land and the carrier at sea', () => {
    for (const r of RUNWAYS) {
      for (const dz of [-r.halfLen, 0, r.halfLen]) {
        const t = sampleTerrain(r.cx, r.cz + dz);
        expect(t.biome, `${r.id} dz=${dz}`).not.toBe('water');
      }
    }
    for (const dx of [-CARRIER.halfWid, 0, CARRIER.halfWid]) {
      for (const dz of [-CARRIER.halfLen, 0, CARRIER.halfLen]) expect(isWater(CARRIER.cx + dx, CARRIER.cz + dz)).toBe(true);
    }
  });
  it('no random tower stands in an airport zone, and airport buildings avoid the runway', () => {
    const scene = buildTestScene();
    for (let i = 0; i < scene.fieldCount; i++) {
      expect(inAirportZone(scene.instances[i * 4], scene.instances[i * 4 + 1])).toBe(false);
    }
    for (const [x, z, w] of airportBuildings()) {
      const r = RUNWAYS.find((q) => Math.abs(z - q.cz) < q.halfLen + 1)!;
      expect(Math.abs(x - r.cx) - w / 2).toBeGreaterThan(r.halfWid + 40);
    }
  });
  it('carrier parts are render-only and cover the deck footprint', () => {
    const parts = carrierParts();
    const scene = buildTestScene();
    expect(scene.instanceCount - scene.collisionCount).toBe(parts.length);
    for (const p of parts) expect(p[2]).toBeLessThan(0);
    const hull = parts.filter((p) => Math.floor(-p[2]) === CARRIER.halfWid * 2);
    expect(hull.length * CARRIER.halfWid * 2).toBe(CARRIER.halfLen * 2);
    // collision part of the buffer contains only positive sizes
    for (let i = 0; i < scene.collisionCount; i++) expect(scene.instances[i * 4 + 2]).toBeGreaterThan(0);
  });
  it('both shader languages paint the same runways', () => {
    for (const r of RUNWAYS) {
      expect(TERRAIN_GLSL).toContain(`vec4(${r.cx.toFixed(1)}, ${r.cz.toFixed(1)}, ${r.halfWid.toFixed(1)}, ${r.halfLen.toFixed(1)})`);
      expect(TERRAIN_WGSL).toContain(`vec4<f32>(${r.cx.toFixed(1)}, ${r.cz.toFixed(1)}, ${r.halfWid.toFixed(1)}, ${r.halfLen.toFixed(1)})`);
    }
  });
});
