import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PHYSICS_DT, WASM_API_VERSION } from '../src/core/config';
import { buildTestScene } from '../src/rendering/scene';
import { CRASH_BUILDING, CRASH_GROUND, IMPACT_CLEAR, STATE_LEN, decodeSnapshot } from '../src/physics/stateLayout';

const wasmPath = fileURLToPath(new URL('../public/wasm/physics_engine.wasm', import.meta.url));

interface Exports {
  memory: WebAssembly.Memory;
  sim_api_version(): number;
  sim_init(id: number): number;
  sim_reset(): void;
  sim_set_controls(t: number, p: number, r: number, y: number): void;
  sim_step(dt: number): void;
  sim_snapshot(): number;
  sim_snapshot_len(): number;
  sim_scene_alloc(floats: number): number;
  sim_scene_commit(count: number): number;
}

async function load(): Promise<Exports> {
  // Copy into a plain Uint8Array so the BufferSource typing holds across @types/node versions.
  const module = await WebAssembly.compile(new Uint8Array(readFileSync(wasmPath)));
  const instance = await WebAssembly.instantiate(module, {});
  return instance.exports as unknown as Exports;
}

function snapshot(w: Exports) {
  return decodeSnapshot(new Float64Array(w.memory.buffer, w.sim_snapshot(), w.sim_snapshot_len()).slice());
}

// Built by `npm run build:wasm` (always present in CI). Skipped locally if you have not built it.
describe.skipIf(!existsSync(wasmPath))('physics WASM module', () => {
  it('exposes the expected ABI', async () => {
    const w = await load();
    expect(w.sim_api_version()).toBe(WASM_API_VERSION);
    expect(w.sim_snapshot_len()).toBe(STATE_LEN);
    expect(w.sim_init(0)).toBe(1);
    expect(w.sim_init(999)).toBe(0);
  });

  it('advances simulated time by exactly dt per step', async () => {
    const w = await load();
    w.sim_init(0);
    for (let i = 0; i < 30; i++) w.sim_step(PHYSICS_DT);
    expect(snapshot(w).time).toBeCloseTo(1, 9);
  });

  it('is deterministic across instances', async () => {
    const run = async () => {
      const w = await load();
      w.sim_init(0);
      for (let i = 0; i < 300; i++) {
        w.sim_set_controls(0.6, Math.sin(i * 0.1), 0.3, 0);
        w.sim_step(PHYSICS_DT);
      }
      return snapshot(w);
    };
    expect(await run()).toEqual(await run());
  });

  it('stick back raises the nose, roll-right drops the right wing', async () => {
    const w = await load();
    w.sim_init(0);
    w.sim_set_controls(0.5, 1, 0, 0);
    for (let i = 0; i < 15; i++) w.sim_step(PHYSICS_DT);
    expect(snapshot(w).angularVelocity[2]).toBeGreaterThan(0);
    w.sim_reset();
    w.sim_set_controls(0.5, 0, 1, 0);
    for (let i = 0; i < 15; i++) w.sim_step(PHYSICS_DT);
    expect(snapshot(w).angularVelocity[0]).toBeGreaterThan(0);
  });

  it('a building straight ahead is solid: the flight ends against it, not inside it', async () => {
    const w = await load();
    w.sim_init(0);
    const wall = new Float32Array([0, -1000, 400, 3000]); // x, z, width, height: south face at z = -800
    const ptr = w.sim_scene_alloc(wall.length);
    new Float32Array(w.memory.buffer, ptr, wall.length).set(wall);
    expect(w.sim_scene_commit(1)).toBe(1);
    w.sim_reset();
    const before = snapshot(w);
    expect(before.impactTime).toBeLessThan(6); // warning is already counting down
    for (let i = 0; i < 30 * 12 && !snapshot(w).crashed; i++) w.sim_step(PHYSICS_DT);
    const after = snapshot(w);
    expect(after.crashed).toBe(true);
    expect(after.crashKind).toBe(CRASH_BUILDING);
    expect(after.position[2]).toBeGreaterThan(-800);
    expect(after.crashTime).toBeGreaterThan(2);
  });

  it('the uploaded scene survives sim_init and reset; an empty flight path reports no impact', async () => {
    const w = await load();
    w.sim_init(0);
    const scene = buildTestScene();
    const ptr = w.sim_scene_alloc(scene.instances.length);
    new Float32Array(w.memory.buffer, ptr, scene.instances.length).set(scene.instances);
    expect(w.sim_scene_commit(scene.instanceCount)).toBe(scene.instanceCount);
    w.sim_init(0);
    w.sim_reset();
    // start (2 km, level, heading north) is above every building: clear path for the look-ahead window
    expect(snapshot(w).impactTime).toBe(IMPACT_CLEAR);
    expect(snapshot(w).crashed).toBe(false);
  });

  it('ground contact is reported as a ground crash', async () => {
    const w = await load();
    w.sim_init(0);
    w.sim_set_controls(0, -1, 0, 0); // full forward stick, no thrust: dive
    let crashed = false;
    for (let i = 0; i < 30 * 120 && !crashed; i++) {
      w.sim_step(PHYSICS_DT);
      crashed = snapshot(w).crashed;
    }
    expect(crashed).toBe(true);
    expect(snapshot(w).crashKind).toBe(CRASH_GROUND);
  });

  it('reset restores the initial condition', async () => {
    const w = await load();
    w.sim_init(0);
    const start = snapshot(w);
    for (let i = 0; i < 100; i++) w.sim_step(PHYSICS_DT);
    w.sim_reset();
    expect(snapshot(w)).toEqual(start);
  });
});
