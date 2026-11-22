import { interpolateSnapshots, type AircraftSnapshot } from './stateLayout';

/**
 * Receives physics snapshots (30 Hz, stamped with simulated time) and lets the renderer sample a
 * smooth state at any wall-clock instant (60+ Hz).
 *
 * Clock mapping: offset = arrival_ms - sim_time_ms is estimated as a running minimum (the
 * lowest-latency delivery) that drifts slowly upward, so jitter in message arrival does not leak
 * into the picture. The renderer then samples at `now - offset - delay`, i.e. slightly in the
 * past, where two bracketing snapshots are guaranteed to exist.
 */
export class SnapshotBuffer {
  private snaps: AircraftSnapshot[] = [];
  private offsetMs = Number.NaN;

  constructor(
    private readonly delayMs: number,
    private readonly capacity = 16,
  ) {}

  get length(): number {
    return this.snaps.length;
  }

  get latest(): AircraftSnapshot | null {
    return this.snaps[this.snaps.length - 1] ?? null;
  }

  push(s: AircraftSnapshot, arrivalMs: number): void {
    const last = this.latest;
    if (last && s.time < last.time) this.clear(); // simulation was reset
    const candidate = arrivalMs - s.time * 1000;
    if (Number.isNaN(this.offsetMs) || candidate < this.offsetMs) this.offsetMs = candidate;
    else this.offsetMs += (candidate - this.offsetMs) * 0.01;
    this.snaps.push(s);
    if (this.snaps.length > this.capacity) this.snaps.shift();
  }

  clear(): void {
    this.snaps = [];
    this.offsetMs = Number.NaN;
  }

  /** State to render at wall-clock `nowMs` (same clock as `arrivalMs`). Holds the last state if starved. */
  sample(nowMs: number): AircraftSnapshot | null {
    const n = this.snaps.length;
    if (n === 0) return null;
    const rt = (nowMs - this.offsetMs - this.delayMs) / 1000;
    const first = this.snaps[0];
    const last = this.snaps[n - 1];
    if (rt <= first.time) return first;
    if (rt >= last.time) return last;
    for (let i = n - 2; i >= 0; i--) {
      const a = this.snaps[i];
      if (a.time <= rt) {
        const b = this.snaps[i + 1];
        const span = b.time - a.time;
        return interpolateSnapshots(a, b, span > 0 ? (rt - a.time) / span : 1);
      }
    }
    return first;
  }
}
