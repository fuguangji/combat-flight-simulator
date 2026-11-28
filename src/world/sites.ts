/**
 * Deterministic procedural landing-site network.
 * One seed builds all runways/carriers; the same definitions feed rendering, navigation and WASM.
 */
import { SEA_LEVEL, sampleTerrain } from '../terrain/procedural';

export type Faction = 'friendly' | 'hostile';
export type SiteThreat = 'none' | 'elevated';
export interface Runway {
  id: string; name: string; cx: number; cz: number; halfLen: number; halfWid: number;
  faction: Faction;
}
export interface Carrier {
  id: string; name: string; cx: number; cz: number; halfLen: number; halfWid: number;
  deckY: number; islandX: number; islandZ: number; islandHalf: number; islandH: number;
  faction: Faction; threat: SiteThreat; strikeCapable: boolean;
}
export interface SiteMarker {
  id: string; name: string; kind: 'airport' | 'carrier'; x: number; z: number;
  faction: Faction; threat: SiteThreat; strikeCapable: boolean;
}
export const WORLD_SITE_SEED = 0x51a7c3;
const RUNWAY_HALF_LEN = 950;
const RUNWAY_HALF_WID = 34;
const CARRIER_HALF_LEN = 190;
const CARRIER_HALF_WID = 42;
const MIN_AIRPORT_SPACING = 15_000;
const MIN_CARRIER_SPACING = 18_000;
const MIN_SITE_SPACING = 11_000;

function random32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const distance = (a: {x:number;z:number}, b: {x:number;z:number}): number => Math.hypot(a.x-b.x,a.z-b.z);

function runwaySiteIsSuitable(x: number, z: number): boolean {
  let lo = Infinity, hi = -Infinity;
  // Sample the whole runway and apron corridor. A candidate must be dry and locally level.
  for (let along = -900; along <= 900; along += 300) {
    for (let across = -180; across <= 180; across += 90) {
      const t = sampleTerrain(x + across, z + along);
      if (t.biome === 'water' || t.height <= SEA_LEVEL + 28 || t.height > 650) return false;
      lo = Math.min(lo, t.height); hi = Math.max(hi, t.height);
    }
  }
  return hi - lo <= 105;
}
function carrierSiteIsSuitable(x: number, z: number): boolean {
  for (let dx = -850; dx <= 850; dx += 425) {
    for (let dz = -1250; dz <= 1250; dz += 625) {
      if (sampleTerrain(x + dx, z + dz).biome !== 'water') return false;
    }
  }
  return true;
}
function chooseSites(): { runways: Runway[]; carriers: Carrier[] } {
  const rnd = random32(WORLD_SITE_SEED);
  const runways: Runway[] = [];
  const carriers: Carrier[] = [];
  const candidates: {x:number;z:number}[] = [];
  for (let i=0; i<2400; i++) candidates.push({x:(rnd()*2-1)*34_000,z:(rnd()*2-1)*34_000});
  for (const p of candidates) {
    if (runways.length >= 3) break;
    if (!runwaySiteIsSuitable(p.x,p.z)) continue;
    if (runways.some(r=>distance(p,{x:r.cx,z:r.cz})<MIN_AIRPORT_SPACING)) continue;
    if (carriers.some(c=>distance(p,{x:c.cx,z:c.cz})<MIN_SITE_SPACING)) continue;
    const index=runways.length;
    runways.push({
      id:index===0?'alpha':index===1?'bravo':`airfield-${index+1}`, name:['朝霧機場 ASAGIRI','雲嶺機場 UNREI','長風機場 CHOFU'][index],
      cx:Math.round(p.x/50)*50, cz:Math.round(p.z/50)*50,
      halfLen:RUNWAY_HALF_LEN, halfWid:RUNWAY_HALF_WID, faction:index===1?'hostile':'friendly',
    });
  }
  for (const p of candidates) {
    if (carriers.length >= 4) break;
    if (!carrierSiteIsSuitable(p.x,p.z)) continue;
    if (carriers.some(c=>distance(p,{x:c.cx,z:c.cz})<MIN_CARRIER_SPACING)) continue;
    if (runways.some(r=>distance(p,{x:r.cx,z:r.cz})<MIN_SITE_SPACING)) continue;
    const index=carriers.length;
    const faction=index===1||index===3?'hostile':'friendly';
    carriers.push({
      id:index===0?'carrier':`carrier-${index+1}`, name:['海燕號 PETREL','玄鯨號 ORCA','蒼鷺號 HERON','夜潮號 NIGHTTIDE'][index],
      cx:Math.round(p.x/50)*50, cz:Math.round(p.z/50)*50,
      halfLen:CARRIER_HALF_LEN, halfWid:CARRIER_HALF_WID, deckY:24,
      islandX:50, islandZ:-58, islandHalf:8, islandH:48,
      faction, threat:faction==='hostile' && index===3?'elevated':'none', strikeCapable:faction==='hostile' && index===3,
    });
  }
  if (runways.length < 2 || carriers.length < 2) throw new Error(`World site generation failed: ${runways.length} airfields, ${carriers.length} carriers`);
  return {runways,carriers};
}
const generated = chooseSites();
export const RUNWAYS: readonly Runway[] = generated.runways;
export const CARRIERS: readonly Carrier[] = generated.carriers;
/** Compatibility alias for systems that need the first carrier's deck dimensions. */
export const CARRIER: Carrier = CARRIERS[0];
export const LANDING = {
  maxSink: 5, maxRollDeg: 10, minPitchDeg: -3, maxPitchDeg: 18, maxSpeed: 95, maxHeadingDeg: 25,
} as const;
export const SITE_MARKERS: readonly SiteMarker[] = [
  ...RUNWAYS.map((r): SiteMarker => ({id:r.id,name:r.name,kind:'airport',x:r.cx,z:r.cz,faction:r.faction,threat:'none',strikeCapable:false})),
  ...CARRIERS.map((c): SiteMarker => ({id:c.id,name:c.name,kind:'carrier',x:c.cx,z:c.cz,faction:c.faction,threat:c.threat,strikeCapable:c.strikeCapable})),
];
export function inAirportZone(x:number,z:number,margin=0):boolean {
  return RUNWAYS.some(r=>Math.abs(x-r.cx)<=460+margin && Math.abs(z-r.cz)<=r.halfLen+520+margin);
}
export function airportBuildings():number[][] {
  const out:number[][]=[];
  for(const r of RUNWAYS){
    const side=r.cx<0?1:-1, x0=r.cx+side*190;
    const specs:[number,number,number][]=[[-620,54,18],[-470,54,18],[-320,54,18],[-80,76,24],[100,28,14],[240,28,14],[390,18,66]];
    for(const [dz,w,h] of specs) out.push([x0,r.cz+dz,w,h]);
  }
  return out;
}
export const KIND_DECK=1;
export const KIND_ISLAND=2;
export function carrierParts(c:Carrier):number[][] {
  const out:number[][]=[], size=c.halfWid*2, n=Math.round(c.halfLen*2/size);
  for(let i=0;i<n;i++) out.push([c.cx,c.cz-c.halfLen+size*(i+0.5),-(size+KIND_DECK*0.25),c.deckY]);
  out.push([c.cx+c.islandX,c.cz+c.islandZ,-(c.islandHalf*2+KIND_ISLAND*0.25),c.islandH]);
  return out;
}
// ---------- shader snippets (GLSL and WGSL are generated from the numbers above) ----------

const f = (v: number): string => (Number.isInteger(v) ? `${v}.0` : String(v));

/** Painted runways for the ground shader: returns `vec3` colour or a negative `.x` when the point is off every runway. */
export function runwayGlsl(): string {
  const rs = RUNWAYS.map((r) => `vec4(${f(r.cx)}, ${f(r.cz)}, ${f(r.halfWid)}, ${f(r.halfLen)})`).join(', ');
  return /* glsl */ `
const int RW_N = ${RUNWAYS.length};
const vec4 RW[${RUNWAYS.length}] = vec4[${RUNWAYS.length}](${rs});
vec3 siteGround(vec2 w, vec3 base) {
  for (int i = 0; i < RW_N; i++) {
    vec2 d = vec2(w.x - RW[i].x, w.y - RW[i].y);
    float hw = RW[i].z, hl = RW[i].w;
    // apron / taxi strip beside the runway, then the runway itself
    if (abs(d.x) < hw + 70.0 && abs(d.y) < hl + 90.0) base = mix(base, vec3(0.30, 0.31, 0.30), 0.92);
    if (abs(d.x) < hw && abs(d.y) < hl) {
      vec3 c = vec3(0.12, 0.125, 0.13);
      float edge = step(hw - 1.4, abs(d.x));
      float dash = step(abs(d.x), 0.7) * step(fract((d.y + hl) / 60.0), 0.5) * step(abs(d.y), hl - 120.0);
      float thr = step(hl - 100.0, abs(d.y)) * step(abs(d.y), hl - 70.0) * step(fract(d.x / 6.0), 0.55) * step(abs(d.x), hw - 4.0);
      c = mix(c, vec3(0.92), max(max(edge, dash), thr));
      base = c;
    }
  }
  return base;
}`;
}

export function runwayWgsl(): string {
  const rs = RUNWAYS.map((r) => `vec4<f32>(${f(r.cx)}, ${f(r.cz)}, ${f(r.halfWid)}, ${f(r.halfLen)})`).join(', ');
  return /* wgsl */ `
const RW_N: i32 = ${RUNWAYS.length};
const RW = array<vec4<f32>, ${RUNWAYS.length}>(${rs});
fn siteGround(w: vec2<f32>, base0: vec3<f32>) -> vec3<f32> {
  var base = base0;
  for (var i = 0; i < RW_N; i = i + 1) {
    let d = vec2<f32>(w.x - RW[i].x, w.y - RW[i].y);
    let hw = RW[i].z;
    let hl = RW[i].w;
    if (abs(d.x) < hw + 70.0 && abs(d.y) < hl + 90.0) { base = mix(base, vec3<f32>(0.30, 0.31, 0.30), 0.92); }
    if (abs(d.x) < hw && abs(d.y) < hl) {
      var c = vec3<f32>(0.12, 0.125, 0.13);
      let edge = step(hw - 1.4, abs(d.x));
      let dash = step(abs(d.x), 0.7) * step(fract((d.y + hl) / 60.0), 0.5) * step(abs(d.y), hl - 120.0);
      let thr = step(hl - 100.0, abs(d.y)) * step(abs(d.y), hl - 70.0) * step(fract(d.x / 6.0), 0.55) * step(abs(d.x), hw - 4.0);
      c = mix(c, vec3<f32>(0.92), max(max(edge, dash), thr));
      base = c;
    }
  }
  return base;
}`;
}
