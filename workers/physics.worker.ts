/// Physics worker: owns the WASM instance and the fixed 30 Hz clock.
/// Posts one snapshot (Float64Array buffer, transferred) per physics step.
import { MAX_STEPS_PER_TICK, MAX_TICK_SECONDS, PHYSICS_DT, WASM_API_VERSION } from '../src/core/config';
import { FixedStepper } from '../src/core/fixedStep';
import type { WorkerIn, WorkerOut } from '../src/physics/PhysicsClient';

interface PhysicsExports {
  memory: WebAssembly.Memory;
  sim_api_version(): number;
  sim_init(aircraftId: number): number;
  sim_reset(): void;
  sim_set_controls(throttle: number, pitch: number, roll: number, yaw: number): void;
  sim_step(dt: number): void;
  sim_snapshot(): number;
  sim_snapshot_len(): number;
}

const ctx = self as unknown as {
  postMessage(message: WorkerOut, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<WorkerIn>) => void) | null;
};

let wasm: PhysicsExports | null = null;
let paused = false;
let lastTick = 0;
const stepper = new FixedStepper(PHYSICS_DT, MAX_STEPS_PER_TICK, MAX_TICK_SECONDS);

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

async function init(wasmUrl: string, aircraftId: number): Promise<void> {
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error(`Could not load ${wasmUrl} (HTTP ${response.status})`);
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {});
  const exports = instance.exports as unknown as PhysicsExports;
  if (exports.sim_api_version() !== WASM_API_VERSION) {
    throw new Error(`WASM API version ${exports.sim_api_version()} != expected ${WASM_API_VERSION}`);
  }
  if (exports.sim_init(aircraftId) !== 1) throw new Error(`Unknown aircraft id ${aircraftId}`);
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
      init(m.wasmUrl, m.aircraftId).catch((err: unknown) =>
        ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) }),
      );
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
