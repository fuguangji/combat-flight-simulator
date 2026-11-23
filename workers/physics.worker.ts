/// Physics worker: owns the WASM instance and the fixed 30 Hz clock.
/// Posts one snapshot (Float64Array buffer, transferred) per physics step.
import { MAX_STEPS_PER_TICK, MAX_TICK_SECONDS, PHYSICS_DT, WASM_API_VERSION } from '../src/core/config';
import { FixedStepper } from '../src/core/fixedStep';
import { buildTestScene } from '../src/rendering/scene';
import type { WorkerIn, WorkerOut } from '../src/physics/PhysicsClient';

interface PhysicsExports {
  memory: WebAssembly.Memory;
  sim_api_version(): number;
  sim_param_alloc(len: number): number;
  sim_aircraft_commit(len: number): number;
  sim_reset(): void;
  sim_set_controls(throttle: number, pitch: number, roll: number, yaw: number): void;
  sim_step(dt: number): void;
  sim_snapshot(): number;
  sim_snapshot_len(): number;
  sim_scene_alloc(floats: number): number;
  sim_scene_commit(count: number): number;
}

const ctx = self as unknown as {
  postMessage(message: WorkerOut, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<WorkerIn>) => void) | null;
};

let wasm: PhysicsExports | null = null;
let paused = false;
let lastTick = 0;
const stepper = new FixedStepper(PHYSICS_DT, MAX_STEPS_PER_TICK, MAX_TICK_SECONDS);

/**
 * Upload the same obstacle field the renderers draw (buildTestScene is deterministic), so every
 * visible building is solid. Must run before the first snapshot.
 */
function uploadScene(exports: PhysicsExports): void {
  const scene = buildTestScene();
  const ptr = exports.sim_scene_alloc(scene.instances.length);
  // Re-create the view after the call: the allocation may have grown linear memory.
  new Float32Array(exports.memory.buffer, ptr, scene.instances.length).set(scene.instances);
  const accepted = exports.sim_scene_commit(scene.instanceCount);
  if (accepted !== scene.instanceCount) throw new Error(`Collision world accepted ${accepted} of ${scene.instanceCount} buildings`);
}

/** Install an aircraft from its flat parameter array; the collision scene is kept. */
function defineAircraft(exports: PhysicsExports, params: ArrayLike<number>): void {
  const ptr = exports.sim_param_alloc(params.length);
  // Re-create the view after the call: the allocation may have grown linear memory.
  new Float64Array(exports.memory.buffer, ptr, params.length).set(params);
  if (exports.sim_aircraft_commit(params.length) !== 1) throw new Error('The physics engine rejected the aircraft parameters');
}

function postSnapshot(): void {
  if (!wasm) return;
  const ptr = wasm.sim_snapshot();
  const len = wasm.sim_snapshot_len();
  // Re-create the view every time: linear memory may have been re-allocated.
  const copy = new Float64Array(wasm.memory.buffer, ptr, len).slice();
  ctx.postMessage({ type: 'snapshot', data: copy.buffer }, [copy.buffer]);
}

function tick(): void {
  const now = performance.now();
  const elapsed = (now - lastTick) / 1000;
  lastTick = now;
  if (!wasm || paused) return;
  stepper.advance(elapsed, () => {
    wasm!.sim_step(PHYSICS_DT);
    postSnapshot();
  });
}

async function init(wasmUrl: string, params: ArrayLike<number>): Promise<void> {
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error(`Could not load ${wasmUrl} (HTTP ${response.status})`);
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {});
  const exports = instance.exports as unknown as PhysicsExports;
  if (exports.sim_api_version() !== WASM_API_VERSION) {
    throw new Error(`WASM API version ${exports.sim_api_version()} != expected ${WASM_API_VERSION}`);
  }
  uploadScene(exports); // the scene first: defining the aircraft keeps it
  defineAircraft(exports, params);
  wasm = exports;
  lastTick = performance.now();
  postSnapshot();
  ctx.postMessage({ type: 'ready', apiVersion: exports.sim_api_version() });
  // A short poll keeps timing error well below one 33 ms step.
  setInterval(tick, 5);
}

ctx.onmessage = (e) => {
  const m = e.data;
  switch (m.type) {
    case 'init':
      init(m.wasmUrl, m.params).catch((err: unknown) =>
        ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) }),
      );
      break;
    case 'aircraft':
      if (wasm) {
        try {
          defineAircraft(wasm, m.params);
          stepper.reset();
          postSnapshot();
        } catch (err) {
          ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
        }
      }
      break;
    case 'controls':
      wasm?.sim_set_controls(m.c[0], m.c[1], m.c[2], m.c[3]);
      break;
    case 'reset':
      wasm?.sim_reset();
      stepper.reset();
      postSnapshot();
      break;
    case 'pause':
      paused = true;
      break;
    case 'resume':
      paused = false;
      lastTick = performance.now();
      stepper.reset();
      postSnapshot();
      break;
  }
};
