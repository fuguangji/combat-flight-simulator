export interface DynamicResolutionOptions {
  min?: number;
  max?: number;
  step?: number;
  /** Smoothed frame time (ms) above which the scale is lowered. */
  slowMs?: number;
  /** Smoothed frame time (ms) below which a scale increase is allowed (just above 60 Hz vsync). */
  fastMs?: number;
  /** Frames to wait after a change before changing again. */
  cooldownFrames?: number;
  /** Frames of stable performance before probing a higher scale. */
  probeFrames?: number;
}

/**
 * Adjusts the render-resolution scale to hold ~60 FPS.
 * Frame time is measured between requestAnimationFrame callbacks, so on a 60 Hz display a healthy
 * GPU reads ~16.7 ms; the controller lowers the scale when that rises, and periodically probes
 * upward again when frames are on time.
 */
export class DynamicResolution {
  scale: number;
  private ema = 16.7;
  private cooldown = 0;
  private stable = 0;
  private readonly o: Required<DynamicResolutionOptions>;

  constructor(options: DynamicResolutionOptions = {}) {
    this.o = {
      min: 0.5,
      max: 1,
      step: 0.05,
      slowMs: 19.5,
      fastMs: 17.4,
      cooldownFrames: 45,
      probeFrames: 240,
      ...options,
    };
    this.scale = this.o.max;
  }

  get smoothedFrameMs(): number {
    return this.ema;
  }

  update(frameMs: number): number {
    if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 250) return this.scale; // ignore stalls (tab switches)
    this.ema = this.ema * 0.9 + frameMs * 0.1;
    if (this.cooldown > 0) {
      this.cooldown--;
      return this.scale;
    }
    if (this.ema > this.o.slowMs && this.scale > this.o.min) {
      this.scale = Math.max(this.o.min, +(this.scale - this.o.step).toFixed(3));
      this.cooldown = this.o.cooldownFrames;
      this.stable = 0;
    } else if (this.ema < this.o.fastMs && this.scale < this.o.max) {
      if (++this.stable >= this.o.probeFrames) {
        this.scale = Math.min(this.o.max, +(this.scale + this.o.step).toFixed(3));
        this.cooldown = this.o.cooldownFrames;
        this.stable = 0;
      }
    } else {
      this.stable = 0;
    }
    return this.scale;
  }
}
