import { INTERP_DELAY_MS, MAX_EXTRAPOLATION_MS } from '../core/config';
import type { Quat, Vec3 } from '../core/math';
import { SnapshotBuffer } from './snapshotBuffer';
import { decodeSnapshot, type AircraftSnapshot } from './stateLayout';

export interface PhysicsInitialState {
  position: Vec3;
  velocity: Vec3;
  orientation: Quat;
}

export interface ControlInput {
  throttle: number; // 0..1
  pitch: number; // -1..1, +1 = stick back (nose up)
  roll: number; // -1..1, +1 = right
  yaw: number; // -1..1, +1 = right rudder
}

export type WorkerIn =
  | { type: 'init'; wasmUrl: string; params: number[]; initialState?: PhysicsInitialState }
  | { type: 'aircraft'; params: number[] }
  | { type: 'controls'; c: [number, number, number, number] }
  | { type: 'reset' }
  | { type: 'pause' }
  | { type: 'resume' };

export type WorkerOut =
  | { type: 'ready'; apiVersion: number }
  | { type: 'snapshot'; data: ArrayBuffer }
  | { type: 'error'; message: string };

/** Main-thread handle to the physics worker. Owns the interpolation buffer. */
export class PhysicsClient {
  private readonly worker: Worker;
  private readonly buffer = new SnapshotBuffer(INTERP_DELAY_MS, { smooth: true, maxExtrapolationMs: MAX_EXTRAPOLATION_MS });
  private rateWindowStart = performance.now();
  private rateCount = 0;
  /** Snapshots per second actually received (should read ~30). */
  measuredHz = 0;
  lastError: string | null = null;

  constructor() {
    this.worker = new Worker(new URL('../../workers/physics.worker.ts', import.meta.url), { type: 'module' });
  }

  start(
    wasmUrl: string,
    params: ArrayLike<number>,
    options: { timeoutMs?: number; initialState?: PhysicsInitialState } = {},
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Physics worker timed out during startup')), options.timeoutMs ?? 10_000);
      this.worker.onerror = (e) => {
        clearTimeout(timer);
        reject(new Error(`Physics worker crashed: ${e.message}`));
      };
      this.worker.onmessage = (e: MessageEvent<WorkerOut>) => {
        const m = e.data;
        if (m.type === 'ready') {
          clearTimeout(timer);
          this.worker.onmessage = (ev: MessageEvent<WorkerOut>) => this.onMessage(ev.data);
          resolve();
        } else if (m.type === 'error') {
          clearTimeout(timer);
          reject(new Error(m.message));
        } else {
          this.onMessage(m); // initial snapshot is posted just before 'ready'
        }
      };
      this.post({ type: 'init', wasmUrl, params: Array.from(params), initialState: options.initialState });
    });
  }

  private onMessage(m: WorkerOut): void {
    if (m.type === 'snapshot') {
      const now = performance.now();
      this.buffer.push(decodeSnapshot(new Float64Array(m.data)), now);
      this.rateCount++;
      if (now - this.rateWindowStart >= 1000) {
        this.measuredHz = (this.rateCount * 1000) / (now - this.rateWindowStart);
        this.rateCount = 0;
        this.rateWindowStart = now;
      }
    } else if (m.type === 'error') {
      this.lastError = m.message;
    }
  }

  private post(m: WorkerIn): void {
    this.worker.postMessage(m);
  }

  /** Switch to another aircraft (flat parameter array); the simulation restarts from its start state. */
  setAircraft(params: ArrayLike<number>): void {
    this.buffer.clear();
    this.post({ type: 'aircraft', params: Array.from(params) });
  }

  setControls(c: ControlInput): void {
    this.post({ type: 'controls', c: [c.throttle, c.pitch, c.roll, c.yaw] });
  }

  reset(): void {
    this.post({ type: 'reset' });
  }

  pause(): void {
    this.post({ type: 'pause' });
  }

  resume(): void {
    this.buffer.clear(); // wall clock jumped while paused; re-estimate the clock offset
    this.post({ type: 'resume' });
  }

  /** Interpolated state for rendering at wall-clock time `nowMs` (performance.now()). */
  sample(nowMs: number): AircraftSnapshot | null {
    return this.buffer.sample(nowMs);
  }

  dispose(): void {
    this.worker.terminate();
  }
}
