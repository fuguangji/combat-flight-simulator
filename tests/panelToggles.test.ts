import { describe, expect, it } from 'vitest';
import { PANELS, parsePanelState } from '../src/ui/panelToggles';

describe('parsePanelState', () => {
  it('defaults to everything hidden', () => {
    expect(parsePanelState(null)).toEqual({ map: false, nav: false, radar: false });
    expect(parsePanelState('not json')).toEqual({ map: false, nav: false, radar: false });
  });
  it('reads stored flags and ignores junk values', () => {
    expect(parsePanelState('{"map":true,"nav":"yes","radar":true,"x":1}')).toEqual({ map: true, nav: false, radar: true });
  });
  it('has unique shortcut keys that do not clash with flight controls', () => {
    const codes = PANELS.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'KeyR', 'KeyN', 'KeyP', 'KeyF']) expect(codes).not.toContain(c);
  });
});
