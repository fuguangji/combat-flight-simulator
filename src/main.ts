import './ui/style.css';
import { getAircraft } from './aircraft/registry';
import { detectCapabilities } from './core/capabilities';
import { CameraRig } from './cockpit/camera';
import { Hud } from './cockpit/hud';
import { PhysicsClient, type ControlInput } from './physics/PhysicsClient';
import { CRASH_BUILDING, type AircraftSnapshot } from './physics/stateLayout';
import { DynamicResolution } from './rendering/dynamicResolution';
import { createRenderer } from './rendering/createRenderer';
import type { Backend } from './rendering/Renderer';
import { activeWarnings } from './physics/warnings';
import { attractCamera } from './ui/attract';
import { WarningAudio } from './ui/audio';
import { KeyboardControls } from './ui/input';

type Mode = 'loading' | 'menu' | 'flying' | 'paused' | 'crashed';

const MS_TO_KT = 1.943844;
/** Wall-clock delay between the impact and the result card, so the flash / shake can play. */
const CRASH_CARD_DELAY_MS = 1500;
const FADE_MS = 450;

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in index.html`);
  return el as T;
};

const stage = $<HTMLDivElement>('stage');
const hudCanvas = $<HTMLCanvasElement>('hud');
const statusEl = $<HTMLPreElement>('status');
const errorEl = $<HTMLDivElement>('error');
const menuEl = $<HTMLElement>('menu');
const pauseEl = $<HTMLDivElement>('pause');
const crashEl = $<HTMLDivElement>('crash');
const fadeEl = $<HTMLDivElement>('fade');
const startBtn = $<HTMLButtonElement>('btn-start');
const howtoBtn = $<HTMLButtonElement>('btn-howto');
const howtoEl = $<HTMLElement>('howto');
const crashStatsEl = $<HTMLDListElement>('crash-stats');
const crashTitleEl = $<HTMLHeadingElement>('crash-title');

function fail(message: string): void {
  errorEl.hidden = false;
  errorEl.textContent = message;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const forced: Backend | undefined = params.get('backend') === 'webgl2' ? 'webgl2' : undefined;
  const aircraft = getAircraft(0);
  const caps = detectCapabilities();
  if (!caps.workers) throw new Error('此瀏覽器不支援 Web Worker，無法執行物理模擬。');

  let mode: Mode = 'loading';
  const setMode = (m: Mode): void => {
    mode = m;
    document.body.dataset.mode = m;
  };
  setMode('loading');
  $<HTMLElement>('spec-aircraft').textContent = aircraft.displayName;
  howtoBtn.addEventListener('click', () => {
    howtoEl.hidden = !howtoEl.hidden;
    howtoBtn.setAttribute('aria-expanded', String(!howtoEl.hidden));
  });

  const physics = new PhysicsClient();
  const wasmUrl = new URL(`${import.meta.env.BASE_URL}wasm/physics_engine.wasm`, location.href).href;
  const [handle] = await Promise.all([createRenderer(stage, forced), physics.start(wasmUrl, aircraft.id)]);
  const { renderer, fallbackLog } = handle;
  physics.pause(); // the sim only runs while a flight is in progress

  $<HTMLElement>('spec-backend').textContent = renderer.backend === 'webgpu' ? 'WebGPU' : 'WebGL 2';

  const hud = new Hud(hudCanvas);
  const input = new KeyboardControls(aircraft.startThrottle);
  const dynRes = new DynamicResolution();
  const rig = new CameraRig();
  const audio = new WarningAudio();
  let lastSent: ControlInput = { ...input.state, throttle: -1 }; // force first send

  // ---- flight bookkeeping -------------------------------------------------------------------
  let lastSnap: AircraftSnapshot | null = null;
  let frozenSnap: AircraftSnapshot | null = null;
  let crashedAtMs = 0;
  let transitioning = false;
  const stats = { maxKt: 0, maxG: 0, minAlt: Infinity, preCrashKt: 0 };

  const showOverlay = (which: 'menu' | 'pause' | 'crash' | null): void => {
    menuEl.hidden = which !== 'menu';
    pauseEl.hidden = which !== 'pause';
    crashEl.hidden = which !== 'crash';
  };

  /** Fade to black, run `change` while hidden, fade back in. */
  const withFade = async (change: () => void): Promise<void> => {
    if (transitioning) return;
    transitioning = true;
    fadeEl.classList.add('on');
    await sleep(FADE_MS);
    change();
    await sleep(60);
    fadeEl.classList.remove('on');
    transitioning = false;
  };

  const beginFlight = (): void => {
    physics.reset();
    input.reset(aircraft.startThrottle);
    lastSent = { ...input.state, throttle: -1 };
    rig.reset();
    lastSnap = null;
    frozenSnap = null;
    stats.maxKt = 0;
    stats.maxG = 0;
    stats.minAlt = Infinity;
    stats.preCrashKt = 0;
    physics.resume();
    showOverlay(null);
    setMode('flying');
  };

  const startFlight = (): void => {
    if (mode !== 'menu' && mode !== 'paused' && mode !== 'crashed') return;
    void withFade(beginFlight);
  };

  const goHome = (): void => {
    if (mode === 'menu' || mode === 'loading') return;
    void withFade(() => {
      physics.pause();
      audio.silence();
      frozenSnap = null;
      lastSnap = null;
      showOverlay('menu');
      setMode('menu');
    });
  };

  const pauseFlight = (): void => {
    if (mode !== 'flying') return;
    physics.pause();
    audio.silence();
    frozenSnap = lastSnap;
    showOverlay('pause');
    setMode('paused');
  };

  const resumeFlight = (): void => {
    if (mode !== 'paused') return;
    physics.resume();
    showOverlay(null);
    setMode('flying');
  };

  const showCrashCard = (s: AircraftSnapshot): void => {
    const building = s.crashKind === CRASH_BUILDING;
    crashTitleEl.textContent = building ? '撞上建築物' : '墜地';
    const row = (k: string, v: string): string => `<dt>${k}</dt><dd>${v}</dd>`;
    crashStatsEl.innerHTML =
      row('飛行時間', `${s.crashTime.toFixed(1)} s`) +
      row('撞擊速度', `${stats.preCrashKt.toFixed(0)} KT`) +
      row('最高速度', `${stats.maxKt.toFixed(0)} KT`) +
      row('最大過載', `${stats.maxG.toFixed(1)} G`) +
      row('最低高度', `${Number.isFinite(stats.minAlt) ? stats.minAlt.toFixed(0) : '—'} m`);
    showOverlay('crash');
  };

  // ---- wiring -------------------------------------------------------------------------------
  startBtn.addEventListener('click', startFlight);
  $<HTMLButtonElement>('btn-resume').addEventListener('click', resumeFlight);
  $<HTMLButtonElement>('btn-restart-pause').addEventListener('click', startFlight);
  $<HTMLButtonElement>('btn-home-pause').addEventListener('click', goHome);
  $<HTMLButtonElement>('btn-restart-crash').addEventListener('click', startFlight);
  $<HTMLButtonElement>('btn-home-crash').addEventListener('click', goHome);

  input.onReset = startFlight;
  input.onPause = () => {
    if (mode === 'flying') pauseFlight();
    else if (mode === 'paused') resumeFlight();
  };
  input.onConfirm = () => {
    if (mode === 'menu' || mode === 'crashed') startFlight();
    else if (mode === 'paused') resumeFlight();
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseFlight(); // the wall clock would otherwise run on without the sim
  });

  startBtn.disabled = false;
  startBtn.textContent = '起飛';
  showOverlay('menu');
  setMode('menu');
  startBtn.focus({ preventScroll: true });

  // ---- main loop ----------------------------------------------------------------------------
  let lastFrame = performance.now();
  let statFrames = 0;
  let statStart = lastFrame;
  let fps = 0;
  let bufW = 0;
  let bufH = 0;

  const frame = (now: number): void => {
    requestAnimationFrame(frame);
    const frameMs = now - lastFrame;
    lastFrame = now;

    const scale = dynRes.update(frameMs);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(stage.clientWidth * dpr * scale));
    const h = Math.max(1, Math.round(stage.clientHeight * dpr * scale));
    if (w !== bufW || h !== bufH) {
      renderer.resize(w, h);
      bufW = w;
      bufH = h;
    }

    let snap: AircraftSnapshot | null = null;

    if (mode === 'menu' || mode === 'loading') {
      audio.silence();
      renderer.render(attractCamera(now));
      hud.draw(null, aircraft, now);
    } else if (mode === 'paused') {
      // frozen picture: same snapshot, same camera as the moment of pausing
      snap = frozenSnap;
      if (rig.last) renderer.render(rig.last);
      hud.draw(snap, aircraft, now, rig.last?.fovY);
    } else {
      // flying or crashed: the simulation keeps running (the wreck just stops moving)
      input.update(Math.min(frameMs / 1000, 0.1));
      const c = input.state;
      if (
        mode === 'flying' &&
        (Math.abs(c.throttle - lastSent.throttle) > 1e-3 ||
          Math.abs(c.pitch - lastSent.pitch) > 1e-3 ||
          Math.abs(c.roll - lastSent.roll) > 1e-3 ||
          Math.abs(c.yaw - lastSent.yaw) > 1e-3)
      ) {
        physics.setControls(c);
        lastSent = { ...c };
      }

      snap = physics.sample(now) ?? lastSnap;
      if (snap) {
        lastSnap = snap;
        if (!snap.crashed) {
          const kt = snap.airspeed * MS_TO_KT;
          stats.maxKt = Math.max(stats.maxKt, kt);
          stats.preCrashKt = kt;
          stats.maxG = Math.max(stats.maxG, snap.loadFactor);
          stats.minAlt = Math.min(stats.minAlt, snap.altitude);
        } else if (mode === 'flying') {
          setMode('crashed');
          crashedAtMs = now;
        }
        audio.update(snap.crashed ? null : (activeWarnings(snap.warnMask)[0] ?? null), now);
        const cam = rig.update(snap, aircraft, now);
        renderer.render(cam);
        hud.draw(snap, aircraft, now, cam.fovY);
        if (mode === 'crashed' && crashEl.hidden && !transitioning && now - crashedAtMs > CRASH_CARD_DELAY_MS) {
          showCrashCard(snap);
        }
      } else {
        hud.draw(null, aircraft, now);
      }
    }

    statFrames++;
    if (now - statStart >= 500) {
      fps = (statFrames * 1000) / (now - statStart);
      statFrames = 0;
      statStart = now;
      statusEl.textContent =
        `${renderer.backend.toUpperCase()}  ${fps.toFixed(0)} FPS  (${dynRes.smoothedFrameMs.toFixed(1)} ms)\n` +
        `render ${bufW}x${bufH} @ ${(scale * 100).toFixed(0)}%  draws ${renderer.stats.drawCalls}  inst ${renderer.stats.instances}\n` +
        `physics ${physics.measuredHz.toFixed(1)} Hz  t=${snap ? snap.time.toFixed(1) : '-'} s` +
        (fallbackLog.length ? `\nfallback: ${fallbackLog.join(' | ')}` : '') +
        (physics.lastError ? `\nphysics error: ${physics.lastError}` : '');
    }
  };
  requestAnimationFrame(frame);
}

boot().catch((e: unknown) => {
  console.error(e);
  fail(`啟動失敗：\n${e instanceof Error ? e.message : String(e)}`);
});
