import { AircraftDefinition, aircraftRegistry } from '../aircraft/registry';
import {
  createModularAircraft,
  normalizeAircraftVisualConfig,
  type AircraftVisualInput,
} from '../aircraft/builder/modularAircraft';
import { loadAircraftVisualConfig } from '../aircraft/builder/visualRepository';

const disposeModel = (model: ReturnType<typeof createModularAircraft>): void => {
  model.traverse((object) => {
    const mesh = object as import('three').Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose());
    else if (mesh.material) mesh.material.dispose();
  });
};

/**
 * Validate the exact JSON shape accepted by the editor's import action.
 * Full aircraft records are checked as aircraft records, then their nested
 * visual payload is normalized and built by the same runtime model factory.
 * Standalone visual JSON (V1/V2) follows the visual-only import path.
 */
export function validateEditorImportPayload(raw: unknown): void {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('JSON 根節點必須是物件');
  }

  const record = raw as Record<string, unknown>;
  let visualInput: AircraftVisualInput;

  if ('physics' in record && record.physics && 'key' in record) {
    const aircraft = AircraftDefinition.fromJson(raw, 'editor JSON validation');
    const registered = aircraftRegistry.find(aircraft.key);
    if (!registered || registered.id !== aircraft.id) {
      throw new Error(`機型 ${aircraft.key} 不存在於目前遊戲註冊表，或 ID 與註冊資料不符`);
    }

    const visual = aircraft.visual
      ? normalizeAircraftVisualConfig(aircraft.visual)
      : loadAircraftVisualConfig(aircraft.key);
    if (!visual) throw new Error(`機型 ${aircraft.key} 找不到可用的視覺模型`);
    if (visual.aircraftKey && visual.aircraftKey !== aircraft.key) {
      throw new Error(`視覺模型識別碼不符：機型為「${aircraft.key}」，模型卻標示「${visual.aircraftKey}」`);
    }
    visualInput = { ...visual, aircraftKey: aircraft.key };
  } else {
    visualInput = raw as AircraftVisualInput;
  }

  const normalized = normalizeAircraftVisualConfig(visualInput);
  const model = createModularAircraft(normalized);
  disposeModel(model);
}
