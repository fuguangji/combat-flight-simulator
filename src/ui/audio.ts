import type { WarningDef } from '../physics/warnings';

/**
 * Cockpit aural warnings (WebAudio oscillator tones, no assets). The AudioContext is created lazily
 * on the first call after a user gesture (the start button), as browsers require.
 * Pattern per tone: continuous = steady, fast = 4 Hz beeps, slow = 1.5 Hz beeps, chime = one short ping.
 */
export class WarningAudio {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private osc: OscillatorNode | null = null;
  private lastChime = -1;
  muted = false;

  private ensure(): boolean {
    if (this.ctx) return true;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return false;
      this.ctx = new Ctor();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0;
      this.osc = this.ctx.createOscillator();
      this.osc.type = 'square';
      this.osc.connect(this.gain).connect(this.ctx.destination);
      this.osc.start();
      return true;
    } catch {
      return false;
    }
  }

  /** Call every frame with the highest-priority active warning (or null). */
  update(top: WarningDef | null, nowMs: number): void {
    if (!this.ensure() || !this.ctx || !this.gain || !this.osc) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    let level = 0;
    if (top && !this.muted) {
      const t = nowMs / 1000;
      switch (top.tone) {
        case 'continuous':
          this.osc.frequency.value = 880;
          level = 0.06;
          break;
        case 'fast':
          this.osc.frequency.value = top.level === 3 ? 1200 : 900;
          level = Math.floor(t * 8) % 2 === 0 ? 0.07 : 0;
          break;
        case 'slow':
          this.osc.frequency.value = 660;
          level = Math.floor(t * 3) % 2 === 0 ? 0.05 : 0;
          break;
        case 'chime':
          if (nowMs - this.lastChime > 4000) this.lastChime = nowMs;
          this.osc.frequency.value = 520;
          level = nowMs - this.lastChime < 250 ? 0.05 : 0;
          break;
        default:
          break;
      }
    }
    this.gain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.01);
  }

  silence(): void {
    if (this.ctx && this.gain) this.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.01);
  }
}
