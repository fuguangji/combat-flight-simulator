import { describe, expect, it } from 'vitest';
import missileCatalog from '../src/combat/missiles.json';

describe('fictional missile catalog', () => {
  it('contains unique, complete game-only entries', () => {
    expect(missileCatalog).toHaveLength(6);
    expect(new Set(missileCatalog.map((item) => item.id)).size).toBe(missileCatalog.length);
    for (const item of missileCatalog) {
      expect(item.name.length).toBeGreaterThan(0);
      expect(item.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(item.capacity).toBeGreaterThan(0);
      expect(item.cooldown).toBeGreaterThan(0);
      expect(item.life).toBeGreaterThan(0);
      expect(typeof item.lockRequired).toBe('boolean');
      expect(['FOCUS_ARCADE', 'AREA_ARCADE']).toContain(item.gameMode);
      expect(item.gameplay).toContain('介面');
    }
  });

  it('includes both focus-gated and area-effect arcade types', () => {
    expect(missileCatalog.some((item) => item.lockRequired)).toBe(true);
    expect(missileCatalog.some((item) => !item.lockRequired)).toBe(true);
  });
});
