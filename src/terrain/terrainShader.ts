import { runwayGlsl, runwayWgsl } from '../world/sites';

/**
 * GLSL / WGSL ports of `procedural.ts` plus the ground shading built on top of them.
 * Constants (frequencies, offsets, thresholds) must match the TypeScript sampler.
 *
 * Cost note: the height is evaluated once per pixel (5 value-noise lookups, sine-free hash). The
 * slope comes from screen-space derivatives of that height instead of four extra evaluations.
 */

const TERRAIN_GLSL_BASE = /* glsl */ `
const float SEA = -55.0;
float tHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float tNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = tHash(i);
  float b = tHash(i + vec2(1.0, 0.0));
  float c = tHash(i + vec2(0.0, 1.0));
  float d = tHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float terrainBase(vec2 p) {
  float r = 1.0 - abs(tNoise(p * 0.00014) * 2.0 - 1.0);
  return (tNoise(p * 0.000055) - 0.5) * 900.0 + (tNoise(p * 0.00022) - 0.5) * 420.0 + r * r * r * 420.0;
}
float terrainFine(vec2 p) { return (tNoise(p * 0.0011) - 0.5) * 90.0; }
float terrainMoisture(vec2 p) {
  return tNoise(p * 0.00007 + vec2(31.7, 11.3)) * 0.7 + tNoise(p * 0.00031 + vec2(5.1, 73.9)) * 0.3;
}
float riverMask(vec2 p, float h) {
  float warp = (tNoise(p * 0.0004) - 0.5) * 3000.0;
  vec2 q = p + vec2(warp, -warp);
  float r = abs(tNoise(q * 0.00009 + vec2(91.3, 47.7)) * 2.0 - 1.0);
  return (1.0 - smoothstep(0.02, 0.03, r)) * (1.0 - smoothstep(400.0, 650.0, h));
}
float gridLine(vec2 p, float cell) {
  vec2 q = p / cell;
  vec2 d = abs(fract(q - 0.5) - 0.5) / fwidth(q);
  return 1.0 - min(min(d.x, d.y), 1.0);
}
/** Colour of the ground at world position w (rel = camera-relative xz, camY = camera height). */
vec3 shadeGroundTerrain(vec2 w, vec2 rel, float camY) {
  float dist = length(vec3(rel.x, camY, rel.y));
  float h = terrainBase(w) + terrainFine(w);

  // slope from screen-space derivatives: solve J * grad = dh for the world-space gradient
  vec2 dwx = dFdx(rel);
  vec2 dwy = dFdy(rel);
  float dhx = dFdx(h);
  float dhy = dFdy(h);
  float det = dwx.x * dwy.y - dwx.y * dwy.x;
  float slope = 0.35;
  if (abs(det) > 1e-9) {
    vec2 g = vec2(dwy.y * dhx - dwx.y * dhy, dwx.x * dhy - dwy.x * dhx) / det;
    slope = min(length(g), 3.0);
  }

  float m = terrainMoisture(w);
  float tint = tHash(floor(w / 1000.0));
  float tex = mix(tNoise(w * 0.01), 0.5, smoothstep(1500.0, 6000.0, dist));

  vec3 plain = mix(vec3(0.15, 0.25, 0.13), vec3(0.27, 0.34, 0.18), tint);
  vec3 desertC = mix(vec3(0.62, 0.54, 0.36), vec3(0.70, 0.60, 0.40), tint);
  vec3 forestC = vec3(0.06, 0.16, 0.07) * (0.75 + 0.5 * tex);
  float desertW = (1.0 - smoothstep(0.26, 0.38, m)) * (1.0 - smoothstep(300.0, 600.0, h));
  float forestW = smoothstep(0.5, 0.62, m) * (1.0 - smoothstep(600.0, 900.0, h)) * (1.0 - smoothstep(0.7, 1.3, slope));
  vec3 land = mix(plain, desertC, desertW);
  land = mix(land, forestC, forestW);
  land = mix(land, vec3(0.34, 0.35, 0.32), smoothstep(0.35, 1.25, slope) * 0.8);
  land = mix(land, vec3(0.80, 0.82, 0.82), smoothstep(950.0, 1450.0, h) * 0.85 * (1.0 - 0.5 * smoothstep(1.0, 1.8, slope)));
  land = mix(land, vec3(0.76, 0.70, 0.52), 1.0 - smoothstep(SEA + 3.0, SEA + 22.0, h));

  float contour = 1.0 - smoothstep(0.0, 18.0, abs(fract(h / 100.0) - 0.5) * 100.0);
  land = mix(land, land * 0.72, contour * 0.18);
  float fade = 1.0 - clamp(dist / 12000.0, 0.0, 1.0);
  land = mix(land, vec3(0.08, 0.12, 0.06), gridLine(w, 100.0) * 0.16 * fade);
  land = mix(land, vec3(0.05, 0.07, 0.04), gridLine(w, 1000.0) * 0.22);

  // water: sea / lakes below SEA, rivers in the lowlands; sky reflection + sun glint
  float water = max(1.0 - smoothstep(SEA - 3.0, SEA + 3.0, h), riverMask(w, h));
  if (water <= 0.0) return land;
  float depth = clamp((SEA - h) / 180.0, 0.0, 1.0);
  vec3 wc = mix(vec3(0.10, 0.38, 0.42), vec3(0.02, 0.10, 0.24), depth);
  vec3 v = normalize(vec3(rel.x, -camY, rel.y));
  float cosI = clamp(-v.y, 0.0, 1.0);
  float fres = 0.03 + 0.97 * pow(1.0 - cosI, 5.0);
  vec3 refl = mix(HORIZON, ZENITH, pow(cosI, 0.55));
  wc = mix(wc, refl, fres);
  float glint = pow(max(dot(vec3(v.x, -v.y, v.z), vec3(0.50508, 0.80812, 0.30305)), 0.0), 220.0);
  wc += vec3(1.0, 0.95, 0.8) * glint * 0.9;
  return mix(land, wc, water);
}
`;

const TERRAIN_WGSL_BASE = /* wgsl */ `
const SEA: f32 = -55.0;
fn tHash(p: vec2<f32>) -> f32 {
  var q = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
fn tNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (vec2<f32>(3.0) - 2.0 * f);
  let a = tHash(i);
  let b = tHash(i + vec2<f32>(1.0, 0.0));
  let c = tHash(i + vec2<f32>(0.0, 1.0));
  let d = tHash(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
fn terrainBase(p: vec2<f32>) -> f32 {
  let r = 1.0 - abs(tNoise(p * 0.00014) * 2.0 - 1.0);
  return (tNoise(p * 0.000055) - 0.5) * 900.0 + (tNoise(p * 0.00022) - 0.5) * 420.0 + r * r * r * 420.0;
}
fn terrainFine(p: vec2<f32>) -> f32 { return (tNoise(p * 0.0011) - 0.5) * 90.0; }
fn terrainMoisture(p: vec2<f32>) -> f32 {
  return tNoise(p * 0.00007 + vec2<f32>(31.7, 11.3)) * 0.7 + tNoise(p * 0.00031 + vec2<f32>(5.1, 73.9)) * 0.3;
}
fn riverMask(p: vec2<f32>, h: f32) -> f32 {
  let warp = (tNoise(p * 0.0004) - 0.5) * 3000.0;
  let q = p + vec2<f32>(warp, -warp);
  let r = abs(tNoise(q * 0.00009 + vec2<f32>(91.3, 47.7)) * 2.0 - 1.0);
  return (1.0 - smoothstep(0.02, 0.03, r)) * (1.0 - smoothstep(400.0, 650.0, h));
}
fn gridLine(p: vec2<f32>, cell: f32) -> f32 {
  let q = p / cell;
  let d = abs(fract(q - 0.5) - 0.5) / fwidth(q);
  return 1.0 - min(min(d.x, d.y), 1.0);
}
// Derivatives must be taken in uniform control flow, so they are computed up front, unconditionally.
fn shadeGroundTerrain(w: vec2<f32>, rel: vec2<f32>, camY: f32) -> vec3<f32> {
  let dist = length(vec3<f32>(rel.x, camY, rel.y));
  let h = terrainBase(w) + terrainFine(w);

  let dwx = dpdx(rel);
  let dwy = dpdy(rel);
  let dhx = dpdx(h);
  let dhy = dpdy(h);
  let det = dwx.x * dwy.y - dwx.y * dwy.x;
  let g = vec2<f32>(dwy.y * dhx - dwx.y * dhy, dwx.x * dhy - dwy.x * dhx) / select(1.0, det, abs(det) > 1e-9);
  let slope = select(0.35, min(length(g), 3.0), abs(det) > 1e-9);

  let grid100 = gridLine(w, 100.0);
  let grid1000 = gridLine(w, 1000.0);

  let m = terrainMoisture(w);
  let tint = tHash(floor(w / 1000.0));
  let tex = mix(tNoise(w * 0.01), 0.5, smoothstep(1500.0, 6000.0, dist));

  let plain = mix(vec3<f32>(0.15, 0.25, 0.13), vec3<f32>(0.27, 0.34, 0.18), tint);
  let desertC = mix(vec3<f32>(0.62, 0.54, 0.36), vec3<f32>(0.70, 0.60, 0.40), tint);
  let forestC = vec3<f32>(0.06, 0.16, 0.07) * (0.75 + 0.5 * tex);
  let desertW = (1.0 - smoothstep(0.26, 0.38, m)) * (1.0 - smoothstep(300.0, 600.0, h));
  let forestW = smoothstep(0.5, 0.62, m) * (1.0 - smoothstep(600.0, 900.0, h)) * (1.0 - smoothstep(0.7, 1.3, slope));
  var land = mix(plain, desertC, desertW);
  land = mix(land, forestC, forestW);
  land = mix(land, vec3<f32>(0.34, 0.35, 0.32), smoothstep(0.35, 1.25, slope) * 0.8);
  land = mix(land, vec3<f32>(0.80, 0.82, 0.82), smoothstep(950.0, 1450.0, h) * 0.85 * (1.0 - 0.5 * smoothstep(1.0, 1.8, slope)));
  land = mix(land, vec3<f32>(0.76, 0.70, 0.52), 1.0 - smoothstep(SEA + 3.0, SEA + 22.0, h));

  let contour = 1.0 - smoothstep(0.0, 18.0, abs(fract(h / 100.0) - 0.5) * 100.0);
  land = mix(land, land * 0.72, contour * 0.18);
  let fade = 1.0 - clamp(dist / 12000.0, 0.0, 1.0);
  land = mix(land, vec3<f32>(0.08, 0.12, 0.06), grid100 * 0.16 * fade);
  land = mix(land, vec3<f32>(0.05, 0.07, 0.04), grid1000 * 0.22);

  let water = max(1.0 - smoothstep(SEA - 3.0, SEA + 3.0, h), riverMask(w, h));
  let depth = clamp((SEA - h) / 180.0, 0.0, 1.0);
  var wc = mix(vec3<f32>(0.10, 0.38, 0.42), vec3<f32>(0.02, 0.10, 0.24), depth);
  let v = normalize(vec3<f32>(rel.x, -camY, rel.y));
  let cosI = clamp(-v.y, 0.0, 1.0);
  let fres = 0.03 + 0.97 * pow(1.0 - cosI, 5.0);
  let refl = mix(HORIZON, ZENITH, pow(cosI, 0.55));
  wc = mix(wc, refl, fres);
  let glint = pow(max(dot(vec3<f32>(v.x, -v.y, v.z), vec3<f32>(0.50508, 0.80812, 0.30305)), 0.0), 220.0);
  wc += vec3<f32>(1.0, 0.95, 0.8) * glint * 0.9;
  return mix(land, wc, water);
}
`;

/** Terrain plus painted airports (runways are generated from `world/sites.ts`). */
export const TERRAIN_GLSL = TERRAIN_GLSL_BASE + runwayGlsl() + /* glsl */ `
vec3 shadeGround(vec2 w, vec2 rel, float camY) {
  return siteGround(w, shadeGroundTerrain(w, rel, camY));
}
`;

export const TERRAIN_WGSL = TERRAIN_WGSL_BASE + runwayWgsl() + /* wgsl */ `
fn shadeGround(w: vec2<f32>, rel: vec2<f32>, camY: f32) -> vec3<f32> {
  return siteGround(w, shadeGroundTerrain(w, rel, camY));
}
`;
