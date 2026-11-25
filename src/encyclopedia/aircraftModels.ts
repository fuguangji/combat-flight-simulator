import * as THREE from 'three';
import {
  KitBuilder, clamp, digitsGeometry, glowMat, instantiate, lineMat, loft, mixColor, stdMat,
  type Anchor, type ModelKit, type Station, type V3,
} from './modelKit';

/**
 * Sixteen original, procedural aircraft silhouettes.
 * Coordinate convention (must not change): nose +X, up +Y, right wing +Z, length about 8 units,
 * origin near the fuselage centre. Every aircraft is generated deterministically from its id
 * (no randomness). All shapes, paint schemes and numbers are fictional game art.
 */

type P2 = [number, number];

interface FusCfg {
  w: number; top: number; bot: number; noseL: number; noseQ: number; tail: number; n: number;
  blend?: number; cy?: number; drop?: number;
}
interface FinCfg { pts: P2[]; z: number; cant: number; y?: number; kind?: 'twin' | 'single' | 'v' }
interface IntakeCfg { kind: 'box' | 'round' | 'bump'; x: number; y: number; z: number; len: number; w: number; h: number; split?: boolean; mirror?: boolean }
interface EngineCfg { x: number; y: number; z: number; r: number; len?: number; kind?: 'round' | 'flat'; nac?: number; strut?: boolean }
interface CanopyCfg { x: number; len: number; h: number; w: number; style: 'bubble' | 'faceted' | 'long' | 'wrap'; seats: number; seatGap?: number }
interface PylonCfg { x: number; z: number; kind: 'tank' | 'pod' | 'rail'; y?: number }
type Extra = 'pitot' | 'irst' | 'spine' | 'blade' | 'tailcone' | 'tips' | 'probe' | 'hook' | 'speedbrake' | 'camera' | 'gun' | 'ventral' | 'pivot' | 'fold' | 'bigtips';

interface AircraftCfg {
  base: number; wingCol: number; accent: number; dark: number;
  fus: FusCfg;
  wing: { R: P2[]; y: number; th: number; stripe?: [number, number] };
  canard?: { R: P2[]; y: number; th: number };
  htail?: { R: P2[]; y: number; th: number };
  fins: FinCfg[];
  intakes: IntakeCfg[];
  engines: EngineCfg[];
  canopy: CanopyCfg;
  pylons: PylonCfg[];
  extras: Extra[];
  bands: Array<[number, number]>;
  gear: boolean;
  ab: boolean;
  numX: number;
}

const X0 = -3.95;
const X1 = 4.15;

const TWIN = (z: number, cant: number, pts: P2[], y = 0): FinCfg[] => [{ pts, z, cant, y, kind: 'twin' }];

const CFG: AircraftCfg[] = [
  // 0 viper-t21: light single-engine, close-coupled canard delta, chin intake.
  {
    base: 0x6f8794, wingCol: 0x5d727d, accent: 0xf0a04b, dark: 0x1c2a2e,
    fus: { w: 0.36, top: 0.34, bot: 0.28, noseL: 0.26, noseQ: 1.5, tail: 0.6, n: 2.4, blend: 0.1 },
    wing: { R: [[0.8, 0.2], [-1.35, 2.6], [-2.0, 2.6], [-2.7, 0.2]], y: -0.05, th: 0.1, stripe: [0.55, 0.72] },
    canard: { R: [[1.9, 0.3], [1.45, 1.2], [1.1, 1.2], [1.05, 0.3]], y: 0.08, th: 0.04 },
    fins: [{ pts: [[-1.5, 0.3], [-3.0, 1.7], [-3.55, 1.7], [-3.45, 0.3]], z: 0, cant: 0, kind: 'single' }],
    intakes: [{ kind: 'box', x: 1.1, y: -0.42, z: 0, len: 1.3, w: 0.5, h: 0.32, mirror: false }],
    engines: [{ x: -3.95, y: 0, z: 0, r: 0.27, len: 0.7 }],
    canopy: { x: 1.5, len: 1.5, h: 0.36, w: 0.52, style: 'bubble', seats: 1 },
    pylons: [{ x: -0.9, z: 1.0, kind: 'tank' }, { x: -1.2, z: 1.9, kind: 'pod' }],
    extras: ['pitot', 'tips', 'blade'], bands: [[-3.3, -2.8], [2.5, 2.8]], gear: true, ab: true, numX: -2.3,
  },
  // 1 atlantic-9: carrier twin, forward-swept folding wing, side box intakes, upright twin fins.
  {
    base: 0x9aa8ad, wingCol: 0x879899, accent: 0x2fb8a8, dark: 0x1d2b2d,
    fus: { w: 0.4, top: 0.36, bot: 0.34, noseL: 0.3, noseQ: 1.8, tail: 0.55, n: 2.2, blend: 0.15 },
    wing: { R: [[0.1, 0.35], [0.8, 2.9], [0.3, 2.9], [-2.2, 0.35]], y: -0.02, th: 0.11, stripe: [0.6, 0.78] },
    htail: { R: [[-2.6, 0.3], [-3.2, 1.5], [-3.6, 1.5], [-3.7, 0.3]], y: 0.05, th: 0.05 },
    fins: TWIN(0.55, 0.12, [[-2.0, 0.35], [-3.0, 1.6], [-3.45, 1.55], [-3.3, 0.3]]),
    intakes: [{ kind: 'box', x: 0.7, y: -0.12, z: 0.5, len: 1.5, w: 0.3, h: 0.5, split: true, mirror: true }],
    engines: [{ x: -3.9, y: 0, z: 0.3, r: 0.22, len: 0.6 }, { x: -3.9, y: 0, z: -0.3, r: 0.22, len: 0.6 }],
    canopy: { x: 1.7, len: 1.6, h: 0.38, w: 0.55, style: 'long', seats: 1 },
    pylons: [{ x: 0.1, z: 1.1, kind: 'tank' }, { x: 0.4, z: 1.9, kind: 'pod' }, { x: 0.6, z: 2.6, kind: 'rail' }],
    extras: ['hook', 'fold', 'pitot', 'tips'], bands: [[-3.4, -2.9], [0.0, 0.25]], gear: true, ab: true, numX: -2.2,
  },
  // 2 strike-15: heavy attack twin, wide blended body, cheek intakes, big fins, many pylons.
  {
    base: 0x7f7a5c, wingCol: 0x6d694f, accent: 0xe0b23c, dark: 0x25241b,
    fus: { w: 0.55, top: 0.42, bot: 0.4, noseL: 0.32, noseQ: 1.3, tail: 0.75, n: 2.6, blend: 0.35 },
    wing: { R: [[1.0, 0.4], [-0.6, 3.5], [-1.5, 3.5], [-3.0, 0.4]], y: 0.12, th: 0.14, stripe: [0.45, 0.62] },
    htail: { R: [[-2.9, 0.4], [-3.5, 1.9], [-3.9, 1.9], [-3.95, 0.4]], y: 0.0, th: 0.06 },
    fins: TWIN(0.75, 0, [[-1.8, 0.4], [-3.0, 2.0], [-3.6, 2.0], [-3.6, 0.4]]),
    intakes: [{ kind: 'box', x: 0.5, y: -0.25, z: 0.62, len: 1.8, w: 0.45, h: 0.55, split: true, mirror: true }],
    engines: [{ x: -3.9, y: 0, z: 0.5, r: 0.3, len: 0.8 }, { x: -3.9, y: 0, z: -0.5, r: 0.3, len: 0.8 }],
    canopy: { x: 2.1, len: 1.9, h: 0.42, w: 0.6, style: 'long', seats: 2, seatGap: 0.55 },
    pylons: [
      { x: 0.2, z: 1.2, kind: 'tank' }, { x: 0.0, z: 2.1, kind: 'pod' }, { x: -0.2, z: 2.9, kind: 'rail' },
      { x: 0.6, z: 0.75, kind: 'rail', y: -0.5 },
    ],
    extras: ['pitot', 'spine', 'blade', 'speedbrake', 'camera'], bands: [[-3.5, -3.0], [1.0, 1.3]], gear: true, ab: true, numX: -2.6,
  },
  // 3 shadow-35: faceted chined single, bump intakes, canted fins, big flush bays, no pylons.
  {
    base: 0x3a444b, wingCol: 0x333c42, accent: 0x7a8fa0, dark: 0x0f1518,
    fus: { w: 0.5, top: 0.26, bot: 0.22, noseL: 0.38, noseQ: 0.9, tail: 0.5, n: 3.8, blend: 0.2 },
    wing: { R: [[1.2, 0.4], [-1.1, 2.7], [-1.7, 2.7], [-3.2, 0.4]], y: -0.02, th: 0.08 },
    htail: { R: [[-2.8, 0.4], [-3.5, 1.5], [-3.95, 1.5], [-3.95, 0.4]], y: 0.0, th: 0.05 },
    fins: TWIN(0.45, 0.45, [[-2.1, 0.3], [-3.2, 1.2], [-3.65, 1.2], [-3.5, 0.3]]),
    intakes: [{ kind: 'bump', x: 1.2, y: -0.1, z: 0.48, len: 1.2, w: 0.4, h: 0.4, mirror: true }],
    engines: [{ x: -3.9, y: 0, z: 0, r: 0.26, len: 0.6 }],
    canopy: { x: 1.7, len: 1.7, h: 0.3, w: 0.5, style: 'faceted', seats: 1 },
    pylons: [], extras: ['blade'], bands: [[-3.6, -3.2]], gear: true, ab: true, numX: -2.5,
  },
  // 4 aurora-07: high-altitude long-span wing, slim needle body, V tail, belly engine pods.
  {
    base: 0xcfd6d8, wingCol: 0xbcc5c8, accent: 0x3b82c4, dark: 0x1e2a33,
    fus: { w: 0.3, top: 0.3, bot: 0.28, noseL: 0.4, noseQ: 0.7, tail: 0.45, n: 2.2, blend: 0.1 },
    wing: { R: [[0.6, 0.3], [-1.6, 4.1], [-2.2, 4.1], [-2.9, 0.3]], y: 0.1, th: 0.08, stripe: [0.7, 0.85] },
    fins: [{ pts: [[-2.4, 0.2], [-3.5, 1.7], [-3.95, 1.7], [-3.7, 0.2]], z: 0.25, cant: 0.85, y: 0.1, kind: 'v' }],
    intakes: [],
    engines: [{ x: -3.0, y: -0.3, z: 0.62, r: 0.26, len: 0.6, nac: 3.0, strut: true }, { x: -3.0, y: -0.3, z: -0.62, r: 0.26, len: 0.6, nac: 3.0, strut: true }],
    canopy: { x: 1.6, len: 2.0, h: 0.26, w: 0.36, style: 'long', seats: 2, seatGap: 0.55 },
    pylons: [], extras: ['pitot', 'camera', 'spine'], bands: [[-3.0, -2.5], [2.7, 3.0]], gear: true, ab: true, numX: -2.0,
  },
  // 5 titan-99: big two-seat twin, huge rectangular intakes, giant twin fins, twelve stations.
  {
    base: 0x6a7073, wingCol: 0x5a6063, accent: 0xe8c22b, dark: 0x1b1f22,
    fus: { w: 0.6, top: 0.45, bot: 0.4, noseL: 0.3, noseQ: 1.4, tail: 0.7, n: 2.8, blend: 0.3 },
    wing: { R: [[0.9, 0.5], [-1.0, 3.8], [-2.2, 3.8], [-3.3, 0.5]], y: 0.15, th: 0.16, stripe: [0.4, 0.55] },
    htail: { R: [[-3.0, 0.5], [-3.6, 2.1], [-3.95, 2.1], [-3.95, 0.5]], y: 0.0, th: 0.06 },
    fins: TWIN(0.8, 0.1, [[-1.8, 0.45], [-3.0, 2.3], [-3.7, 2.2], [-3.7, 0.45]]),
    intakes: [{ kind: 'box', x: 0.7, y: -0.1, z: 0.7, len: 2.0, w: 0.5, h: 0.7, split: true, mirror: true }],
    engines: [{ x: -3.9, y: 0, z: 0.55, r: 0.32, len: 0.8 }, { x: -3.9, y: 0, z: -0.55, r: 0.32, len: 0.8 }],
    canopy: { x: 2.2, len: 2.3, h: 0.45, w: 0.62, style: 'long', seats: 2, seatGap: 0.7 },
    pylons: [
      { x: 0.4, z: 1.2, kind: 'tank' }, { x: 0.2, z: 1.9, kind: 'pod' }, { x: 0.0, z: 2.6, kind: 'rail' }, { x: -0.2, z: 3.3, kind: 'rail' },
      { x: 1.0, z: 0.45, kind: 'rail', y: -0.55 }, { x: 0.2, z: 0.0, kind: 'tank', y: -0.55 },
    ],
    extras: ['pitot', 'spine', 'blade', 'speedbrake', 'probe'], bands: [[-3.5, -3.1], [1.1, 1.5]], gear: true, ab: true, numX: -2.7,
  },
  // 6 falcon-16: light single, swept wing with strakes, big chin scoop, tall single fin.
  {
    base: 0xa89a78, wingCol: 0x978a6a, accent: 0x2a9d8f, dark: 0x2a2519,
    fus: { w: 0.38, top: 0.33, bot: 0.28, noseL: 0.3, noseQ: 1.3, tail: 0.6, n: 2.2, blend: 0.1 },
    wing: { R: [[1.9, 0.3], [0.7, 0.75], [-0.8, 2.6], [-1.6, 2.6], [-2.5, 0.35]], y: -0.05, th: 0.09, stripe: [0.6, 0.78] },
    htail: { R: [[-2.5, 0.35], [-3.4, 1.4], [-3.75, 1.4], [-3.8, 0.35]], y: -0.02, th: 0.05 },
    fins: [{ pts: [[-1.6, 0.3], [-3.0, 1.75], [-3.6, 1.75], [-3.5, 0.3]], z: 0, cant: 0, kind: 'single' }],
    intakes: [{ kind: 'box', x: 1.2, y: -0.42, z: 0, len: 1.5, w: 0.6, h: 0.3, mirror: false }],
    engines: [{ x: -3.9, y: 0, z: 0, r: 0.27, len: 0.7 }],
    canopy: { x: 1.6, len: 1.5, h: 0.4, w: 0.5, style: 'bubble', seats: 1 },
    pylons: [{ x: -0.4, z: 0.9, kind: 'tank' }, { x: -0.7, z: 1.7, kind: 'pod' }],
    extras: ['pitot', 'tips', 'speedbrake'], bands: [[-3.3, -2.9], [2.4, 2.7]], gear: true, ab: true, numX: -2.4,
  },
  // 7 spectre-03: electronic-mission twin, long radome, wingtip pods, dorsal blisters.
  {
    base: 0x2c3350, wingCol: 0x262c46, accent: 0x9a7bd8, dark: 0x0d1020,
    fus: { w: 0.46, top: 0.32, bot: 0.28, noseL: 0.42, noseQ: 1.0, tail: 0.5, n: 3.0, blend: 0.25 },
    wing: { R: [[1.0, 0.4], [-1.2, 3.0], [-2.1, 3.0], [-3.1, 0.4]], y: -0.02, th: 0.1, stripe: [0.5, 0.65] },
    htail: { R: [[-2.9, 0.4], [-3.5, 1.6], [-3.95, 1.6], [-3.9, 0.4]], y: 0.0, th: 0.05 },
    fins: TWIN(0.5, 0.3, [[-2.0, 0.35], [-3.1, 1.5], [-3.6, 1.5], [-3.5, 0.35]]),
    intakes: [{ kind: 'box', x: 0.5, y: -0.15, z: 0.5, len: 1.4, w: 0.35, h: 0.45, mirror: true }],
    engines: [{ x: -3.9, y: 0, z: 0.35, r: 0.23, len: 0.6 }, { x: -3.9, y: 0, z: -0.35, r: 0.23, len: 0.6 }],
    canopy: { x: 1.7, len: 1.7, h: 0.3, w: 0.46, style: 'faceted', seats: 1 },
    pylons: [], extras: ['bigtips', 'spine', 'blade', 'camera', 'tailcone'], bands: [[-3.5, -3.1], [3.0, 3.3]], gear: true, ab: true, numX: -2.4,
  },
  // 8 thunder-97: low-slow attack, thick straight wing, engines in dorsal pods, end-plate fins.
  {
    base: 0x5f7048, wingCol: 0x52613e, accent: 0xd9d28a, dark: 0x1a2013,
    fus: { w: 0.5, top: 0.5, bot: 0.35, noseL: 0.2, noseQ: 1.1, tail: 0.55, n: 2.4, blend: 0.1 },
    wing: { R: [[0.9, 0.5], [0.4, 3.9], [-1.0, 3.9], [-1.6, 0.5]], y: -0.1, th: 0.2, stripe: [0.7, 0.85] },
    htail: { R: [[-3.1, 0.5], [-3.2, 1.9], [-3.9, 1.9], [-3.95, 0.5]], y: 0.0, th: 0.07 },
    fins: [{ pts: [[-3.0, 0.0], [-3.4, 1.3], [-3.95, 1.3], [-3.95, 0.0]], z: 1.85, cant: 0, y: 0.0, kind: 'twin' }],
    intakes: [],
    engines: [{ x: -2.4, y: 0.75, z: 0.85, r: 0.3, len: 0.5, nac: 1.8, strut: true }, { x: -2.4, y: 0.75, z: -0.85, r: 0.3, len: 0.5, nac: 1.8, strut: true }],
    canopy: { x: 1.8, len: 1.5, h: 0.5, w: 0.55, style: 'bubble', seats: 1 },
    pylons: [
      { x: 0.4, z: 1.0, kind: 'tank' }, { x: 0.2, z: 1.8, kind: 'pod' }, { x: 0.0, z: 2.6, kind: 'rail' }, { x: -0.1, z: 3.3, kind: 'rail' },
    ],
    extras: ['gun', 'blade'], bands: [[-1.0, -0.6], [2.8, 3.1]], gear: true, ab: false, numX: -1.6,
  },
  // 9 raptor-22: wide flat twin, 2D flat nozzles, canted fins, wrap canopy.
  {
    base: 0x9aa5ad, wingCol: 0x8a959d, accent: 0xd65a4a, dark: 0x1d2328,
    fus: { w: 0.55, top: 0.26, bot: 0.25, noseL: 0.36, noseQ: 1.0, tail: 0.7, n: 3.4, blend: 0.35 },
    wing: { R: [[1.0, 0.5], [-1.2, 3.2], [-2.0, 3.2], [-3.0, 0.5]], y: -0.03, th: 0.09, stripe: [0.5, 0.65] },
    htail: { R: [[-3.0, 0.5], [-3.6, 1.9], [-3.95, 1.8], [-3.95, 0.5]], y: 0.0, th: 0.05 },
    fins: TWIN(0.55, 0.5, [[-2.0, 0.3], [-3.1, 1.5], [-3.6, 1.5], [-3.5, 0.3]]),
    intakes: [{ kind: 'box', x: 0.9, y: -0.12, z: 0.55, len: 1.5, w: 0.4, h: 0.5, split: true, mirror: true }],
    engines: [{ x: -3.9, y: 0, z: 0.5, r: 0.26, len: 0.6, kind: 'flat' }, { x: -3.9, y: 0, z: -0.5, r: 0.26, len: 0.6, kind: 'flat' }],
    canopy: { x: 1.9, len: 1.9, h: 0.36, w: 0.52, style: 'wrap', seats: 1 },
    pylons: [], extras: ['blade', 'speedbrake'], bands: [[-3.5, -3.0], [2.8, 3.1]], gear: true, ab: true, numX: -2.5,
  },
  // 10 tornado-04: variable-sweep wing (shown swept) with glove and pivot, tall single fin.
  {
    base: 0x70808a, wingCol: 0x607079, accent: 0x6fd0e0, dark: 0x1c262c,
    fus: { w: 0.45, top: 0.38, bot: 0.34, noseL: 0.32, noseQ: 1.7, tail: 0.6, n: 2.3, blend: 0.15 },
    wing: { R: [[1.5, 0.45], [0.6, 0.75], [-1.7, 3.0], [-2.2, 3.0], [-2.6, 0.45]], y: 0.02, th: 0.11, stripe: [0.6, 0.78] },
    htail: { R: [[-2.8, 0.4], [-3.4, 1.7], [-3.8, 1.7], [-3.9, 0.4]], y: -0.15, th: 0.06 },
    fins: [{ pts: [[-1.6, 0.35], [-2.9, 1.9], [-3.7, 1.9], [-3.7, 0.35]], z: 0, cant: 0, kind: 'single' }],
    intakes: [{ kind: 'box', x: 0.3, y: -0.05, z: 0.55, len: 1.6, w: 0.3, h: 0.55, split: true, mirror: true }],
    engines: [{ x: -3.9, y: 0, z: 0.3, r: 0.24, len: 0.7 }, { x: -3.9, y: 0, z: -0.3, r: 0.24, len: 0.7 }],
    canopy: { x: 1.7, len: 2.2, h: 0.36, w: 0.52, style: 'long', seats: 2, seatGap: 0.55 },
    pylons: [{ x: 0.2, z: 1.0, kind: 'tank' }, { x: 0.0, z: 1.6, kind: 'pod' }, { x: 0.6, z: 0.55, kind: 'rail', y: -0.5 }],
    extras: ['pivot', 'pitot', 'probe', 'spine'], bands: [[-3.4, -3.0], [2.7, 3.0]], gear: true, ab: true, numX: -2.2,
  },
  // 11 typhoon-08: large delta wing plus large foreplanes, wide chin intake, twin engines.
  {
    base: 0x8c9a86, wingCol: 0x7b8976, accent: 0xf2d16b, dark: 0x1f261c,
    fus: { w: 0.45, top: 0.34, bot: 0.3, noseL: 0.34, noseQ: 1.2, tail: 0.6, n: 2.4, blend: 0.2 },
    wing: { R: [[0.3, 0.4], [-2.1, 3.1], [-2.9, 3.1], [-3.2, 0.4]], y: -0.05, th: 0.1, stripe: [0.55, 0.7] },
    canard: { R: [[2.1, 0.45], [1.5, 1.5], [1.1, 1.5], [1.2, 0.45]], y: 0.12, th: 0.05 },
    fins: [{ pts: [[-1.9, 0.3], [-3.0, 1.8], [-3.65, 1.8], [-3.6, 0.3]], z: 0, cant: 0, kind: 'single' }],
    intakes: [{ kind: 'box', x: 0.9, y: -0.45, z: 0, len: 1.7, w: 0.8, h: 0.35, mirror: false }],
    engines: [{ x: -3.9, y: 0, z: 0.3, r: 0.23, len: 0.65 }, { x: -3.9, y: 0, z: -0.3, r: 0.23, len: 0.65 }],
    canopy: { x: 1.8, len: 1.7, h: 0.4, w: 0.5, style: 'bubble', seats: 1 },
    pylons: [{ x: -0.5, z: 1.0, kind: 'tank' }, { x: -0.9, z: 1.8, kind: 'pod' }, { x: -1.3, z: 2.5, kind: 'rail' }],
    extras: ['pitot', 'irst', 'tips'], bands: [[-3.4, -3.0], [2.6, 2.9]], gear: true, ab: true, numX: -2.3,
  },
  // 12 athena-s: experimental flat waverider body, needle nose, huge belly duct, wide nozzle.
  {
    base: 0xe6e8ea, wingCol: 0xd5d9dc, accent: 0xff7a2f, dark: 0x22262a,
    fus: { w: 0.85, top: 0.2, bot: 0.17, noseL: 0.6, noseQ: 0.6, tail: 0.75, n: 4, blend: 0.2 },
    wing: { R: [[0.0, 0.8], [-2.1, 3.0], [-2.8, 3.0], [-3.4, 0.8]], y: -0.05, th: 0.05, stripe: [0.6, 0.8] },
    fins: TWIN(0.8, 0.9, [[-2.6, 0.2], [-3.3, 1.0], [-3.75, 1.0], [-3.75, 0.2]]),
    intakes: [{ kind: 'box', x: 0.4, y: -0.28, z: 0, len: 2.8, w: 1.0, h: 0.35, mirror: false }],
    engines: [{ x: -3.9, y: 0, z: 0, r: 0.45, len: 0.5, kind: 'flat' }],
    canopy: { x: 2.0, len: 1.0, h: 0.18, w: 0.4, style: 'faceted', seats: 1 },
    pylons: [], extras: ['blade'], bands: [[2.8, 3.4], [-1.0, -0.7]], gear: true, ab: true, numX: -2.0,
  },
  // 13 hornet-18: carrier multirole, LERX strakes, canted fins, under-strake intakes, folding wing.
  {
    base: 0x7d8c99, wingCol: 0x6c7b88, accent: 0xe35d5b, dark: 0x1c242c,
    fus: { w: 0.42, top: 0.36, bot: 0.3, noseL: 0.3, noseQ: 1.6, tail: 0.6, n: 2.3, blend: 0.15 },
    wing: { R: [[1.9, 0.35], [0.5, 0.75], [-0.7, 3.0], [-1.55, 3.0], [-2.6, 0.4]], y: -0.05, th: 0.1, stripe: [0.55, 0.72] },
    htail: { R: [[-2.7, 0.35], [-3.4, 1.6], [-3.8, 1.6], [-3.85, 0.35]], y: -0.1, th: 0.05 },
    fins: TWIN(0.5, 0.45, [[-1.7, 0.4], [-2.9, 1.8], [-3.4, 1.8], [-3.3, 0.4]]),
    intakes: [{ kind: 'box', x: 0.9, y: -0.1, z: 0.46, len: 1.5, w: 0.3, h: 0.45, mirror: true }],
    engines: [{ x: -3.9, y: 0, z: 0.3, r: 0.22, len: 0.65 }, { x: -3.9, y: 0, z: -0.3, r: 0.22, len: 0.65 }],
    canopy: { x: 1.9, len: 1.5, h: 0.42, w: 0.55, style: 'bubble', seats: 1 },
    pylons: [{ x: 0.0, z: 1.0, kind: 'tank' }, { x: -0.2, z: 1.9, kind: 'pod' }, { x: -0.4, z: 2.6, kind: 'rail' }],
    extras: ['hook', 'fold', 'pitot', 'probe', 'tips'], bands: [[-3.3, -2.9], [3.0, 3.3]], gear: true, ab: true, numX: -2.3,
  },
  // 14 black-eagle-12: very long-span high flyer, dorsal intakes, tall fin, ventral fins, belly camera.
  {
    base: 0x2e3236, wingCol: 0x282c30, accent: 0x9fb1a8, dark: 0x0e1113,
    fus: { w: 0.52, top: 0.36, bot: 0.35, noseL: 0.45, noseQ: 0.8, tail: 0.6, n: 2.8, blend: 0.3 },
    wing: { R: [[1.0, 0.5], [-1.4, 4.6], [-2.4, 4.6], [-3.4, 0.5]], y: 0.1, th: 0.12, stripe: [0.75, 0.9] },
    htail: { R: [[-3.0, 0.5], [-3.6, 1.8], [-3.95, 1.8], [-3.95, 0.5]], y: 0.0, th: 0.06 },
    fins: [{ pts: [[-1.8, 0.4], [-3.1, 2.1], [-3.8, 2.1], [-3.8, 0.4]], z: 0, cant: 0, kind: 'single' }],
    intakes: [{ kind: 'box', x: 0.2, y: 0.45, z: 0.45, len: 1.6, w: 0.4, h: 0.4, split: true, mirror: true }],
    engines: [{ x: -3.9, y: 0, z: 0.4, r: 0.3, len: 0.8 }, { x: -3.9, y: 0, z: -0.4, r: 0.3, len: 0.8 }],
    canopy: { x: 2.4, len: 2.0, h: 0.28, w: 0.42, style: 'long', seats: 2, seatGap: 0.6 },
    pylons: [], extras: ['camera', 'spine', 'blade', 'tailcone', 'ventral', 'tips'], bands: [[-3.5, -3.1], [-0.8, -0.5]], gear: true, ab: true, numX: -2.4,
  },
  // 15 apollo-castle-37: four wing nacelles, thick armoured body, raised bubble, T-tail.
  {
    base: 0x6b6258, wingCol: 0x5b5349, accent: 0xd96f32, dark: 0x1e1b17,
    fus: { w: 0.7, top: 0.55, bot: 0.5, noseL: 0.22, noseQ: 2.2, tail: 0.6, n: 2.8, blend: 0.1 },
    wing: { R: [[0.8, 0.7], [0.2, 4.4], [-1.1, 4.4], [-1.7, 0.7]], y: 0.35, th: 0.18, stripe: [0.8, 0.92] },
    htail: { R: [[-3.0, 0.2], [-3.4, 1.6], [-3.95, 1.6], [-3.95, 0.2]], y: 2.05, th: 0.06 },
    fins: [{ pts: [[-2.4, 0.4], [-3.3, 2.1], [-3.95, 2.1], [-3.85, 0.4]], z: 0, cant: 0, kind: 'single' }],
    intakes: [],
    engines: [
      { x: -1.1, y: 0.0, z: 1.4, r: 0.3, len: 0.5, nac: 2.2, strut: true }, { x: -1.1, y: 0.0, z: -1.4, r: 0.3, len: 0.5, nac: 2.2, strut: true },
      { x: -1.1, y: 0.0, z: 2.7, r: 0.3, len: 0.5, nac: 2.2, strut: true }, { x: -1.1, y: 0.0, z: -2.7, r: 0.3, len: 0.5, nac: 2.2, strut: true },
    ],
    canopy: { x: 2.6, len: 1.6, h: 0.5, w: 0.6, style: 'bubble', seats: 1 },
    pylons: [{ x: 0.3, z: 1.9, kind: 'tank', y: -0.15 }, { x: 0.4, z: 3.4, kind: 'pod', y: -0.15 }, { x: 0.8, z: 0.8, kind: 'rail', y: -0.6 }],
    extras: ['gun', 'probe', 'blade'], bands: [[-3.2, -2.8], [3.2, 3.6]], gear: true, ab: false, numX: -2.2,
  },
];

export const AIRCRAFT_MODEL_COUNT = CFG.length;

// ---- small geometry helpers -------------------------------------------------------------

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
const smooth = (t: number): number => { const c = clamp(t, 0, 1); return c * c * (3 - 2 * c); };

/** Interpolate x on a polyline of [x, z] points at a given z. */
function polyAtZ(poly: P2[], z: number): number {
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i], b = poly[i + 1];
    const lo = Math.min(a[1], b[1]), hi = Math.max(a[1], b[1]);
    if (hi - lo < 1e-6) continue;
    if (z >= lo - 1e-6 && z <= hi + 1e-6) return lerp(a[0], b[0], (z - a[1]) / (b[1] - a[1]));
  }
  return poly[poly.length - 1][0];
}

function planformPolygon(R: P2[]): P2[] {
  const all: P2[] = [...R];
  for (let i = R.length - 1; i >= 0; i--) all.push([R[i][0], -R[i][1]]);
  const out: P2[] = [];
  for (const p of all) {
    const prev = out[out.length - 1];
    if (!prev || Math.hypot(prev[0] - p[0], prev[1] - p[1]) > 1e-4) out.push(p);
  }
  return out;
}

function planformEdges(R: P2[]): { le: P2[]; te: P2[]; zmax: number; z0: number } {
  let zmax = 0;
  R.forEach((p) => { zmax = Math.max(zmax, p[1]); });
  const m = R.findIndex((p) => p[1] >= zmax - 1e-6);
  let tipEnd = m;
  R.forEach((p, i) => { if (p[1] >= zmax - 1e-6) tipEnd = i; });
  return { le: R.slice(0, m + 1), te: R.slice(tipEnd).reverse(), zmax, z0: R[0][1] };
}

/** Control-surface hinge lines for a planform (both sides, top surface). */
function surfaceLines(R: P2[], y: number, kinds: Array<'aileron' | 'flap' | 'slat' | 'fold' | 'elevator'>): number[] {
  const { le, te, zmax, z0 } = planformEdges(R);
  const out: number[] = [];
  const span = zmax - z0;
  const at = (z: number, f: number): number => {
    const l = polyAtZ(le, z), t = polyAtZ(te, z);
    return l + (t - l) * f;
  };
  const seg = (s: number, xa: number, za: number, xb: number, zb: number): void => {
    out.push(xa, y, s * za, xb, y, s * zb);
  };
  for (const s of [1, -1]) {
    for (const k of kinds) {
      if (k === 'aileron' || k === 'flap' || k === 'elevator') {
        const [a0, a1, f] = k === 'aileron' ? [0.58, 0.94, 0.74] : k === 'flap' ? [0.1, 0.52, 0.78] : [0.12, 0.92, 0.66];
        const za = z0 + span * a0, zb = z0 + span * a1;
        seg(s, at(za, f), za, at(zb, f), zb);
        seg(s, at(za, f), za, at(za, 1), za);
        seg(s, at(zb, f), zb, at(zb, 1), zb);
      } else if (k === 'slat') {
        const za = z0 + span * 0.2, zb = z0 + span * 0.96;
        seg(s, at(za, 0.1), za, at(zb, 0.1), zb);
      } else {
        const z = z0 + span * 0.62;
        seg(s, at(z, 0.02), z, at(z, 0.98), z);
      }
    }
  }
  return out;
}

function stationsFor(f: FusCfg): Station[] {
  const ts: number[] = [];
  const noseStart = 1 - f.noseL;
  for (let i = 0; i <= 18; i++) ts.push(i / 18);
  ts.push(noseStart);
  ts.sort((a, b) => a - b);
  const uniq = ts.filter((t, i) => i === 0 || t - ts[i - 1] > 1e-4);
  const cy0 = f.cy ?? 0;
  const out: Station[] = [];
  for (const t of uniq) {
    let s = 1;
    if (t > noseStart) {
      const u = (t - noseStart) / f.noseL;
      s = Math.max(0, 1 - Math.pow(u, f.noseQ));
    }
    const tailZone = 0.3;
    if (t < tailZone) s *= lerp(f.tail, 1, smooth(t / tailZone));
    const bump = Math.exp(-Math.pow((t - 0.42) / 0.2, 2));
    const widen = 1 + (f.blend ?? 0) * bump;
    const u2 = t > noseStart ? (t - noseStart) / f.noseL : 0;
    const droop = (f.drop ?? 0.08) * u2 * u2;
    out.push({
      x: X0 + t * (X1 - X0),
      w: f.w * s * widen,
      top: f.top * Math.pow(s, 0.9),
      bot: f.bot * Math.pow(s, 0.9),
      cy: cy0 - droop,
    });
  }
  return out;
}

function sample(stations: Station[], x: number): Station {
  if (x <= stations[0].x) return stations[0];
  for (let i = 0; i < stations.length - 1; i++) {
    const a = stations[i], b = stations[i + 1];
    if (x >= a.x && x <= b.x) {
      const t = (x - a.x) / (b.x - a.x || 1);
      return { x, w: lerp(a.w, b.w, t), top: lerp(a.top, b.top, t), bot: lerp(a.bot, b.bot, t), cy: lerp(a.cy, b.cy, t) };
    }
  }
  return stations[stations.length - 1];
}

function slice(stations: Station[], x0: number, x1: number): Station[] {
  const out: Station[] = [sample(stations, x0)];
  for (const s of stations) if (s.x > x0 + 1e-4 && s.x < x1 - 1e-4) out.push(s);
  out.push(sample(stations, x1));
  return out;
}

const kitCache = new Map<string, ModelKit>();

function buildKit(id: number, ab: boolean, thrustScale: number): ModelKit {
  const c = CFG[((id % CFG.length) + CFG.length) % CFG.length];
  const b = new KitBuilder();
  const n = c.fus.n;
  const st = stationsFor(c.fus);
  const noseX = X1 - c.fus.noseL * (X1 - X0);

  const baseM = stdMat(c.base, 0.5, 0.4);
  const wingM = stdMat(c.wingCol, 0.5, 0.42);
  const accM = stdMat(c.accent, 0.4, 0.4);
  const trimM = stdMat(mixColor(c.accent, 0xffffff, 0.55), 0.3, 0.5);
  const darkM = stdMat(c.dark, 0.7, 0.35);
  const metalM = stdMat(0x8c9a96, 0.9, 0.3);
  const radomeM = stdMat(mixColor(c.base, 0x20282a, 0.45), 0.2, 0.5);
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x3fb7a2, metalness: 0.3, roughness: 0.1, transparent: true, opacity: 0.55, clearcoat: 1,
    side: THREE.DoubleSide, depthWrite: false, flatShading: c.canopy.style === 'faceted',
  });
  const seamM = lineMat(0x0b1210, 0.5);
  const hingeM = lineMat(0x0b1210, 0.7);
  const abM = glowMat(ab ? c.accent : 0x3a4442, ab ? 1.6 : 0.2);

  // Fuselage: loft in two sections (body + radome), with a seam between them.
  const bodySt = slice(st, X0, noseX);
  const noseSt = slice(st, noseX, X1);
  b.add(loft(bodySt, n, 16).geo, baseM, { tag: 'body' });
  b.add(loft(noseSt, n, 16).geo, radomeM, { tag: 'nose' });

  // Panel lines: ring seams and side/top seams, slightly above the skin.
  const seamLoft = loft(st, n, 16, 1.006).rings;
  const seamPts: number[] = [];
  const pick = [3, 6, 9, 12, 14];
  for (const i of pick) {
    const ring = seamLoft[Math.min(i, seamLoft.length - 2)];
    for (let k = 0; k < ring.length; k++) {
      const p = ring[k], q = ring[(k + 1) % ring.length];
      seamPts.push(p[0], p[1], p[2], q[0], q[1], q[2]);
    }
  }
  for (const idx of [0, 8, 4]) {
    for (let i = 1; i < seamLoft.length - 2; i++) {
      const p = seamLoft[i][idx], q = seamLoft[i + 1][idx];
      seamPts.push(p[0], p[1], p[2], q[0], q[1], q[2]);
    }
  }
  b.add(b.segments(seamPts), seamM, { lines: true, tag: 'body' });

  // Paint bands.
  for (const [x0, x1] of c.bands) {
    b.add(loft(slice(st, x0, x1), n, 16, 1.012).geo, accM, { tag: 'body' });
  }

  // Wing.
  const wy = c.wing.y;
  b.add(b.plateXZ(planformPolygon(c.wing.R), c.wing.th), wingM, { pos: [0, wy, 0], tag: 'wing' });
  const wk: Array<'aileron' | 'flap' | 'slat' | 'fold'> = ['aileron', 'flap', 'slat'];
  if (c.extras.includes('fold')) wk.push('fold');
  b.add(b.segments(surfaceLines(c.wing.R, wy + c.wing.th / 2 + 0.004, wk)), hingeM, { lines: true, tag: 'wing' });
  if (c.wing.stripe) {
    const { le, te, zmax, z0 } = planformEdges(c.wing.R);
    const za = z0 + (zmax - z0) * c.wing.stripe[0], zb = z0 + (zmax - z0) * c.wing.stripe[1];
    const quad: P2[] = [
      [polyAtZ(le, za), za], [polyAtZ(le, zb), zb], [polyAtZ(te, zb), zb], [polyAtZ(te, za), za],
    ];
    const neg: P2[] = quad.map((p): P2 => [p[0], -p[1]]).reverse();
    b.add(b.plateXZ(quad, c.wing.th + 0.012), accM, { pos: [0, wy, 0], tag: 'wing' });
    b.add(b.plateXZ(neg, c.wing.th + 0.012), accM, { pos: [0, wy, 0], tag: 'wing' });
  }
  const edges = planformEdges(c.wing.R);
  const tipLe = edges.le[edges.le.length - 1];
  const tipTe = edges.te[edges.te.length - 1];
  const wingTipX = (tipLe[0] + tipTe[0]) / 2;

  // Foreplane / tailplane.
  if (c.canard) {
    b.add(b.plateXZ(planformPolygon(c.canard.R), c.canard.th), wingM, { pos: [0, c.canard.y, 0], tag: 'canard' });
    b.add(b.segments(surfaceLines(c.canard.R, c.canard.y + c.canard.th / 2 + 0.004, ['elevator'])), hingeM, { lines: true, tag: 'canard' });
  }
  if (c.htail) {
    b.add(b.plateXZ(planformPolygon(c.htail.R), c.htail.th), wingM, { pos: [0, c.htail.y, 0], tag: 'tail' });
    b.add(b.segments(surfaceLines(c.htail.R, c.htail.y + c.htail.th / 2 + 0.004, ['elevator'])), hingeM, { lines: true, tag: 'tail' });
  }

  // Vertical fins (single, twin, canted, V) with rudder hinge lines.
  const finBase = (f: FinCfg): number => (f.y ?? 0) + (f.kind === 'single' || f.kind === 'v' || f.z === 0 ? sample(st, f.pts[0][0]).top * 0.7 : 0);
  let tailTop: V3 = [-3.3, 1.5, 0];
  for (const f of c.fins) {
    const sides = f.z === 0 ? [1] : [1, -1];
    const geo = b.plateXY(f.pts, 0.07);
    const hinge: number[] = [];
    const p = f.pts;
    const hx0 = lerp(p[0][0], p[3][0], 0.7), hy0 = lerp(p[0][1], p[3][1], 0.7);
    const hx1 = lerp(p[1][0], p[2][0], 0.75), hy1 = lerp(p[1][1], p[2][1], 0.75);
    for (const zs of [0.039, -0.039]) hinge.push(hx0, hy0, zs, hx1, hy1, zs);
    const hingeGeo = b.segments(hinge);
    for (const s of sides) {
      const y0 = finBase(f);
      const rotX = s * f.cant;
      b.add(geo, baseM, { pos: [0, y0, s * f.z], rot: [rotX, 0, 0], tag: 'tail' });
      b.add(hingeGeo, hingeM, { pos: [0, y0, s * f.z], rot: [rotX, 0, 0], lines: true, tag: 'tail' });
      // Accent tip cap.
      const tipx = (p[1][0] + p[2][0]) / 2, tipy = Math.max(p[1][1], p[2][1]);
      const capGeo = b.box(Math.abs(p[1][0] - p[2][0]) * 0.9, 0.09, 0.085);
      b.add(capGeo, accM, { pos: [tipx, y0 + (tipy - 0.045) * Math.cos(rotX), s * f.z + (tipy - 0.045) * Math.sin(rotX)], rot: [rotX, 0, 0], tag: 'tail' });
      if (s === 1) tailTop = [tipx, y0 + tipy * Math.cos(rotX), s * f.z + tipy * Math.sin(rotX)];
    }
  }
  if (c.extras.includes('ventral')) {
    for (const s of [1, -1]) {
      b.add(b.plateXY([[-2.6, 0], [-3.4, -0.7], [-3.8, -0.7], [-3.6, 0]], 0.05), darkM, { pos: [0, -0.18, s * 0.38], rot: [s * 0.4, 0, 0], tag: 'tail' });
    }
  }

  // Tail number on the rear fuselage sides (original numbering derived from the id).
  const number = String(((id * 7 + 13) % 90) + 10);
  const nSt = sample(st, c.numX);
  const digitH = 0.05;
  for (const s of [1, -1]) {
    b.add(digitsGeometry(number, digitH, false), trimM, {
      pos: [c.numX, nSt.cy + nSt.top * 0.3, s * (nSt.w * Math.pow(1 - Math.pow(0.3, n), 1 / n) + 0.008)],
      rot: [0, s === 1 ? 0 : Math.PI, 0], tag: 'body',
    });
  }

  // Intakes.
  let firstIntake: V3 | null = null;
  for (const it of c.intakes) {
    const zs = it.mirror === false ? [it.z] : [it.z, -it.z];
    for (const z of zs) {
      if (!firstIntake) firstIntake = [it.x + it.len / 2, it.y, z];
      if (it.kind === 'bump') {
        b.add(b.sphere(), baseM, { pos: [it.x, it.y, z], scale: [it.len / 2, it.h / 2, it.w / 2], tag: 'intake' });
        b.add(b.box(0.05, it.h * 0.55, it.w * 0.7), darkM, { pos: [it.x + it.len * 0.42, it.y, z], tag: 'intake' });
      } else if (it.kind === 'round') {
        b.add(b.cylX(it.w / 2, it.w / 2, it.len), baseM, { pos: [it.x, it.y, z], tag: 'intake' });
        b.add(b.cylX(it.w * 0.4, it.w * 0.4, 0.04), darkM, { pos: [it.x + it.len / 2, it.y, z], tag: 'intake' });
      } else {
        b.add(b.box(it.len, it.h, it.w), baseM, { pos: [it.x, it.y, z], tag: 'intake' });
        b.add(b.box(0.05, it.h * 0.8, it.w * 0.8), darkM, { pos: [it.x + it.len / 2 + 0.005, it.y, z], tag: 'intake' });
        b.add(b.box(0.06, it.h * 1.06, it.w * 1.06), accM, { pos: [it.x + it.len / 2 - 0.03, it.y, z], tag: 'intake' });
        if (it.split) {
          const sz = z + Math.sign(z || 1) * (it.w / 2 + 0.05);
          b.add(b.box(it.len * 0.5, it.h * 0.9, 0.025), metalM, { pos: [it.x + it.len * 0.25, it.y, sz], tag: 'intake' });
        }
      }
    }
  }

  // Engines: nozzle shell, dark interior, turbine cone, afterburner ring.
  let engineAnchor: V3 = [X0 - 0.3, 0, 0];
  c.engines.forEach((e, i) => {
    const r = e.r * thrustScale;
    const len = e.len ?? 0.7;
    const rearX = e.x - len;
    if (i === 0) engineAnchor = [rearX, e.y, e.z];
    if (e.nac) {
      b.add(b.cylX(r * 1.06, r * 1.06, e.nac), baseM, { pos: [e.x + e.nac / 2, e.y, e.z], tag: 'engine' });
      b.add(b.cylX(r * 0.8, r * 0.8, 0.04), darkM, { pos: [e.x + e.nac + 0.005, e.y, e.z], tag: 'intake' });
      b.add(b.ringX(r * 1.06, 0.035, 20), accM, { pos: [e.x + e.nac, e.y, e.z], tag: 'intake' });
      if (!firstIntake) firstIntake = [e.x + e.nac, e.y, e.z];
      if (e.strut) {
        const up = e.y > 0.3;
        const h = Math.max(0.2, Math.abs(e.y - (e.y > 0.3 ? 0 : wy)) + 0.05);
        b.add(b.box(e.nac * 0.45, h, 0.1), baseM, { pos: [e.x + e.nac * 0.5, up ? e.y - h / 2 : e.y + h / 2, e.z * (up ? 0.95 : 1)], tag: 'engine' });
      }
    }
    if (e.kind === 'flat') {
      b.add(b.box(len, r * 1.1, r * 2.4), darkM, { pos: [e.x - len / 2, e.y, e.z], tag: 'engine' });
      b.add(b.box(0.03, r * 0.8, r * 2.0), stdMat(0x050707, 0.4, 0.6), { pos: [rearX - 0.005, e.y, e.z], tag: 'engine' });
      b.add(b.box(0.025, r * 0.12, r * 2.2), abM, { pos: [rearX - 0.02, e.y - r * 0.5, e.z], tag: 'engine' });
    } else {
      b.add(b.lathe([[-len / 2, r * 0.8], [-len * 0.2, r * 0.92], [len * 0.15, r], [len / 2, r * 1.02]], 18), darkM, { pos: [e.x - len / 2, e.y, e.z], tag: 'engine' });
      b.add(b.cylX(r * 0.72, r * 0.72, 0.03), stdMat(0x050707, 0.4, 0.6), { pos: [rearX + 0.01, e.y, e.z], tag: 'engine' });
      b.add(b.cylX(0.02, r * 0.35, 0.26), metalM, { pos: [rearX + 0.14, e.y, e.z], tag: 'engine' });
      b.add(b.ringX(r * 0.82, 0.03, 20), abM, { pos: [rearX, e.y, e.z], tag: 'engine' });
    }
  });

  // Cockpit: tub, seats, coaming, canopy glass and frames.
  const cp = c.canopy;
  const cSt = sample(st, cp.x);
  const yBase = cSt.cy + cSt.top * 0.9;
  b.add(b.box(cp.len * 0.95, 0.07, cp.w * 0.95), darkM, { pos: [cp.x, yBase + 0.02, 0], tag: 'cockpit' });
  b.add(b.box(cp.len * 0.4, 0.07, cp.w * 0.9), darkM, { pos: [cp.x + cp.len * 0.52, yBase + 0.06, 0], rot: [0, 0, -0.18], tag: 'cockpit' });
  for (let i = 0; i < cp.seats; i++) {
    const sx = cp.x - cp.len * 0.12 - i * (cp.seatGap ?? 0.5) + (cp.seats - 1) * (cp.seatGap ?? 0.5) * 0.5;
    b.add(b.box(0.24, 0.07, 0.24), stdMat(0x2b3a37, 0.2, 0.7), { pos: [sx, yBase + 0.08, 0], tag: 'cockpit' });
    b.add(b.box(0.06, 0.28, 0.22), stdMat(0x2b3a37, 0.2, 0.7), { pos: [sx - 0.11, yBase + 0.2, 0], rot: [0, 0, 0.12], tag: 'cockpit' });
    b.add(b.box(0.07, 0.1, 0.1), accM, { pos: [sx - 0.12, yBase + 0.4, 0], tag: 'cockpit' });
  }
  const domeSeg = cp.style === 'faceted' ? 6 : 18;
  const domeRings = cp.style === 'faceted' ? 3 : 8;
  b.add(b.dome(domeSeg, domeRings), glass, { pos: [cp.x, yBase, 0], scale: [cp.len / 2, cp.h, cp.w / 2], tag: 'cockpit' });
  for (const pf of [-0.55, 0.15, 0.7]) {
    const s = Math.sqrt(Math.max(0.05, 1 - pf * pf));
    b.add(b.arch(1, 0.016), trimM, { pos: [cp.x + pf * cp.len / 2, yBase, 0], rot: [0, Math.PI / 2, 0], scale: [cp.w / 2 * s, cp.h * s, 1], tag: 'cockpit' });
  }
  b.add(b.box(cp.len * 0.9, 0.025, 0.025), trimM, { pos: [cp.x, yBase + cp.h * 0.98, 0], tag: 'cockpit' });

  // Pylons and generic external pods (non-functional visual props).
  const tankGeo = b.lathe([[-0.5, 0.001], [-0.42, 0.09], [-0.2, 0.14], [0.2, 0.14], [0.42, 0.09], [0.5, 0.001]], 12);
  c.pylons.forEach((p) => {
    for (const s of [1, -1]) {
      if (p.z === 0 && s === -1) continue;
      const yTop = p.y !== undefined ? p.y : wy - c.wing.th / 2;
      b.add(b.box(0.55, 0.14, 0.06), metalM, { pos: [p.x, yTop - 0.05, s * p.z], tag: 'pylon' });
      if (p.kind === 'tank') b.add(tankGeo, accM, { pos: [p.x, yTop - 0.24, s * p.z], tag: 'pylon' });
      else if (p.kind === 'pod') b.add(b.cylX(0.07, 0.07, 0.8, 10), darkM, { pos: [p.x, yTop - 0.2, s * p.z], tag: 'pylon' });
    }
  });

  // Landing-gear bays.
  if (c.gear) {
    const bay = stdMat(0x0b0f10, 0.3, 0.7);
    const belly = (x: number, z: number): number => {
      const s = sample(st, x);
      return s.cy - s.bot * Math.pow(Math.max(0.05, 1 - Math.pow(Math.abs(z) / Math.max(s.w, 0.05), n)), 1 / n);
    };
    b.add(b.box(0.5, 0.02, 0.24), bay, { pos: [1.9, belly(1.9, 0) + 0.002, 0], tag: 'gear' });
    for (const s of [1, -1]) {
      const z = s * Math.min(0.32, sample(st, -0.5).w * 0.6);
      b.add(b.box(0.8, 0.02, 0.2), bay, { pos: [-0.6, belly(-0.6, z) + 0.002, z], tag: 'gear' });
    }
  }

  // Extras: sensors, antennas, tips, hardware.
  const top = (x: number): number => { const s = sample(st, x); return s.cy + s.top; };
  const bot = (x: number): number => { const s = sample(st, x); return s.cy - s.bot; };
  for (const ex of c.extras) {
    if (ex === 'pitot') b.add(b.cylX(0.012, 0.02, 0.75, 8), metalM, { pos: [X1 + 0.25, sample(st, X1).cy, 0], tag: 'nose' });
    else if (ex === 'irst') b.add(b.sphere(10, 8), stdMat(0x1a2224, 0.8, 0.2), { pos: [cp.x + cp.len * 0.7, yBase + 0.1, 0], scale: [0.14, 0.07, 0.09], tag: 'cockpit' });
    else if (ex === 'spine') b.add(b.box(1.5, 0.1, 0.22), baseM, { pos: [cp.x - cp.len / 2 - 0.95, top(cp.x - 1.7) + 0.02, 0], tag: 'body' });
    else if (ex === 'blade') {
      b.add(b.box(0.12, 0.22, 0.02), metalM, { pos: [-1.2, top(-1.2) + 0.1, 0], rot: [0, 0, -0.3], tag: 'body' });
      b.add(b.box(0.12, 0.2, 0.02), metalM, { pos: [0.8, bot(0.8) - 0.08, 0], rot: [0, 0, 0.3], tag: 'body' });
    } else if (ex === 'tailcone') b.add(b.sphere(), darkM, { pos: [X0 - 0.12, sample(st, X0).cy, 0], scale: [0.35, 0.16, 0.16], tag: 'tail' });
    else if (ex === 'tips' || ex === 'bigtips') {
      const big = ex === 'bigtips';
      const L = big ? 1.5 : 0.9, R = big ? 0.1 : 0.05;
      for (const s of [1, -1]) {
        b.add(b.cylX(R, R, L, 10), darkM, { pos: [wingTipX, wy, s * (edges.zmax + R)], tag: 'wing' });
        b.add(b.cylX(0.001, R, 0.2, 10), accM, { pos: [wingTipX + L / 2 + 0.1, wy, s * (edges.zmax + R)], tag: 'wing' });
      }
    } else if (ex === 'probe') b.add(b.cylX(0.015, 0.015, 0.9, 8), metalM, { pos: [cp.x + cp.len / 2 + 0.55, yBase + 0.02, 0.2], tag: 'nose' });
    else if (ex === 'hook') b.add(b.box(0.7, 0.03, 0.05), metalM, { pos: [-3.5, bot(-3.5) - 0.12, 0], rot: [0, 0, 0.35], tag: 'tail' });
    else if (ex === 'speedbrake') {
      const y = top(-2.0) + 0.006;
      const sp: number[] = [];
      const a = -2.2, d = -1.7, w = Math.min(0.24, sample(st, -2.0).w * 0.5);
      sp.push(a, y, -w, d, y, -w, d, y, -w, d, y, w, d, y, w, a, y, w, a, y, w, a, y, -w);
      b.add(b.segments(sp), hingeM, { lines: true, tag: 'body' });
    } else if (ex === 'camera') b.add(b.sphere(), darkM, { pos: [0.4, bot(0.4) - 0.02, 0], scale: [0.28, 0.12, 0.2], tag: 'body' });
    else if (ex === 'gun') b.add(b.cylX(0.05, 0.05, 0.9, 8), metalM, { pos: [X1 - 0.9, sample(st, 3.4).cy - 0.1, 0.0], tag: 'nose' });
    else if (ex === 'pivot') {
      for (const s of [1, -1]) b.add(b.cylX(0.14, 0.14, 0.04, 14), metalM, { pos: [0.6, wy + c.wing.th / 2 + 0.012, s * 0.75], rot: [0, 0, Math.PI / 2], tag: 'wing' });
    }
  }

  // Anchors for the encyclopedia part labels (fictional game-part names).
  const wz = edges.z0 + (edges.zmax - edges.z0) * 0.6;
  const anchors: Anchor[] = [
    { key: 'nose', label: '機鼻感測罩', en: 'NOSE SENSOR', pos: [X1 - 0.35, sample(st, X1 - 0.35).cy, 0] },
    { key: 'cockpit', label: '座艙', en: 'COCKPIT', pos: [cp.x, yBase + cp.h * 0.9, 0] },
    { key: 'wing', label: '主翼', en: 'MAIN WING', pos: [(polyAtZ(edges.le, wz) + polyAtZ(edges.te, wz)) / 2, wy, wz] },
    { key: 'tail', label: '垂直尾翼', en: 'TAIL FIN', pos: tailTop },
    { key: 'engine', label: '噴口', en: 'NOZZLE', pos: engineAnchor },
  ];
  if (firstIntake) anchors.splice(2, 0, { key: 'intake', label: '進氣口', en: 'INTAKE', pos: firstIntake });
  if (c.pylons.length) {
    const p = c.pylons[0];
    anchors.push({ key: 'pylon', label: '掛架', en: 'PYLON', pos: [p.x, (p.y ?? wy - c.wing.th / 2) - 0.2, p.z] });
  }
  anchors.forEach((a) => b.anchor(a.key, a.label, a.en, a.pos));
  return b.build();
}

export interface AircraftModelHints {
  /** Whether the aircraft has an afterburner (from its data); defaults to the design table. */
  hasAfterburner?: boolean;
  /** Rated thrust in kN, used only to scale nozzle size slightly. */
  thrustKN?: number;
}

function kitFor(id: number, hints: AircraftModelHints): ModelKit {
  const cfg = CFG[((id % CFG.length) + CFG.length) % CFG.length];
  const ab = hints.hasAfterburner ?? cfg.ab;
  const scale = hints.thrustKN && hints.thrustKN > 0 ? clamp(Math.sqrt(hints.thrustKN / 200), 0.85, 1.2) : 1;
  const key = `${id}|${ab ? 1 : 0}|${scale.toFixed(2)}`;
  let kit = kitCache.get(key);
  if (!kit) {
    kit = buildKit(id, ab, scale);
    kitCache.set(key, kit);
  }
  return kit;
}

/** Deterministic: the same id (and hints) always produce the same geometry. Shared buffers. */
export function buildAircraftModel(id: number, hints: AircraftModelHints = {}): THREE.Group {
  return instantiate(kitFor(id, hints));
}

export function aircraftAnchors(id: number, hints: AircraftModelHints = {}): Anchor[] {
  return kitFor(id, hints).anchors;
}
