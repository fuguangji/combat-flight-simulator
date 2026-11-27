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
  const config = normalizeAircraftVisualConfig(visualModules[path] as AircraftVisualInput);
  if (config.aircraftKey && config.aircraftKey !== key) {
    throw new Error(`模型識別鍵不符：檔案屬於「${key}」，JSON 卻標示「${config.aircraftKey}」`);
  }
  return config;
}

/** Shared model factory: hangar, encyclopedia, cockpit adapter and runtime use one parser. */
export function loadAircraftVisual(key: string, id: number): AircraftVisualLoadResult {
  const path = Object.keys(visualModules).find((candidate) => candidate.endsWith(`/${key}.json`));
  const raw = path ? visualModules[path] as AircraftVisualInput : createProceduralAircraftConfig(id);
  const config = normalizeAircraftVisualConfig(raw);
  if (!path) {
    // Generated airframes are normalized to the same editable V2 component/part hierarchy.
    const stick = config.components.find((component) => component.id === 'component-cockpit-control-stick');
    if (stick) stick.animation = { channel: 'pitch', axis: 'z', min: -0.16, max: 0.16 };
    const canopy = config.components.find((component) => component.id === 'component-canopy');
    if (canopy) canopy.animation = { channel: 'canopy', axis: 'z', min: 0, max: 0.62 };
    const gear = config.components.find((component) => component.id === 'component-cockpit-gear-lever');
    if (gear) gear.animation = { channel: 'gear', axis: 'z', min: 0, max: -0.42 };
  }
  if (config.aircraftKey && config.aircraftKey !== key) {
    throw new Error(`模型識別鍵不符：檔案屬於「${key}」，JSON 卻標示「${config.aircraftKey}」`);
  }
  const model = createModularAircraft(config);
  model.scale.setScalar(1.05);
  model.userData.aircraftKey = key;
  model.userData.visualSource = path ?? 'procedural-fallback';
  model.userData.visualSchemaVersion = config.version;
  model.userData.visualMigratedFromLegacy = raw.version === 1;
  return { config, model, source: path ?? 'procedural-fallback', migratedFromLegacy: raw.version === 1 };
}
