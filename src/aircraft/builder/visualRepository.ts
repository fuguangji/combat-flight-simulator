import {
  createModularAircraft,
  createProceduralAircraftConfig,
  normalizeAircraftVisualConfig,
  type AircraftVisualConfig,
  type AircraftVisualInput,
} from './modularAircraft';
import * as THREE from 'three';

/** The editor's exported V2 JSON is the canonical visual asset format. */
const visualModules: Record<string, unknown> = import.meta.glob('../visuals/*.json', {
  eager: true,
  import: 'default',
});

export interface AircraftVisualLoadResult {
  config: AircraftVisualConfig;
  model: THREE.Group;
  source: string;
  migratedFromLegacy: boolean;
}

/** Read and normalize the exact visual asset used by the editor and all game views. */
export function loadAircraftVisualConfig(key: string): AircraftVisualConfig | null {
  const path = Object.keys(visualModules).find((candidate) => candidate.endsWith(`/${key}.json`));
  if (!path) return null;
  return normalizeAircraftVisualConfig(visualModules[path] as AircraftVisualInput);
}

/** Shared model factory: hangar, encyclopedia, cockpit adapter and runtime use one parser. */
export function loadAircraftVisual(key: string, id: number): AircraftVisualLoadResult {
  const path = Object.keys(visualModules).find((candidate) => candidate.endsWith(`/${key}.json`));
  const raw = path ? visualModules[path] as AircraftVisualInput : createProceduralAircraftConfig(id);
  const config = normalizeAircraftVisualConfig(raw);
  const model = createModularAircraft(config);
  model.scale.setScalar(1.05);
  model.userData.aircraftKey = key;
  model.userData.visualSource = path ?? 'procedural-fallback';
  model.userData.visualSchemaVersion = config.version;
  model.userData.visualMigratedFromLegacy = raw.version === 1;
  return { config, model, source: path ?? 'procedural-fallback', migratedFromLegacy: raw.version === 1 };
}
