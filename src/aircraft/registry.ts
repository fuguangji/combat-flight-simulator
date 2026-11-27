import type { Vec3 } from '../core/math';
import { degToRad } from '../core/math';
import physicsKeys from './physics-keys.json';

/**
 * Aircraft are data: one JSON file per type in `./data/`. Adding an aircraft means dropping a new
 * file there (unique `id` and `key`); the registry picks it up, the menu lists it, and the physics
 * worker receives its parameters as a flat array (see `AircraftDefinition.toPhysicsArray`).
 *
 * The scalar physics keys and their order live in `physics-keys.json` and are mirrored by
 * `PARAM_NAMES` in wasm/physics-engine/src/aircraft.rs (a Rust test keeps both in sync).
 */
export const PHYSICS_KEYS: readonly string[] = physicsKeys;
export const MAX_HULL_POINTS = 32;

/** Shape of one aircraft JSON file. Physics thrust values are N; specs.thrustKN is display-only kN. */
export interface AircraftJson {
  id: number;
  key: string;
  displayName: string;
  description: string;
  cockpit: { eyeOffset: [number, number, number]; fovDeg: number };
  physics: Record<string, number | number[][]>;
  role?: string;
  features?: string;
  specs?: { emptyMassKg: number; mtowKg: number; payloadKg: number; fuelKg: number; cruiseBurnKgMin: number; boostBurnKgMin: number; maxMach: number; gPositive: number; gNegative: number; thrustKN: number; ceilingM: number; rangeKm: number };
}

export class AircraftDataError extends Error {
  constructor(
    readonly source: string,
    readonly problems: string[],
  ) {
    super(`Invalid aircraft data (${source}):\n - ${problems.join('\n - ')}`);
    this.name = 'AircraftDataError';
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Render / cockpit-side view of an aircraft plus its flight-dynamics parameters. */
export class AircraftDefinition {
  readonly id: number;
  readonly key: string;
  readonly displayName: string;
  readonly description: string;
  readonly role: string;
  readonly features: string;
  readonly specs: NonNullable<AircraftJson['specs']>;
  /** Pilot eye position in the body frame (x forward, y up, z right), metres from the CG. */
  readonly eyeOffset: Vec3;
  /** Vertical field of view of the cockpit camera, radians. */
  readonly fovY: number;
  /** Equals `start_throttle` in the physics block (used to re-sync input on reset). */
  readonly startThrottle: number;
  readonly startAltitude: number; // m
  readonly startSpeed: number; // m/s
  readonly startAlpha: number; // rad
  readonly fuelCapacity: number; // kg
  readonly gLimit: number;
  readonly maxMach: number;
  readonly hasAfterburner: boolean;
  private readonly scalars: readonly number[];
  private readonly hull: readonly number[];

  private constructor(json: AircraftJson) {
    const p = json.physics;
    this.id = json.id;
    this.key = json.key;
    this.displayName = json.displayName;
    this.description = json.description;
    this.role = json.role ?? '多用途航空器';
    this.features = json.features ?? '';
    this.specs = json.specs ?? { emptyMassKg: p.empty_mass as number, mtowKg: p.empty_mass as number, payloadKg: 0, fuelKg: p.fuel_capacity as number, cruiseBurnKgMin: 0, boostBurnKgMin: 0, maxMach: p.max_mach as number, gPositive: p.g_limit_pos as number, gNegative: p.g_limit_neg as number, thrustKN: (p.max_thrust_sl as number) / 1000, ceilingM: 0, rangeKm: 0 };
    this.eyeOffset = [...json.cockpit.eyeOffset];
    this.fovY = degToRad(json.cockpit.fovDeg);
    this.scalars = PHYSICS_KEYS.map((k) => p[k] as number);
    this.hull = (p.hull as number[][]).flat();
    const get = (k: string): number => p[k] as number;
    this.startThrottle = get('start_throttle');
    this.startAltitude = get('start_altitude');
    this.startSpeed = get('start_speed');
    this.startAlpha = get('start_alpha');
    this.fuelCapacity = get('fuel_capacity');
    this.gLimit = get('g_limit_pos');
    this.maxMach = get('max_mach');
    this.hasAfterburner = get('ab_thrust_sl') > get('max_thrust_sl') * 1.001;
  }

  /** Validate untrusted JSON; throws `AircraftDataError` listing every problem found. */
  static fromJson(raw: unknown, source = 'aircraft json'): AircraftDefinition {
    const problems: string[] = [];
    const o = (raw ?? {}) as Partial<AircraftJson>;
    if (typeof raw !== 'object' || raw === null) throw new AircraftDataError(source, ['not an object']);
    if (!Number.isInteger(o.id) || (o.id as number) < 0) problems.push('id must be a non-negative integer');
    if (typeof o.key !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(o.key)) problems.push('key must be kebab-case text');
    if (typeof o.displayName !== 'string' || o.displayName.length === 0) problems.push('displayName is required');
    if (typeof o.description !== 'string') problems.push('description must be text');
    const c = o.cockpit;
    if (!c || !Array.isArray(c.eyeOffset) || c.eyeOffset.length !== 3 || !c.eyeOffset.every(isNum)) {
      problems.push('cockpit.eyeOffset must be [x, y, z]');
    }
    if (!c || !isNum(c.fovDeg) || c.fovDeg < 30 || c.fovDeg > 120) problems.push('cockpit.fovDeg must be 30..120');
    const p = o.physics;
    if (!p || typeof p !== 'object') {
      problems.push('physics block missing');
    } else {
      for (const k of PHYSICS_KEYS) if (!isNum(p[k])) problems.push(`physics.${k} must be a finite number`);
      const known = new Set([...PHYSICS_KEYS, 'hull']);
      for (const k of Object.keys(p)) if (!known.has(k)) problems.push(`physics.${k} is not a known parameter`);
      const h = p.hull;
      const okHull =
        Array.isArray(h) && h.length >= 1 && h.length <= MAX_HULL_POINTS &&
        h.every((pt) => Array.isArray(pt) && pt.length === 3 && pt.every(isNum));
      if (!okHull) problems.push(`physics.hull must be 1..${MAX_HULL_POINTS} points of [x, y, z]`);
    }
    if (problems.length > 0) throw new AircraftDataError(source, problems);
    return new AircraftDefinition(o as AircraftJson);
  }

  /** Flat array for the WASM `sim_param_alloc` / `sim_aircraft_commit` pair. */
  toPhysicsArray(): Float64Array {
    return Float64Array.from([...this.scalars, ...this.hull]);
  }
}

export class AircraftRegistry {
  private readonly byId = new Map<number, AircraftDefinition>();
  private readonly byKey = new Map<string, AircraftDefinition>();

  register(def: AircraftDefinition): this {
    if (this.byId.has(def.id)) throw new Error(`Duplicate aircraft id ${def.id} (${def.key})`);
    if (this.byKey.has(def.key)) throw new Error(`Duplicate aircraft key ${def.key}`);
    this.byId.set(def.id, def);
    this.byKey.set(def.key, def);
    return this;
  }

  get(id: number): AircraftDefinition {
    const def = this.byId.get(id);
    if (!def) throw new Error(`Unknown aircraft id ${id}`);
    return def;
  }

  find(key: string): AircraftDefinition | undefined {
    return this.byKey.get(key);
  }

  /** All aircraft sorted by id. */
  list(): AircraftDefinition[] {
    return [...this.byId.values()].sort((a, b) => a.id - b.id);
  }

  /** The aircraft selected when nothing else is chosen: the lowest id. */
  get default(): AircraftDefinition {
    const first = this.list()[0];
    if (!first) throw new Error('No aircraft registered');
    return first;
  }

  /** Build a registry from `{ path: parsed json }` (the shape `import.meta.glob(..., { eager: true })` returns). */
  static fromModules(modules: Record<string, unknown>): AircraftRegistry {
    const reg = new AircraftRegistry();
    for (const [path, json] of Object.entries(modules)) reg.register(AircraftDefinition.fromJson(json, path));
    return reg;
  }
}

export const aircraftRegistry = AircraftRegistry.fromModules(
  import.meta.glob('./data/*.json', { eager: true, import: 'default' }),
);

export const AIRCRAFT: readonly AircraftDefinition[] = aircraftRegistry.list();

export function getAircraft(id: number): AircraftDefinition {
  return aircraftRegistry.get(id);
}
