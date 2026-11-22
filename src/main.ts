import './ui/style.css';
import { getAircraft } from './aircraft/registry';
import { detectCapabilities } from './core/capabilities';
import { cameraFromSnapshot } from './cockpit/camera';
import { Hud } from './cockpit/hud';
import { PhysicsClient, type ControlInput } from './physics/PhysicsClient';
import { DynamicResolution } from './rendering/dynamicResolution';
import { createRenderer } from './rendering/createRenderer';
import type { Backend } from './rendering/Renderer';
import { KeyboardControls } from './ui/input';

const stage = document.getElementById('stage') as HTMLDivElement;
const hudCanvas = document.getElementById('hud') as HTMLCanvasElement;
const statusEl = document.getElementById('status') as HTMLPreElement;
const errorEl = document.getElementById('error') as HTMLDivElement;

function fail(message: string): void {
  errorEl.hidden = false;
  errorEl.textContent = message;
}

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const forced: Backend | undefined = params.get('backend') === 'webgl2' ? 'webgl2' : undefined;
  const aircraft = getAircraft(0);
  const caps = detectCapabilities();
  if (!caps.workers) throw new Error('此瀏覽器不支援 Web Worker，無法執行物理模擬。');

  const physics = new PhysicsClient();
  const wasmUrl = new URL(`${import.meta.env.BASE_URL}wasm/physics_engine.wasm`, location.href).href;
  const [handle] = await Promise.all([createRenderer(stage, forced), physics.start(wasmUrl, aircraft.id)]);
  const { renderer, canvas, fallbackLog } = handle;

  const hud = new Hud(hudCanvas);
  const input = new KeyboardControls(aircraft.startThrottle);
  const dynRes = new DynamicResolution();
  let lastSent: ControlInput = { ...input.state, throttle: -1 }; // force first send

  input.onReset = () => {
    physics.reset();
    input.reset(aircraft.startThrottle);
    lastSent = { ...input.state, throttle: -1 };
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) physics.pause();
    else physics.resume();
  });

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

    input.update(Math.min(frameMs / 1000, 0.1));
    const c = input.state;
    if (
      Math.abs(c.throttle - lastSent.throttle) > 1e-3 ||
      Math.abs(c.pitch - lastSent.pitch) > 1e-3 ||
      Math.abs(c.roll - lastSent.roll) > 1e-3 ||
      Math.abs(c.yaw - lastSent.yaw) > 1e-3
    ) {
      physics.setControls(c);
      lastSent = { ...c };
    }

    const scale = dynRes.update(frameMs);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(stage.clientWidth * dpr * scale));
    const h = Math.max(1, Math.round(stage.clientHeight * dpr * scale));
    if (w !== bufW || h !== bufH) {
      renderer.resize(w, h);
      bufW = w;
      bufH = h;
    }

    const snap = physics.sample(now);
    if (snap) renderer.render(cameraFromSnapshot(snap, aircraft));
    hud.draw(snap, aircraft, now);

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
  void canvas;
}

boot().catch((e: unknown) => {
  console.error(e);
  fail(`啟動失敗：\n${e instanceof Error ? e.message : String(e)}`);
});
