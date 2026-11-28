import { describe, expect, it } from 'vitest';
import { buildTestScene } from '../src/rendering/scene';
import { SEA_LEVEL, sampleTerrain } from '../src/terrain/procedural';
import { TERRAIN_GLSL, TERRAIN_WGSL } from '../src/terrain/terrainShader';
import { CARRIERS, LANDING, RUNWAYS, SITE_MARKERS, airportBuildings, carrierParts, inAirportZone, WORLD_SITE_SEED } from '../src/world/sites';

describe('procedural landing-site network', () => {
  it('is seeded, reproducible, and contains both factions and site types', () => {
    expect(WORLD_SITE_SEED).toBe(0x51a7c3);
    expect(RUNWAYS.length).toBeGreaterThanOrEqual(2);
    expect(CARRIERS.length).toBeGreaterThanOrEqual(2);
    expect(SITE_MARKERS.some(s => s.faction === 'friendly')).toBe(true);
    expect(SITE_MARKERS.some(s => s.faction === 'hostile')).toBe(true);
    expect(CARRIERS.some(c => c.faction === 'hostile' && c.strikeCapable)).toBe(true);
  });
  it('places all runways on contiguous dry and reasonably level land', () => {
    for (const r of RUNWAYS) {
      let low=Infinity,high=-Infinity;
      for(let along=-900;along<=900;along+=300) for(let across=-180;across<=180;across+=90){
        const t=sampleTerrain(r.cx+across,r.cz+along);
        expect(t.biome, r.id).not.toBe('water');
        expect(t.height, r.id).toBeGreaterThan(SEA_LEVEL+28);
        low=Math.min(low,t.height); high=Math.max(high,t.height);
      }
      expect(high-low,r.id).toBeLessThanOrEqual(105);
    }
  });
  it('places every carrier footprint in water and keeps sites separated', () => {
    for(const c of CARRIERS) {
      for(let dx=-850;dx<=850;dx+=425) for(let dz=-1250;dz<=1250;dz+=625) {
        const sample=sampleTerrain(c.cx+dx,c.cz+dz);
        expect(sample.biome,c.id).toBe('water');
        expect(sample.height,c.id).toBeLessThan(SEA_LEVEL);
      }
    }
    for(let i=0;i<SITE_MARKERS.length;i++) for(let j=i+1;j<SITE_MARKERS.length;j++)
      expect(Math.hypot(SITE_MARKERS[i].x-SITE_MARKERS[j].x,SITE_MARKERS[i].z-SITE_MARKERS[j].z)).toBeGreaterThanOrEqual(11_000);
    for(let i=0;i<RUNWAYS.length;i++) for(let j=i+1;j<RUNWAYS.length;j++)
      expect(Math.hypot(RUNWAYS[i].cx-RUNWAYS[j].cx,RUNWAYS[i].cz-RUNWAYS[j].cz)).toBeGreaterThanOrEqual(15_000);
    for(let i=0;i<CARRIERS.length;i++) for(let j=i+1;j<CARRIERS.length;j++)
      expect(Math.hypot(CARRIERS[i].cx-CARRIERS[j].cx,CARRIERS[i].cz-CARRIERS[j].cz)).toBeGreaterThanOrEqual(18_000);
  });
  it('keeps generated sites out of random building fields and renders every carrier', () => {
    const scene=buildTestScene();
    for(let i=0;i<scene.fieldCount;i++) expect(inAirportZone(scene.instances[i*4],scene.instances[i*4+1])).toBe(false);
    for(const [x,z,w] of airportBuildings()){
      const r=RUNWAYS.find(q=>Math.abs(z-q.cz)<q.halfLen+1)!;
      expect(Math.abs(x-r.cx)-w/2).toBeGreaterThan(r.halfWid+40);
    }
    const parts=CARRIERS.flatMap(c=>carrierParts(c));
    expect(scene.instanceCount-scene.collisionCount).toBe(parts.length);
    for(const p of parts) expect(p[2]).toBeLessThan(0);
  });
  it('generates shader runway definitions from the same sites',()=>{
    for(const r of RUNWAYS){
      expect(TERRAIN_GLSL).toContain(`vec4(${r.cx.toFixed(1)}, ${r.cz.toFixed(1)}, ${r.halfWid.toFixed(1)}, ${r.halfLen.toFixed(1)})`);
      expect(TERRAIN_WGSL).toContain(`vec4<f32>(${r.cx.toFixed(1)}, ${r.cz.toFixed(1)}, ${r.halfWid.toFixed(1)}, ${r.halfLen.toFixed(1)})`);
    }
    expect(LANDING.maxSpeed).toBe(95);
  });
});
