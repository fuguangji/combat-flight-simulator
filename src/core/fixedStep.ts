/**
 * Fixed-timestep accumulator.
 *
 * `advance(elapsed, step)` runs `step()` once per `dt` of accumulated time, but never more than
 * `maxSteps` times per call. If the host falls further behind than that the surplus time is
 * dropped (the simulation slows down instead of freezing in an ever-growing catch-up loop).
 */
export class FixedStepper {
  private acc = 0;
  /** Total number of steps executed. */
  steps = 0;
  /** Number of times time had to be dropped because of overload. */
  dropEvents = 0;

  constructor(
    readonly dt: number,
    readonly maxSteps = 5,
    readonly maxElapsed = 0.25,
  ) {
    if (!(dt > 0)) throw new RangeError('dt must be > 0');
  }

  advance(elapsedSeconds: number, step: () => void): number {
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) return 0;
    this.acc += Math.min(elapsedSeconds, this.maxElapsed);
    let n = 0;
    while (this.acc >= this.dt && n < this.maxSteps) {
      step();
      this.acc -= this.dt;
      n++;
    }
    if (this.acc >= this.dt) {
      this.acc = 0;
      this.dropEvents++;
    }
    this.steps += n;
    return n;
  }

  reset(): void {
    this.acc = 0;
  }

  /** Fraction (0..1) of the next step already accumulated. */
  get alpha(): number {
    return this.acc / this.dt;
  }
}
