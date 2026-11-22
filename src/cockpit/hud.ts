import type { AircraftDefinition } from '../aircraft/registry';
import { quatRotate, radToDeg, type Quat } from '../core/math';
import { CRASH_BUILDING, type AircraftSnapshot } from '../physics/stateLayout';
import { attitudeFromQuat } from './camera';

const GREEN = '#7dff9a';
const WARN = '#ff5a4d';
const MS_TO_KT = 1.943844;
const M_TO_FT = 3.28084;

/** Canvas-2D HUD: zero 3D draw calls. Drawn in CSS pixels; backing store is scaled by DPR. */
export class Hud {
  private readonly ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
  }

  private fit(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w !== this.w || h !== this.h || dpr !== this.dpr) {
      this.w = w;
      this.h = h;
      this.dpr = dpr;
      this.canvas.width = Math.max(1, Math.round(w * dpr));
      this.canvas.height = Math.max(1, Math.round(h * dpr));
    }
  }

  /** `fovY` is the field of view actually used by the 3D camera (it varies with speed). */
  draw(s: AircraftSnapshot | null, def: AircraftDefinition, nowMs: number, fovY = def.fovY): void {
    this.fit();
    const { ctx, w, h } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!s) return;

    if (s.crashed) this.drawCrashOverlay(s);

    const u = Math.max(0.7, h / 800); // UI scale
    const cx = w / 2;
    const cy = h / 2;
    const att = attitudeFromQuat(s.orientation);
    const pxPerUnit = h / 2 / Math.tan(fovY / 2); // pixels per tan(angle)

    ctx.strokeStyle = GREEN;
    ctx.fillStyle = GREEN;
    ctx.lineWidth = 1.5 * u;
    ctx.font = `${14 * u}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.textBaseline = 'middle';

    // --- Pitch ladder (rotates with the world, clipped to a central window)
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - 0.3 * h, cy - 0.32 * h, 0.6 * h, 0.64 * h);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(-att.roll);
    for (let deg = -90; deg <= 90; deg += 5) {
      const rel = (deg * Math.PI) / 180 - att.pitch;
      if (Math.abs(rel) > 0.6) continue;
      const y = -Math.tan(rel) * pxPerUnit;
      const horizon = deg === 0;
      const major = deg % 10 === 0;
      const half = (horizon ? 0.26 : major ? 0.09 : 0.05) * h;
      ctx.beginPath();
      if (deg < 0) ctx.setLineDash([6 * u, 5 * u]);
      ctx.moveTo(-half, y);
      ctx.lineTo(horizon ? -0.05 * h : -0.03 * h, y);
      ctx.moveTo(horizon ? 0.05 * h : 0.03 * h, y);
      ctx.lineTo(half, y);
      ctx.stroke();
      ctx.setLineDash([]);
      if (major && !horizon) {
        ctx.textAlign = 'right';
        ctx.fillText(String(Math.abs(deg)), -half - 6 * u, y);
        ctx.textAlign = 'left';
        ctx.fillText(String(Math.abs(deg)), half + 6 * u, y);
      }
    }
    ctx.restore();

    // --- Flight path marker: where the aircraft is actually going (differs from the nose by AoA / sideslip)
    const conj: Quat = [-s.orientation[0], -s.orientation[1], -s.orientation[2], s.orientation[3]];
    const vb = quatRotate(conj, s.velocity);
    if (!s.crashed && vb[0] > 5) {
      const fx = cx + (vb[2] / vb[0]) * pxPerUnit;
      const fy = cy - (vb[1] / vb[0]) * pxPerUnit;
      if (Math.abs(fx - cx) < w && Math.abs(fy - cy) < h) {
        ctx.beginPath();
        ctx.arc(fx, fy, 7 * u, 0, Math.PI * 2);
        ctx.moveTo(fx - 17 * u, fy);
        ctx.lineTo(fx - 7 * u, fy);
        ctx.moveTo(fx + 7 * u, fy);
        ctx.lineTo(fx + 17 * u, fy);
        ctx.moveTo(fx, fy - 7 * u);
        ctx.lineTo(fx, fy - 15 * u);
        ctx.stroke();
      }
    }

    // --- Boresight
    ctx.beginPath();
    ctx.arc(cx, cy, 5 * u, 0, Math.PI * 2);
    ctx.moveTo(cx - 18 * u, cy);
    ctx.lineTo(cx - 5 * u, cy);
    ctx.moveTo(cx + 5 * u, cy);
    ctx.lineTo(cx + 18 * u, cy);
    ctx.moveTo(cx, cy - 5 * u);
    ctx.lineTo(cx, cy - 14 * u);
    ctx.stroke();

    // --- Heading tape
    const hd = radToDeg(att.heading);
    const tapeY = 36 * u;
    const pxPerDeg = 5 * u;
    ctx.textAlign = 'center';
    for (let d = Math.floor((hd - 30) / 10) * 10; d <= hd + 30; d += 10) {
      const x = cx + (d - hd) * pxPerDeg;
      const n = ((d % 360) + 360) % 360;
      ctx.beginPath();
      ctx.moveTo(x, tapeY);
      ctx.lineTo(x, tapeY + 8 * u);
      ctx.stroke();
      const label = n === 0 ? 'N' : n === 90 ? 'E' : n === 180 ? 'S' : n === 270 ? 'W' : String(n / 10).padStart(2, '0');
      ctx.fillText(label, x, tapeY - 8 * u);
    }
    ctx.strokeRect(cx - 24 * u, tapeY + 12 * u, 48 * u, 22 * u);
    ctx.fillText(String(Math.round(hd) % 360).padStart(3, '0'), cx, tapeY + 23 * u);

    // --- Speed (left) and altitude (right)
    const boxW = 84 * u;
    const boxH = 26 * u;
    const kt = s.airspeed * MS_TO_KT;
    const ft = s.altitude * M_TO_FT;
    const vsFpm = s.velocity[1] * M_TO_FT * 60;
    const sideX = 0.2 * w;
    ctx.strokeRect(sideX - boxW, cy - boxH / 2, boxW, boxH);
    ctx.textAlign = 'center';
    ctx.fillText(kt.toFixed(0), sideX - boxW / 2, cy);
    ctx.textAlign = 'left';
    ctx.fillText('KT', sideX - boxW, cy - boxH);
    ctx.fillText(`M ${s.mach.toFixed(2)}`, sideX - boxW, cy + boxH);

    const altX = 0.8 * w;
    ctx.strokeRect(altX, cy - boxH / 2, boxW, boxH);
    ctx.textAlign = 'center';
    ctx.fillText(ft.toFixed(0), altX + boxW / 2, cy);
    ctx.textAlign = 'left';
    ctx.fillText('FT', altX, cy - boxH);
    ctx.fillText(`VS ${vsFpm.toFixed(0)}`, altX, cy + boxH);

    // --- Lower-left status
    ctx.textAlign = 'left';
    const bx = 0.04 * w;
    const by = h - 110 * u;
    ctx.fillText(`THR ${(s.throttle * 100).toFixed(0)}%`, bx, by);
    ctx.fillText(`G   ${s.loadFactor.toFixed(1)}`, bx, by + 20 * u);
    ctx.fillText(`AOA ${radToDeg(s.alpha).toFixed(1)}°`, bx, by + 40 * u);

    // --- Warnings
    const blink = Math.floor(nowMs / 250) % 2 === 0;
    ctx.textAlign = 'center';
    ctx.font = `bold ${26 * u}px system-ui, sans-serif`;
    ctx.fillStyle = WARN;
    const impact = s.impactTime < 6;
    if (s.crashed) {
      ctx.fillText(s.crashKind === CRASH_BUILDING ? 'COLLISION' : 'CRASHED', cx, cy + 0.28 * h);
    } else if (impact) {
      if (blink) ctx.fillText('PULL UP', cx, cy + 0.28 * h);
      ctx.font = `${16 * u}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.fillText(`IMPACT ${s.impactTime.toFixed(1)} s`, cx, cy + 0.28 * h + 30 * u);
    } else if (s.stallWarning && blink) {
      ctx.fillText('STALL', cx, cy + 0.28 * h);
    }
  }

  /** Bright flash at the moment of impact, then a darkening vignette. */
  private drawCrashOverlay(s: AircraftSnapshot): void {
    const { ctx, w, h } = this;
    const since = Math.max(0, s.time - s.crashTime);
    const flash = Math.max(0, 1 - since * 3.2);
    if (flash > 0) {
      ctx.fillStyle = `rgba(255, ${Math.round(210 - 120 * (1 - flash))}, ${Math.round(150 * flash)}, ${(flash * 0.85).toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
    }
    const dark = Math.min(0.75, since * 0.55);
    if (dark > 0) {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.15, w / 2, h / 2, Math.max(w, h) * 0.75);
      g.addColorStop(0, `rgba(30, 0, 0, ${(dark * 0.25).toFixed(3)})`);
      g.addColorStop(1, `rgba(0, 0, 0, ${dark.toFixed(3)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.fillStyle = GREEN;
  }
}
