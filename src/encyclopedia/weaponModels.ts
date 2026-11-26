import * as THREE from 'three';
import { KitBuilder, glowMat, hexToNumber, instantiate, mixColor, stdMat, type Anchor, type ModelKit, type V3 } from './modelKit';

/**
 * Ten original, fictional "mission stores" for the encyclopedia. The silhouettes are invented game
 * art (nothing here copies a real missile, bomb or pod, and no real dimensions are used).
 * Coordinate convention matches the aircraft: nose +X, up +Y, right +Z.
 */

type P2 = [number, number];
type NoseKind = 'ogive' | 'blunt' | 'spike' | 'flat' | 'dome';

interface FinSet {
  /** Leading edge x at the root. */
  x: number;
  chord: number;
  span: number;
  sweep: number;
  /** Tip chord as a fraction of the root chord. */
  taper: number;
  /** 'cross' = four fins (+ shape), 'x' = four fins rotated 45°, 'tri' = three, 'pair' = left/right only. */
  layout: 'cross' | 'x' | 'tri' | 'pair';
  glow?: boolean;
}

interface WeaponCfg {
  len: number;
  r: number;
  nose: { kind: NoseKind; len: number };
  tail: { len: number; r: number; nozzles: number };
  fins: FinSet[];
  rings: number[];
  body: number;
  /** Fraction of the accent colour mixed into the body paint. */
  paint: number;
  /** Two parallel bodies joined by a bridge. */
  twin?: boolean;
  /** Antenna blades (emitter pod look). */
  blades?: number;
  /** Ducted-ring shroud around the tail. */
  duct?: boolean;
  /** Glowing stripe along the spine. */
  stripe?: boolean;
}

const CFG: Record<string, WeaponCfg> = {
  // short, quick dart with a double set of small fins
  nova17: {
    len: 5, r: 0.2, nose: { kind: 'ogive', len: 1.2 }, tail: { len: 0.5, r: 0.14, nozzles: 1 },
    fins: [{ x: 0.9, chord: 0.5, span: 0.42, sweep: 0.25, taper: 0.5, layout: 'cross' }, { x: -1.7, chord: 0.7, span: 0.62, sweep: 0.35, taper: 0.4, layout: 'cross' }],
    rings: [0.2, 1.2], body: 0x74868b, paint: 0.22, stripe: true,
  },
  // long slender body with strakes and large tail fins
  meteor88: {
    len: 6.4, r: 0.22, nose: { kind: 'ogive', len: 1.8 }, tail: { len: 0.7, r: 0.17, nozzles: 1 },
    fins: [{ x: 0.2, chord: 1.6, span: 0.2, sweep: 0.1, taper: 0.9, layout: 'cross' }, { x: -2.4, chord: 0.9, span: 0.75, sweep: 0.5, taper: 0.35, layout: 'cross' }],
    rings: [-0.8, 0.6, 1.4], body: 0x7b8f95, paint: 0.2,
  },
  // stubby body, flat seeker window, boxy tail fins
  hellfire09: {
    len: 4.4, r: 0.27, nose: { kind: 'flat', len: 0.55 }, tail: { len: 0.45, r: 0.2, nozzles: 1 },
    fins: [{ x: -1.55, chord: 0.8, span: 0.55, sweep: 0.0, taper: 1, layout: 'x' }, { x: 0.5, chord: 0.5, span: 0.3, sweep: 0.0, taper: 1, layout: 'x' }],
    rings: [-0.4, 0.5], body: 0x6c7a72, paint: 0.3,
  },
  // torpedo-like body with a ducted fan ring at the tail
  vortex33: {
    len: 5.2, r: 0.3, nose: { kind: 'dome', len: 0.8 }, tail: { len: 0.5, r: 0.22, nozzles: 1 },
    fins: [{ x: -1.3, chord: 0.6, span: 0.4, sweep: 0.15, taper: 0.6, layout: 'tri' }],
    rings: [-0.3, 0.7, 1.5], body: 0x587a82, paint: 0.25, duct: true,
  },
  // tiny three-fin dart
  stinger05: {
    len: 3.8, r: 0.15, nose: { kind: 'spike', len: 0.9 }, tail: { len: 0.35, r: 0.1, nozzles: 1 },
    fins: [{ x: -1.3, chord: 0.6, span: 0.5, sweep: 0.3, taper: 0.3, layout: 'tri' }],
    rings: [0.1], body: 0x7f8c84, paint: 0.3, stripe: true,
  },
  // wide emitter pod with antenna blades and stabiliser fins
  thunder66: {
    len: 4.4, r: 0.36, nose: { kind: 'blunt', len: 0.6 }, tail: { len: 0.4, r: 0.28, nozzles: 0 },
    fins: [{ x: -1.5, chord: 0.7, span: 0.45, sweep: 0.2, taper: 0.6, layout: 'pair' }],
    rings: [-0.6, 0.0, 0.6, 1.2], body: 0x5f6e78, paint: 0.18, blades: 5,
  },
  // heavy lance: long spike nose, large glowing wings
  gungnir01: {
    len: 6.6, r: 0.34, nose: { kind: 'spike', len: 2.2 }, tail: { len: 0.6, r: 0.26, nozzles: 1 },
    fins: [{ x: -1.0, chord: 1.9, span: 1.0, sweep: 1.0, taper: 0.25, layout: 'x', glow: true }],
    rings: [0.4, 1.0], body: 0x7d7a68, paint: 0.3, stripe: true,
  },
  // twin parallel bodies joined by a bridge, cold colours
  frostbite12: {
    len: 5, r: 0.17, nose: { kind: 'ogive', len: 1.1 }, tail: { len: 0.45, r: 0.12, nozzles: 1 },
    fins: [{ x: -1.6, chord: 0.7, span: 0.5, sweep: 0.3, taper: 0.4, layout: 'pair' }],
    rings: [0.0, 1.0], body: 0x7a9096, paint: 0.3, twin: true,
  },
  // fat drop-shaped body with box fins
  ironhammer20: {
    len: 4.6, r: 0.48, nose: { kind: 'blunt', len: 1.0 }, tail: { len: 0.9, r: 0.22, nozzles: 0 },
    fins: [{ x: -1.7, chord: 0.8, span: 0.65, sweep: 0.0, taper: 1, layout: 'cross' }],
    rings: [-0.3, 0.6], body: 0x6d6a5e, paint: 0.3,
  },
  // large body, winglets and a cluster of glowing tail nozzles
  phoenix54: {
    len: 6.8, r: 0.34, nose: { kind: 'ogive', len: 1.9 }, tail: { len: 0.7, r: 0.3, nozzles: 3 },
    fins: [{ x: -0.6, chord: 1.4, span: 0.55, sweep: 0.7, taper: 0.3, layout: 'cross' }, { x: -2.6, chord: 0.8, span: 0.6, sweep: 0.4, taper: 0.4, layout: 'cross' }],
    rings: [0.3, 1.1, 1.9], body: 0x846d6a, paint: 0.3, stripe: true,
  },
};

export const WEAPON_MODEL_IDS: readonly string[] = Object.keys(CFG);

function noseProfile(cfg: WeaponCfg): P2[] {
  const { r, nose } = cfg;
  const x0 = cfg.len / 2 - nose.len;
  const pts: P2[] = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let rr: number;
    switch (nose.kind) {
      case 'spike': rr = r * Math.pow(1 - t, 1.15); break;
      case 'blunt': rr = r * Math.pow(1 - t * t, 0.5) * (1 - 0.0 * t); break;
      case 'flat': rr = r * (1 - 0.25 * t * t); break;
      case 'dome': rr = r * Math.sqrt(Math.max(0, 1 - t * t)); break;
      default: rr = r * Math.pow(Math.cos((t * Math.PI) / 2), 0.9); break;
    }
    pts.push([x0 + nose.len * t, Math.max(rr, i === n && nose.kind !== 'flat' && nose.kind !== 'blunt' ? 0 : rr)]);
  }
  if (nose.kind === 'flat' || nose.kind === 'blunt') pts[pts.length - 1][1] = Math.max(pts[pts.length - 1][1], r * 0.35);
  return pts;
}

function bodyProfile(cfg: WeaponCfg): Array<[number, number]> {
  const x0 = -cfg.len / 2;
  const prof: Array<[number, number]> = [
    [x0, 0.0001],
    [x0, cfg.tail.r],
    [x0 + cfg.tail.len, cfg.r],
    [cfg.len / 2 - cfg.nose.len, cfg.r],
  ];
  for (const p of noseProfile(cfg).slice(1)) prof.push(p);
  return prof;
}

function finPolygon(f: FinSet, r: number, sign: 1 | -1): P2[] {
  return [
    [f.x, sign * r * 0.9],
    [f.x - f.sweep, sign * (r + f.span)],
    [f.x - f.sweep - f.chord * f.taper, sign * (r + f.span)],
    [f.x - f.chord, sign * r * 0.9],
  ];
}

function addBody(b: KitBuilder, cfg: WeaponCfg, accent: number, glow: THREE.Material, shell: THREE.Material, dark: THREE.Material, off: V3, rScale: number): void {
  const c: WeaponCfg = { ...cfg, r: cfg.r * rScale, tail: { ...cfg.tail, r: cfg.tail.r * rScale } };
  b.add(b.lathe(bodyProfile(c), 24), shell, { pos: off, tag: 'body' });
  // painted bands
  for (const x of c.rings) b.add(b.ringX(c.r * 1.01, 0.03 * Math.max(0.6, rScale), 28), stdMat(accent, 0.4, 0.45), { pos: [off[0] + x, off[1], off[2]] });
  // seeker / nose glow
  const noseX = c.len / 2;
  if (c.nose.kind === 'flat' || c.nose.kind === 'blunt') {
    b.add(b.cylX(c.r * 0.5, c.r * 0.5, 0.05, 16), glow, { pos: [off[0] + noseX + 0.01, off[1], off[2]], tag: 'seeker' });
  } else {
    b.add(b.sphere(12, 8), glow, { pos: [off[0] + noseX - c.nose.len * 0.9, off[1], off[2]], scale: [c.r * 0.5, c.r * 0.35, c.r * 0.35], tag: 'seeker' });
  }
  // rear motor
  b.add(b.cylX(c.tail.r * 0.95, c.tail.r * 0.75, 0.14, 16), dark, { pos: [off[0] - c.len / 2 - 0.05, off[1], off[2]] });
  if (c.tail.nozzles <= 1 && c.tail.nozzles > 0) {
    b.add(b.sphere(12, 8), glow, { pos: [off[0] - c.len / 2 - 0.12, off[1], off[2]], scale: [0.12, c.tail.r * 0.7, c.tail.r * 0.7], tag: 'motor' });
  } else if (c.tail.nozzles > 1) {
    for (let i = 0; i < c.tail.nozzles; i++) {
      const a = (i / c.tail.nozzles) * Math.PI * 2 + Math.PI / 2;
      const y = Math.sin(a) * c.tail.r * 0.5;
      const z = Math.cos(a) * c.tail.r * 0.5;
      b.add(b.cylX(0.07, 0.1, 0.22, 10), dark, { pos: [off[0] - c.len / 2 - 0.12, off[1] + y, off[2] + z] });
      b.add(b.sphere(10, 6), glow, { pos: [off[0] - c.len / 2 - 0.26, off[1] + y, off[2] + z], scale: [0.12, 0.07, 0.07], tag: 'motor' });
    }
  }
  // fins
  const fm = stdMat(mixColor(c.body, 0x222c30, 0.35), 0.5, 0.4);
  const fg = glowMat(accent, 1.2);
  for (const f of c.fins) {
    const mat = f.glow ? fg : fm;
    const sets: number[] = f.layout === 'tri' ? [0, 120, 240] : f.layout === 'pair' ? [90, 270] : f.layout === 'x' ? [45, 135, 225, 315] : [0, 90, 180, 270];
    // a fin is a flat plate in the XY plane (vertical); rotate it about the X axis into place
    const geo = b.plateXY(finPolygon(f, c.r, 1), f.glow ? 0.045 : 0.035);
    for (const deg of sets) {
      const a = (deg * Math.PI) / 180;
      b.add(geo, mat, { pos: [off[0], off[1], off[2]], rot: [a, 0, 0], tag: 'fins' });
    }
  }
}

function buildKit(id: string, colorHex: string): ModelKit {
  const cfg = CFG[id] ?? CFG.nova17;
  const accent = hexToNumber(colorHex, 0x73e8ca);
  const b = new KitBuilder();
  const glow = glowMat(accent, 1.9);
  const shell = stdMat(mixColor(cfg.body, accent, cfg.paint), 0.6, 0.34);
  const dark = stdMat(0x263235, 0.85, 0.3);

  if (cfg.twin) {
    const gap = cfg.r * 2.6;
    addBody(b, cfg, accent, glow, shell, dark, [0, 0, gap / 2], 1);
    addBody(b, cfg, accent, glow, shell, dark, [0, 0, -gap / 2], 1);
    b.add(b.box(1.6, 0.06, gap), dark, { pos: [0.3, 0, 0] });
    b.add(b.box(0.5, 0.2, gap + cfg.r * 2), shell, { pos: [-0.9, 0, 0] });
  } else {
    addBody(b, cfg, accent, glow, shell, dark, [0, 0, 0], 1);
  }
  if (cfg.stripe) b.add(b.box(cfg.len * 0.45, 0.025, 0.05), glow, { pos: [0, cfg.r * 1.0, 0] });
  if (cfg.blades) {
    for (let i = 0; i < cfg.blades; i++) {
      const x = -1.3 + (i * 2.4) / Math.max(1, cfg.blades - 1);
      b.add(b.box(0.12, 0.38, 0.04), glow, { pos: [x, cfg.r + 0.18, 0], rot: [0, 0, 0.2] });
    }
  }
  if (cfg.duct) {
    b.add(b.ringX(cfg.tail.r * 1.9, 0.06, 32), shell, { pos: [-cfg.len / 2 + 0.25, 0, 0] });
    b.add(b.ringX(cfg.tail.r * 1.9, 0.03, 32), glow, { pos: [-cfg.len / 2 - 0.05, 0, 0] });
  }
  // hanger lugs (generic, drawn on every store)
  b.add(b.box(0.22, 0.08, 0.06), dark, { pos: [0.4, cfg.r + 0.03, 0] });
  b.add(b.box(0.22, 0.08, 0.06), dark, { pos: [-0.5, cfg.r + 0.03, 0] });

  const anchors: Array<[string, string, string, V3]> = [
    ['seeker', '導引艙', 'SEEKER', [cfg.len / 2 - cfg.nose.len * 0.7, cfg.r * 1.6, 0]],
    ['body', '彈體', 'BODY', [0, cfg.r * 1.9, 0]],
    ['fins', '穩定翼', 'FINS', [cfg.fins[cfg.fins.length - 1].x - 0.3, cfg.r + cfg.fins[cfg.fins.length - 1].span + 0.2, 0]],
    ['motor', '推進段', 'MOTOR', [-cfg.len / 2, cfg.r * 1.6, 0]],
  ];
  for (const a of anchors) b.anchor(...a);
  return b.build();
}

const cache = new Map<string, ModelKit>();

/** Deterministic; geometry and materials are shared between instances (never dispose them). */
export function buildWeaponModel(id: string, colorHex: string): THREE.Group {
  const key = `${id}|${colorHex}`;
  let kit = cache.get(key);
  if (!kit) {
    kit = buildKit(id, colorHex);
    cache.set(key, kit);
  }
  return instantiate(kit);
}

export function weaponAnchors(id: string, colorHex: string): Anchor[] {
  buildWeaponModel(id, colorHex);
  return cache.get(`${id}|${colorHex}`)?.anchors ?? [];
}
