import * as THREE from 'three';

/**
 * Shared helpers for the original, procedural encyclopedia models.
 * A "kit" is a cached list of part descriptors (geometry + material + transform). Building a model
 * from a kit only creates lightweight Mesh objects that share the kit's geometry and materials, so
 * spawning an aircraft in flight never re-generates geometry and never allocates per frame.
 */

export type V3 = [number, number, number];

export interface PartSpec {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  pos?: V3;
  rot?: V3;
  scale?: V3;
  lines?: boolean;
  tag?: string;
}

export interface Anchor {
  key: string;
  /** Traditional-Chinese generic game-part name. */
  label: string;
  en: string;
  pos: V3;
}

export interface ModelKit {
  parts: PartSpec[];
  anchors: Anchor[];
}

export function instantiate(kit: ModelKit): THREE.Group {
  const group = new THREE.Group();
  for (const p of kit.parts) {
    const object: THREE.Object3D = p.lines
      ? new THREE.LineSegments(p.geo, p.mat)
      : new THREE.Mesh(p.geo, p.mat);
    if (p.pos) object.position.set(p.pos[0], p.pos[1], p.pos[2]);
    if (p.rot) object.rotation.set(p.rot[0], p.rot[1], p.rot[2]);
    if (p.scale) object.scale.set(p.scale[0], p.scale[1], p.scale[2]);
    if (p.tag) object.userData.part = p.tag;
    group.add(object);
  }
  // The geometry and materials are shared between instances: viewers must not dispose them.
  group.userData.shared = true;
  group.userData.anchors = kit.anchors;
  return group;
}

export function hexToNumber(text: string, fallback: number): number {
  const value = Number.parseInt(text.replace('#', ''), 16);
  return Number.isFinite(value) ? value : fallback;
}

export function mixColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/** Collects parts and de-duplicates simple primitive geometries. */
export class KitBuilder {
  readonly parts: PartSpec[] = [];
  readonly anchors: Anchor[] = [];
  private readonly cache = new Map<string, THREE.BufferGeometry>();

  private memo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let geo = this.cache.get(key);
    if (!geo) {
      geo = make();
      this.cache.set(key, geo);
    }
    return geo;
  }

  box(w: number, h: number, d: number): THREE.BufferGeometry {
    return this.memo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
  }

  /** Cylinder whose axis points along +X (nose direction). */
  cylX(r0: number, r1: number, len: number, seg = 16): THREE.BufferGeometry {
    return this.memo(`c${r0},${r1},${len},${seg}`, () => {
      // r1 is the radius at the +X end.
      const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1);
      g.rotateZ(-Math.PI / 2);
      return g;
    });
  }

  sphere(seg = 14, rings = 10): THREE.BufferGeometry {
    return this.memo(`s${seg},${rings}`, () => new THREE.SphereGeometry(1, seg, rings));
  }

  /** Upper half of a unit sphere; scale it to build canopies. */
  dome(seg = 18, rings = 8): THREE.BufferGeometry {
    return this.memo(`d${seg},${rings}`, () => new THREE.SphereGeometry(1, seg, rings, 0, Math.PI * 2, 0, Math.PI / 2));
  }

  /** Torus ring around the X axis. */
  ringX(r: number, tube: number, seg = 20): THREE.BufferGeometry {
    return this.memo(`t${r},${tube},${seg}`, () => {
      const g = new THREE.TorusGeometry(r, tube, 6, seg);
      g.rotateY(Math.PI / 2);
      return g;
    });
  }

  /** Half arc in the XY plane (bow frame when rotated about Y). */
  arch(r: number, tube: number): THREE.BufferGeometry {
    return this.memo(`a${r},${tube}`, () => new THREE.TorusGeometry(r, tube, 5, 14, Math.PI));
  }

  /** Revolve a profile (x along the axis, r radius) around +X. */
  lathe(profile: Array<[number, number]>, seg = 18): THREE.BufferGeometry {
    const key = `l${seg}:${profile.map((p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`).join(';')}`;
    return this.memo(key, () => {
      // LatheGeometry revolves around Y; points are (radius, height).
      const pts = profile.map((p) => new THREE.Vector2(Math.max(p[1], 0.0001), p[0]));
      const g = new THREE.LatheGeometry(pts, seg);
      g.rotateZ(-Math.PI / 2); // Y axis -> +X
      return g;
    });
  }

  /** Extruded polygon in the XY plane, thickness along Z (centered). */
  plateXY(points: Array<[number, number]>, thick: number): THREE.BufferGeometry {
    const key = `px${thick}:${points.map((p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`).join(';')}`;
    return this.memo(key, () => {
      const shape = new THREE.Shape();
      points.forEach((p, i) => (i === 0 ? shape.moveTo(p[0], p[1]) : shape.lineTo(p[0], p[1])));
      shape.closePath();
      const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, steps: 1 });
      g.translate(0, 0, -thick / 2);
      return g;
    });
  }

  /** Extruded polygon in the XZ plane (planform), thickness downward from y = 0 to -thick. */
  plateXZ(points: Array<[number, number]>, thick: number): THREE.BufferGeometry {
    const key = `pz${thick}:${points.map((p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`).join(';')}`;
    return this.memo(key, () => {
      const shape = new THREE.Shape();
      points.forEach((p, i) => (i === 0 ? shape.moveTo(p[0], p[1]) : shape.lineTo(p[0], p[1])));
      shape.closePath();
      const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, steps: 1 });
      g.rotateX(Math.PI / 2); // shape Y -> +Z, extrusion depth -> -Y
      g.translate(0, thick / 2, 0); // centre the slab on y = 0
      return g;
    });
  }

  /** Line segments from a flat [x,y,z, x,y,z, ...] list (pairs form one segment). */
  segments(flat: number[]): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(flat, 3));
    return g;
  }

  add(geo: THREE.BufferGeometry, mat: THREE.Material, opts: { pos?: V3; rot?: V3; scale?: V3; tag?: string; lines?: boolean } = {}): void {
    this.parts.push({ geo, mat, pos: opts.pos, rot: opts.rot, scale: opts.scale, tag: opts.tag, lines: opts.lines });
  }

  anchor(key: string, label: string, en: string, pos: V3): void {
    this.anchors.push({ key, label, en, pos });
  }

  build(): ModelKit {
    return { parts: this.parts, anchors: this.anchors };
  }
}

export function stdMat(color: number, metalness = 0.55, roughness = 0.38, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness, side: THREE.DoubleSide, ...extra });
}

export function glowMat(color: number, intensity = 1.8): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, metalness: 0.2, roughness: 0.3 });
}

export function lineMat(color: number, opacity = 0.55): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({ color, transparent: true, opacity });
}

/** Cross-section station of a lofted fuselage / body. */
export interface Station {
  x: number;
  w: number; // half width
  top: number; // height above centre line
  bot: number; // depth below centre line
  cy: number; // centre line height
}

export interface Loft {
  geo: THREE.BufferGeometry;
  /** rings[i][k] = [x, y, z] */
  rings: V3[][];
}

/**
 * Loft a body through cross-sections. `n` is the superellipse exponent (2 = oval, 4 = boxy,
 * 3+ gives chined stealth-style shapes). `seg` must be a multiple of four. Ring index 0 is the
 * +Z side point, seg/4 the top, seg/2 the -Z side, 3*seg/4 the bottom.
 */
export function loft(stations: Station[], n: number, seg = 16, grow = 1): Loft {
  const ex = 2 / Math.max(n, 1.2);
  const rings: V3[][] = [];
  const pos: number[] = [];
  for (const st of stations) {
    const ring: V3[] = [];
    for (let k = 0; k < seg; k++) {
      const th = (k / seg) * Math.PI * 2;
      const c = Math.cos(th);
      const s = Math.sin(th);
      const zc = Math.sign(c) * Math.pow(Math.abs(c), ex);
      const ys = Math.sign(s) * Math.pow(Math.abs(s), ex);
      const z = st.w * zc * grow;
      const y = st.cy + (s >= 0 ? st.top : st.bot) * ys * grow;
      ring.push([st.x, y, z]);
      pos.push(st.x, y, z);
    }
    rings.push(ring);
  }
  const idx: number[] = [];
  for (let i = 0; i < stations.length - 1; i++) {
    for (let k = 0; k < seg; k++) {
      const a = i * seg + k;
      const b = i * seg + ((k + 1) % seg);
      const c = (i + 1) * seg + k;
      const d = (i + 1) * seg + ((k + 1) % seg);
      idx.push(a, c, b, b, c, d);
    }
  }
  // End caps.
  const first = stations[0];
  const last = stations[stations.length - 1];
  const tailCenter = pos.length / 3;
  pos.push(first.x, first.cy, 0);
  const noseCenter = pos.length / 3;
  pos.push(last.x, last.cy, 0);
  const lastBase = (stations.length - 1) * seg;
  for (let k = 0; k < seg; k++) {
    const k2 = (k + 1) % seg;
    idx.push(tailCenter, k2, k);
    idx.push(noseCenter, lastBase + k, lastBase + k2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return { geo, rings };
}

const DIGITS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
};

/** Pixel-font digits merged into one flat geometry in the XY plane (centered). */
export function digitsGeometry(text: string, cell: number, mirror: boolean): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const total = (text.length * 4 - 1) * cell;
  let q = 0;
  for (let i = 0; i < text.length; i++) {
    const glyph = DIGITS[text[i]] ?? DIGITS['0'];
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        if (glyph[row][col] !== '1') continue;
        let x0 = (i * 4 + col) * cell - total / 2;
        let x1 = x0 + cell;
        if (mirror) { const t = -x0; x0 = -x1; x1 = t; }
        const y1 = (4 - row) * cell - 2.5 * cell;
        const y0 = y1 - cell;
        pos.push(x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y1, 0);
        idx.push(q, q + 1, q + 2, q, q + 2, q + 3);
        q += 4;
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
