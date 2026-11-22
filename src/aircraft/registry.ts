import type { Vec3 } from '../core/math';
import { degToRad } from '../core/math';

/**
 * Render/cockpit-side description of an aircraft. Flight-dynamics parameters live in Rust
 * (wasm/physics-engine/src/aircraft.rs); `id` is the shared key between the two.
 */
export interface AircraftDefinition {
  id: number;
  key: string;
  displayName: string;
  /** Pilot eye position in the body frame (x forward, y up, z right), metres from the CG. */
  eyeOffset: Vec3;
  /** Vertical field of view of the cockpit camera, radians. */
  fovY: number;
  /** Must equal `start_throttle` in the Rust parameter set (used to re-sync input on reset). */
  startThrottle: number;
}

export const AIRCRAFT: readonly AircraftDefinition[] = [
  {
    id: 0,
    key: 'generic-fighter',
    displayName: 'Generic Light Fighter',
    eyeOffset: [3.8, 1.0, 0],
    fovY: degToRad(70),
    startThrottle: 0.3,
  },
];

export function getAircraft(id: number): AircraftDefinition {
  const def = AIRCRAFT.find((a) => a.id === id);
  if (!def) throw new Error(`Unknown aircraft id ${id}`);
  return def;
}
