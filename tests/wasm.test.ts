import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PHYSICS_DT, WASM_API_VERSION } from '../src/core/config';
import { STATE_LEN, decodeSnapshot } from '../src/physics/stateLayout';

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

  it('reset restores the initial condition', async () => {
    const w = await load();
    w.sim_init(0);
    const start = snapshot(w);
    for (let i = 0; i < 100; i++) w.sim_step(PHYSICS_DT);
    w.sim_reset();
    expect(snapshot(w)).toEqual(start);
  });
});
