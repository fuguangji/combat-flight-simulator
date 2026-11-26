/**
 * Landing sites: two airports (one runway each) and one carrier. All invented for this game.
 *
 * Runways and the carrier deck run along the world z axis (north-south). The same numbers are
 * mirrored in `wasm/physics-engine/src/sites.rs` (a test compares them) and drive the ground and
 * object shaders through the generated snippets below, so the drawn runway is the collision runway.
 */
export interface Runway {
  id: string;
  name: string;
  /** Centre (world x, z). */
  cx: number;
  cz: number;
  /** Half length along z and half width along x (m). */
  halfLen: number;
  halfWid: number;
}

export interface Carrier {
  id: string;
  name: string;
  cx: number;
  cz: number;
  halfLen: number;
  halfWid: number;
  /** Flight-deck height above the sea (m). */
  deckY: number;
  /** Island superstructure: a solid box beside the deck. */
  islandX: number;
  islandZ: number;
  islandHalf: number;
  islandH: number;
}

export const RUNWAYS: readonly Runway[] = [
  { id: 'alpha', name: '朝霧機場 ASAGIRI', cx: -5000, cz: -3500, halfLen: 1200, halfWid: 30 },
  { id: 'bravo', name: '雲嶺機場 UNREI', cx: 4300, cz: 2500, halfLen: 1200, halfWid: 30 },
];

export const CARRIER: Carrier = {
  id: 'carrier',
  name: '海燕號 PETREL',
  cx: 0,
  cz: -3000,
  halfLen: 175,
  halfWid: 35,
  deckY: 24,
  islandX: 42,
  islandZ: -53,
  islandHalf: 7,
  islandH: 46,
};

/** Touchdown limits (also enforced by the physics core). */
export const LANDING = {
  maxSink: 5, // m/s
  maxRollDeg: 10,
  minPitchDeg: -3,
  maxPitchDeg: 18,
  maxSpeed: 95, // m/s (~185 kt)
  maxHeadingDeg: 25, // off the runway / deck axis (either direction)
} as const;

export interface SiteMarker {
  id: string;
  name: string;
  kind: 'airport' | 'carrier';
  x: number;
  z: number;
}

export const SITE_MARKERS: readonly SiteMarker[] = [
  ...RUNWAYS.map((r): SiteMarker => ({ id: r.id, name: r.name, kind: 'airport', x: r.cx, z: r.cz })),
  { id: CARRIER.id, name: CARRIER.name, kind: 'carrier', x: CARRIER.cx, z: CARRIER.cz },
];

/** True when (x, z) lies in an airport's apron zone (no random towers there). */
export function inAirportZone(x: number, z: number, margin = 0): boolean {
  return RUNWAYS.some((r) => Math.abs(x - r.cx) <= 420 + margin && Math.abs(z - r.cz) <= r.halfLen + 500 + margin);
}

/** Airport buildings (hangars, terminal, tower), beside the runway. [x, z, width, height] */
export function airportBuildings(): number[][] {
  const out: number[][] = [];
  for (const r of RUNWAYS) {
    const side = r.cx < 0 ? 1 : -1; // apron on the side facing the map centre
    const x0 = r.cx + side * 150;
    const specs: [number, number, number][] = [
      [-780, 46, 16], [-640, 46, 16], [-500, 46, 16], // hangars
      [-120, 70, 22], // terminal
      [60, 24, 12], [190, 24, 12], // fuel / service
      [330, 14, 60], // control tower
    ];
    for (const [dz, w, h] of specs) out.push([x0, r.cz + dz, w, h]);
  }
  return out;
}

/**
 * Render-only carrier parts, encoded into the 4-float instance format (x, z, size, height):
 * a negative size marks a non-colliding-in-the-box-world part, `fract(-size) * 4` is its kind
 * (1 = deck hull, 2 = island) and `floor(-size)` the footprint. The physics core models the
 * carrier itself (see sites.rs), and its box world skips non-positive sizes.
 */
export const KIND_DECK = 1;
export const KIND_ISLAND = 2;
export function carrierParts(c: Carrier = CARRIER): number[][] {
  const out: number[][] = [];
  const size = c.halfWid * 2;
  const n = Math.round((c.halfLen * 2) / size);
  for (let i = 0; i < n; i++) out.push([c.cx, c.cz - c.halfLen + size * (i + 0.5), -(size + KIND_DECK * 0.25), c.deckY]);
  out.push([c.cx + c.islandX, c.cz + c.islandZ, -(c.islandHalf * 2 + KIND_ISLAND * 0.25), c.islandH]);
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
