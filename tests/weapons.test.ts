import { describe, expect, it } from 'vitest';
import weaponCatalog from '../src/combat/weapons.json';

const expectedIds = [
  'nova17',
  'meteor88',
  'hellfire09',
  'vortex33',
  'stinger05',
  'thunder66',
  'gungnir01',
  'frostbite12',
  'ironhammer20',
  'phoenix54',
];

describe('original ten-item equipment catalog', () => {
  it('preserves all ten original entries in their intended order', () => {
    expect(weaponCatalog.map((item) => item.id)).toEqual(expectedIds);
    expect(new Set(weaponCatalog.map((item) => item.id)).size).toBe(10);
  });

  it('contains the game presentation fields required by loadout and HUD', () => {
    expect(weaponCatalog).toHaveLength(10);
    for (const item of weaponCatalog) {
      expect(item.name.length).toBeGreaterThan(0);
      expect(item.category.length).toBeGreaterThan(0);
      expect(item.role.length).toBeGreaterThan(0);
      expect(item.description.length).toBeGreaterThan(0);
      expect(item.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(item.capacity).toBeGreaterThan(0);
      expect(item.cooldown).toBeGreaterThan(0);
      expect(item.life).toBeGreaterThan(0);
    }
  });
});
