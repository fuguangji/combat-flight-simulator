import { describe, expect, it } from 'vitest';
import { validateEditorImportPayload } from '../src/editor/exportValidation';
import { createProceduralAircraftConfig } from '../src/aircraft/builder/modularAircraft';

const aircraftModules = import.meta.glob('../src/aircraft/data/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, { key: string } & Record<string, unknown>>;

describe('editor JSON export validation', () => {
  it('accepts complete aircraft JSON with the visual model nested under visual', () => {
    const source = Object.values(aircraftModules).find((aircraft) => aircraft.key === 'apollo-castle-37');
    expect(source).toBeDefined();
    const visual = createProceduralAircraftConfig(15);
    const exportPayload = { ...source!, visual: { ...visual, aircraftKey: 'apollo-castle-37' } };

    expect(() => validateEditorImportPayload(JSON.parse(JSON.stringify(exportPayload)))).not.toThrow();
  });

  it('accepts standalone editor V2 visual JSON', () => {
    const visual = {
      version: 2,
      name: 'Editor test',
      components: [{ id: 'aircraft-root', name: '飛機本體' }],
      parts: [{ id: 'fuselage', componentId: 'aircraft-root', shape: 'box', width: 2, height: 1, depth: 1 }],
    };
    expect(() => validateEditorImportPayload(JSON.parse(JSON.stringify(visual)))).not.toThrow();
  });

  it('rejects complete aircraft JSON when the nested visual payload is malformed', () => {
    const source = Object.values(aircraftModules).find((aircraft) => aircraft.key === 'apollo-castle-37');
    expect(source).toBeDefined();
    const malformed = { ...source!, visual: { version: 2, name: 'Broken', components: [], parts: [] } };

    expect(() => validateEditorImportPayload(malformed)).toThrow(/根組件|根組件|一個/);
  });

  it('rejects JSON that cannot be pasted into the editor', () => {
    expect(() => validateEditorImportPayload({ version: 2, components: [], parts: [] })).toThrow();
    expect(() => validateEditorImportPayload(null)).toThrow(/根節點/);
  });
});
