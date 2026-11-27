import type { AircraftDefinition } from '../aircraft/registry';
import { quatRotate, radToDeg, type Quat } from '../core/math';
import { CRASH_BUILDING, LAND_DECK, type AircraftSnapshot } from '../physics/stateLayout';
import { activeWarnings } from '../physics/warnings';
import { attitudeFromQuat, bodyDirToView } from './camera';
import { BANK_MARKS, severity, tapeTicks, wrapDeg, type Severity } from './hudMath';
import { landingAdvice, type LandingGuidance } from '../navigation/landingGuidance';

const GREEN = '#7dff9a';
const WARN = '#ff5a4d';
const CAUTION = '#ffc233';
/** Dark outline under every stroke / glyph so the green stays legible over bright sky and snow. */
const HALO = 'rgba(0, 18, 6, 0.62)';
const MS_TO_KT = 1.943844;
const M_TO_FT = 3.28084;

/** Canvas-2D HUD: zero 3D draw calls. Drawn in CSS pixels; backing store is scaled by DPR. */
export class Hud {
  private readonly ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  /** Touch layout: status block moves to the top-left so the on-screen controls stay clear. */
  compact = false;
  /** UI scale of the frame being drawn (used by the text / stroke helpers). */
  private u = 1;
  private landingGuidance: LandingGuidance | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
    window.addEventListener('cfs:landing-guidance', (event) => {
      this.landingGuidance = (event as CustomEvent<LandingGuidance | null>).detail;
    });
  }

  private colour(sev: Severity): string {
    return sev === 2 ? WARN : sev === 1 ? CAUTION : GREEN;
  }

  /** Stroke a path twice: a wider dark halo first, then the HUD colour on top. */
  private stroke(path: Path2D): void {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = HALO;
    ctx.lineWidth += 2.5 * this.u;
    ctx.stroke(path);
    ctx.restore();
    ctx.stroke(path);
  }

  /** Text with a dark outline (alignment / fill colour come from the context). */
  private text(s: string, x: number, y: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = HALO;
    ctx.lineWidth = 3 * this.u;
    ctx.lineJoin = 'round';
    ctx.strokeText(s, x, y);
    ctx.restore();
    ctx.fillText(s, x, y);
  }

  /**
   * Scrolling tape (speed on the left, altitude on the right). Ticks point to the screen edge, the
   * value box sits on the inner side, so the middle of the screen stays clear.
   */
  private tape(o: {
    x: number;
    cy: number;
    dir: -1 | 1;
    value: number;
    pxPerUnit: number;
    half: number;
    minor: number;
    major: number;
    boxText: string;
    sev: Severity;
    top: string;
    bottom: string;
  }): void {
    const { ctx, u } = this;
    const { x, cy, dir, half } = o;
    const path = new Path2D();
    path.moveTo(x, cy - half);
    path.lineTo(x, cy + half);
    const labels: [string, number][] = [];
    for (const t of tapeTicks(o.value, half / o.pxPerUnit, o.minor, o.major)) {
      const y = cy - (t.value - o.value) * o.pxPerUnit;
      if (Math.abs(y - cy) > half || (Math.abs(y - cy) < 16 * u && t.major)) continue; // keep the box area clean
      const len = (t.major ? 14 : 7) * u;
      path.moveTo(x, y);
      path.lineTo(x + dir * len, y);
      if (t.major && t.value >= 0) labels.push([String(Math.round(t.value)), y]);
    }
    this.stroke(path);
    ctx.textAlign = dir < 0 ? 'right' : 'left';
    for (const [label, y] of labels) this.text(label, x + dir * 20 * u, y);

    // value box + pointer
    const bw = 70 * u;
    const bh = 26 * u;
    const inner = x - dir * 8 * u; // box edge nearest the tape, offset towards the screen centre
    const bx = dir < 0 ? x + 8 * u : x - 8 * u - bw;
    const box = new Path2D();
    box.rect(bx, cy - bh / 2, bw, bh);
    const pointer = new Path2D();
    pointer.moveTo(x, cy);
    pointer.lineTo(inner, cy - 5 * u);
    pointer.lineTo(inner, cy + 5 * u);
    pointer.closePath();
    ctx.fillStyle = 'rgba(0, 18, 6, 0.55)';
    ctx.fillRect(bx, cy - bh / 2, bw, bh);
    ctx.strokeStyle = this.colour(o.sev);
    this.stroke(box);
    this.stroke(pointer);
    ctx.fillStyle = this.colour(o.sev);
    ctx.textAlign = 'center';
    this.text(o.boxText, bx + bw / 2, cy);
    ctx.fillStyle = GREEN;
    ctx.strokeStyle = GREEN;
    ctx.textAlign = dir < 0 ? 'right' : 'left';
    this.text(o.top, x + dir * 20 * u, cy - half - 12 * u);
    this.text(o.bottom, x + dir * 20 * u, cy + half + 14 * u);
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

  private drawLandingGuidance(cx: number, y: number, w: number): void {
    const guidance = this.landingGuidance;
    if (!guidance) return;
    const { ctx, u } = this;
    const width = Math.min(w - 24 * u, 460 * u);
    const height = 48 * u;
    const x = cx - width / 2;
    const course = String((Math.round(guidance.course * 180 / Math.PI) + 360) % 360).padStart(3, '0');
    const loc = Math.abs(guidance.lateralError) <= 35
      ? 'LOC CENTER'
      : `LOC ${guidance.lateralError > 0 ? 'LEFT' : 'RIGHT'} ${Math.round(Math.abs(guidance.lateralError))}m`;
    const glide = Math.abs(guidance.glideError) <= 25
      ? 'G/S ON'
      : `G/S ${guidance.glideError > 0 ? 'HIGH' : 'LOW'} ${Math.round(Math.abs(guidance.glideError))}m`;
    ctx.save();
    ctx.fillStyle = 'rgba(0, 12, 8, 0.78)';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = guidance.phase === 'MISSED' ? WARN : GREEN;
    ctx.lineWidth = 1 * u;
    ctx.strokeRect(x, y, width, height);
    ctx.textAlign = 'center';
    ctx.font = `bold ${10 * u}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.fillStyle = guidance.phase === 'MISSED' ? WARN : GREEN;
    this.text(`${guidance.site.name.toUpperCase()} · ${guidance.phase} · THR ${(guidance.distanceToThreshold / 1000).toFixed(1)} KM`, cx, y + 12 * u);
    ctx.font = `${9 * u}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.fillStyle = GREEN;
    this.text(`CRS ${course}°  ${loc}  ${glide}  ${Math.round(guidance.speed * MS_TO_KT)} KT`, cx, y + 27 * u);
    ctx.fillStyle = CAUTION;
    this.text(landingAdvice(guidance), cx, y + 40 * u);
    ctx.restore();
  }

  /** `fovY` is the field of view actually used by the 3D camera (it varies with speed). */
  draw(s: AircraftSnapshot | null, def: AircraftDefinition, nowMs: number, fovY = def.fovY, look = { yaw: 0, pitch: 0 }): void {
    this.fit();
    const { ctx, w, h } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!s) return;

    if (s.crashed) this.drawCrashOverlay(s);

    const u = Math.max(this.compact ? 0.85 : 0.7, h / 800); // UI scale
    this.u = u;
    const cx = w / 2;
    const cy = h / 2;
    const att = attitudeFromQuat(s.orientation);
    const pxPerUnit = h / 2 / Math.tan(fovY / 2); // pixels per tan(angle)

    ctx.strokeStyle = GREEN;
    ctx.fillStyle = GREEN;
    ctx.lineWidth = 1.5 * u;
    ctx.lineJoin = 'round';
    ctx.font = `${14 * u}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.textBaseline = 'middle';

    // The pitch ladder is only valid for a view straight ahead; while the head is turned the
    // aircraft-referenced symbols (boresight, flight path marker) move across the screen instead.
    const lookAway = Math.abs(look.yaw) > 0.035 || Math.abs(look.pitch) > 0.035;
    // body direction -> screen position (null when behind the view plane)
    const toScreen = (v: [number, number, number]): [number, number] | null => {
      const d = bodyDirToView(v, look.yaw, look.pitch);
      if (d[0] < 0.05) return null;
      return [cx + (d[2] / d[0]) * pxPerUnit, cy - (d[1] / d[0]) * pxPerUnit];
    };

    const tapeY = 36 * u;
    const half = (this.compact ? 0.17 : 0.2) * h; // half-height of the speed / altitude tapes

    // --- Pitch ladder (rotates with the world, clipped to a central window) + bank scale
    if (!lookAway) {
      const solid = new Path2D();
      const dashed = new Path2D();
      const marks: [string, number, number][] = [];
      for (let deg = -90; deg <= 90; deg += 5) {
        const rel = (deg * Math.PI) / 180 - att.pitch;
        if (Math.abs(rel) > 0.6) continue;
        const y = -Math.tan(rel) * pxPerUnit;
        const horizon = deg === 0;
        const major = deg % 10 === 0;
        const halfLen = (horizon ? 0.26 : major ? 0.09 : 0.05) * h;
        const gap = (horizon ? 0.05 : 0.03) * h;
        const path = deg < 0 ? dashed : solid;
        path.moveTo(-halfLen, y);
        path.lineTo(-gap, y);
        path.moveTo(gap, y);
        path.lineTo(halfLen, y);
        if (major && !horizon) marks.push([String(Math.abs(deg)), halfLen, y]);
      }
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx - 0.3 * h, cy - 0.32 * h, 0.6 * h, 0.64 * h);
      ctx.clip();
      ctx.translate(cx, cy);
      ctx.rotate(-att.roll);
      this.stroke(solid);
      ctx.setLineDash([6 * u, 5 * u]);
      this.stroke(dashed);
      ctx.setLineDash([]);
      for (const [label, halfLen, y] of marks) {
        ctx.textAlign = 'right';
        this.text(label, -halfLen - 6 * u, y);
        ctx.textAlign = 'left';
        this.text(label, halfLen + 6 * u, y);
      }
      ctx.restore();

      // Bank scale: fixed graduations on the aircraft, pointer rides with the horizon.
      const R = (this.compact ? 0.3 : 0.35) * h;
      if (cy - R - 16 * u > tapeY + 40 * u) {
        const scale = new Path2D();
        for (const mark of BANK_MARKS) {
          const a = (mark * Math.PI) / 180;
          const len = (mark === 0 || Math.abs(mark) === 30 || Math.abs(mark) === 60 ? 11 : 6) * u;
          scale.moveTo(cx + Math.sin(a) * R, cy - Math.cos(a) * R);
          scale.lineTo(cx + Math.sin(a) * (R + len), cy - Math.cos(a) * (R + len));
        }
        this.stroke(scale);
        const ptr = new Path2D();
        ptr.moveTo(0, -R + 2 * u);
        ptr.lineTo(-6 * u, -R + 12 * u);
        ptr.lineTo(6 * u, -R + 12 * u);
        ptr.closePath();
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(-att.roll);
        this.stroke(ptr);
        ctx.restore();
      }
    }

    // --- Flight path marker: where the aircraft is actually going (differs from the nose by AoA / sideslip)
    const conj: Quat = [-s.orientation[0], -s.orientation[1], -s.orientation[2], s.orientation[3]];
    const vb = quatRotate(conj, s.velocity);
    const fpm = !s.crashed && vb[0] > 5 ? toScreen(vb) : null;
    if (fpm) {
      const [fx, fy] = fpm;
      if (Math.abs(fx - cx) < w && Math.abs(fy - cy) < h) {
        const p = new Path2D();
        p.arc(fx, fy, 7 * u, 0, Math.PI * 2);
        p.moveTo(fx - 17 * u, fy);
        p.lineTo(fx - 7 * u, fy);
        p.moveTo(fx + 7 * u, fy);
        p.lineTo(fx + 17 * u, fy);
        p.moveTo(fx, fy - 7 * u);
        p.lineTo(fx, fy - 15 * u);
        this.stroke(p);
      }
    }

    // --- Boresight (the nose direction; stays centred unless the head is turned)
    const bore = toScreen([1, 0, 0]);
    if (bore) {
      const [bx0, by0] = bore;
      const p = new Path2D();
      p.arc(bx0, by0, 5 * u, 0, Math.PI * 2);
      p.moveTo(bx0 - 18 * u, by0);
      p.lineTo(bx0 - 5 * u, by0);
      p.moveTo(bx0 + 5 * u, by0);
      p.lineTo(bx0 + 18 * u, by0);
      p.moveTo(bx0, by0 - 5 * u);
      p.lineTo(bx0, by0 - 14 * u);
      this.stroke(p);
    }
    if (lookAway) {
      ctx.textAlign = 'center';
      this.text(`LOOK ${radToDeg(look.yaw).toFixed(0)}° / ${radToDeg(look.pitch).toFixed(0)}°  ${this.compact ? '(放開回正)' : '(C = 回正)'}`, cx, h - 24 * u);
    }

    // --- Heading tape
    const hd = radToDeg(att.heading);
    const pxPerDeg = 5 * u;
    ctx.textAlign = 'center';
    const hdgTicks = new Path2D();
    for (let d = Math.floor((hd - 30) / 10) * 10; d <= hd + 30; d += 10) {
      const x = cx + (d - hd) * pxPerDeg;
      const n = wrapDeg(d);
      hdgTicks.moveTo(x, tapeY);
      hdgTicks.lineTo(x, tapeY + 8 * u);
      const label = n === 0 ? 'N' : n === 90 ? 'E' : n === 180 ? 'S' : n === 270 ? 'W' : String(n / 10).padStart(2, '0');
      this.text(label, x, tapeY - 8 * u);
    }
    // intermediate 5-degree ticks
    for (let d = Math.floor((hd - 30) / 10) * 10 + 5; d <= hd + 30; d += 10) {
      const x = cx + (d - hd) * pxPerDeg;
      hdgTicks.moveTo(x, tapeY);
      hdgTicks.lineTo(x, tapeY + 4 * u);
    }
    this.stroke(hdgTicks);
    const hdgBox = new Path2D();
    hdgBox.rect(cx - 24 * u, tapeY + 12 * u, 48 * u, 22 * u);
    this.stroke(hdgBox);
    this.text(String(Math.round(hd) % 360).padStart(3, '0'), cx, tapeY + 23 * u);

    // --- Speed tape (left) and altitude tape (right)
    const kt = s.airspeed * MS_TO_KT;
    const ft = s.altitude * M_TO_FT;
    const vsFpm = s.velocity[1] * M_TO_FT * 60;
    const speedSev: Severity = (s.warnMask & (1 << 2)) !== 0 ? 2 : (s.warnMask & (1 << 8)) !== 0 ? 1 : 0; // OVERSPEED / SPEED
    this.tape({
      x: 0.2 * w, cy, dir: -1, value: kt, pxPerUnit: 2.2 * u, half, minor: 10, major: 50,
      boxText: kt.toFixed(0), sev: speedSev,
      top: 'KT', bottom: `M ${s.mach.toFixed(2)}`,
    });
    this.tape({
      x: 0.8 * w, cy, dir: 1, value: ft, pxPerUnit: 0.14 * u, half, minor: 100, major: 500,
      boxText: ft.toFixed(0), sev: severity(s.altitude, 150, 40),
      top: 'FT', bottom: `VS ${vsFpm.toFixed(0)}`,
    });

    // --- Lower-left status
    ctx.textAlign = 'left';
    const bx = (this.compact ? 0.02 : 0.04) * w;
    const by = this.compact ? 0.3 * h : h - 130 * u;
    const g = s.loadFactor;
    this.text(`THR ${(s.throttle * 100).toFixed(0)}%${s.afterburner ? '  AB' : ''}`, bx, by);
    ctx.fillStyle = this.colour(severity(g, def.gLimit * 0.8, def.gLimit * 0.97));
    this.text(`G   ${g.toFixed(1)}${s.gLimiting ? '  LIM' : ''}`, bx, by + 20 * u);
    ctx.fillStyle = GREEN;
    this.text(`AOA ${radToDeg(s.alpha).toFixed(1)}°`, bx, by + 40 * u);
    const fuelPct = (s.fuel / def.fuelCapacity) * 100;
    ctx.fillStyle = this.colour(severity(fuelPct, 25, 10));
    this.text(`FUEL ${s.fuel.toFixed(0)} kg (${fuelPct.toFixed(0)}%)`, bx, by + 60 * u);
    // fuel gauge under the text
    const gaugeW = 150 * u;
    ctx.strokeStyle = ctx.fillStyle;
    const gauge = new Path2D();
    gauge.rect(bx, by + 70 * u, gaugeW, 5 * u);
    this.stroke(gauge);
    ctx.fillRect(bx, by + 70 * u, (gaugeW * Math.max(0, Math.min(100, fuelPct))) / 100, 5 * u);
    ctx.fillStyle = GREEN;
    ctx.strokeStyle = GREEN;

    // --- Warnings: master banner (highest priority) + stacked list of the rest
    const blink = Math.floor(nowMs / 250) % 2 === 0;
    const list = s.crashed || s.landed ? [] : activeWarnings(s.warnMask);
    ctx.textAlign = 'center';
    if (s.crashed) {
      ctx.font = `bold ${26 * u}px system-ui, sans-serif`;
      ctx.fillStyle = WARN;
      this.text(s.crashKind === CRASH_BUILDING ? 'COLLISION' : 'CRASHED', cx, cy + 0.28 * h);
    } else if (s.landed) {
      ctx.font = `bold ${26 * u}px system-ui, sans-serif`;
      ctx.fillStyle = GREEN;
      this.text(s.landingKind === LAND_DECK ? 'TRAPPED' : 'LANDED', cx, cy + 0.28 * h);
    } else if (list.length > 0) {
      const top = list[0];
      const colour = top.level === 3 ? WARN : top.level === 2 ? CAUTION : GREEN;
      ctx.fillStyle = colour;
      ctx.font = `bold ${26 * u}px system-ui, sans-serif`;
      if (top.level < 3 || blink) this.text(top.text, cx, cy + 0.28 * h);
      let line = cy + 0.28 * h + 28 * u;
      ctx.font = `${15 * u}px ui-monospace, Menlo, Consolas, monospace`;
      if (s.impactTime < 8 && (s.warnMask & ((1 << 0) | (1 << 5))) !== 0) {
        this.text(`IMPACT ${s.impactTime.toFixed(1)} s`, cx, line);
        line += 20 * u;
      }
      for (const wdef of list.slice(1, 4)) {
        ctx.fillStyle = wdef.level === 3 ? WARN : wdef.level === 2 ? CAUTION : GREEN;
        this.text(wdef.text, cx, line);
        line += 20 * u;
      }
      if (top.level === 3) {
        // master warning frame
        ctx.strokeStyle = WARN;
        ctx.lineWidth = 4 * u;
        if (blink) ctx.strokeRect(2 * u, 2 * u, w - 4 * u, h - 4 * u);
        ctx.strokeStyle = GREEN;
        ctx.lineWidth = 1.5 * u;
      }
    }
    if (!s.crashed && !s.landed) this.drawLandingGuidance(cx, 82 * u, w);
    ctx.fillStyle = GREEN;
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
