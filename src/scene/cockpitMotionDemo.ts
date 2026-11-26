import * as THREE from 'three';
import { SceneMotionSystem } from './SceneMotionSystem';

/** On-demand cockpit display for generic, non-targeted 3D scene motion. */
export function mountCockpitMotionDemo(): void {
  const shell = document.getElementById('cockpit-shell');
  if (!shell || shell.querySelector('#cockpit-motion-demo')) return;
  const panel = document.createElement('section');
  panel.id = 'cockpit-motion-demo';
  panel.hidden = true;
  panel.setAttribute('aria-label', '3D scene motion test');
  panel.innerHTML = `<header><span>SCENE MOTION / 3D 運動測試</span><button type="button" data-close aria-label="關閉">×</button></header><div class="motion-viewport"><canvas aria-label="3D 球體運動與軌跡"></canvas></div><div class="motion-readout" data-readout>OBJECTS 0 · FIXED STEP 120 Hz</div><footer><button type="button" data-add>新增球體</button><button type="button" data-pause>暫停</button><button type="button" data-reset>重設</button></footer><p>獨立場景物件測試：位置、速度、固定步長與歷史軌跡；不連接裝備或目標。</p>`;
  shell.append(panel);
  const style = document.createElement('style');
  style.dataset.motionDemo = 'true';
  style.textContent = `#cockpit-motion-demo{position:absolute;z-index:12;left:3%;top:12%;width:min(360px,46vw);padding:9px;box-sizing:border-box;border:1px solid rgba(125,255,154,.48);border-radius:5px;background:rgba(3,12,9,.96);color:#d9f7e1;box-shadow:0 12px 36px #000b;pointer-events:auto;font:10px ui-monospace,Menlo,monospace}#cockpit-motion-demo[hidden]{display:none}#cockpit-motion-demo header,#cockpit-motion-demo footer{display:flex;align-items:center;justify-content:space-between;gap:6px}#cockpit-motion-demo header{color:#9effbc;letter-spacing:.1em;margin-bottom:7px}#cockpit-motion-demo button{border:1px solid rgba(125,255,154,.38);border-radius:3px;padding:6px 9px;background:#10251b;color:#e2ffeb;font:10px ui-monospace,Menlo,monospace;cursor:pointer}#cockpit-motion-demo .motion-viewport{height:180px;overflow:hidden;border:1px solid #284c3b;background:#06120e}#cockpit-motion-demo canvas{display:block;width:100%;height:100%}#cockpit-motion-demo .motion-readout{padding:7px 1px;color:#ffdb94;font-size:9px}#cockpit-motion-demo p{margin:7px 0 0;color:#91b7a0;font-size:9px;line-height:1.45}body.touch #cockpit-motion-demo{left:2%;top:7%;width:min(330px,58vw);padding:6px}body.touch #cockpit-motion-demo .motion-viewport{height:125px}`;
  document.head.append(style);
  const canvas = panel.querySelector('canvas')!;
  const viewport = panel.querySelector<HTMLElement>('.motion-viewport')!;
  const readout = panel.querySelector<HTMLElement>('[data-readout]')!;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x06120e);
  scene.add(new THREE.HemisphereLight(0xd8ffe8, 0x14231c, 2.1));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 5, 4);
  scene.add(key);
  const grid = new THREE.GridHelper(8, 16, 0x35624b, 0x193326);
  grid.position.y = -1.15;
  scene.add(grid);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 40);
  camera.position.set(0, 1.4, 7.2);
  camera.lookAt(0, 0, 0);
  const motion = new SceneMotionSystem(scene, { fixedStepSeconds: 1 / 120, maxSubSteps: 8 });
  let active = false;
  let paused = false;
  let raf = 0;
  let previous = 0;
  let count = 0;
  let lastReadout = 0;
  let resizeObserver: ResizeObserver | null = null;
  const resize = (): void => {
    const width = Math.max(1, viewport.clientWidth);
    const height = Math.max(1, viewport.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const addSphere = (): void => {
    const lane = (count % 3) - 1;
    motion.addSphere({ position: new THREE.Vector3(-2.55, lane * 0.42, 0), velocity: new THREE.Vector3(0.62, 0, 0), acceleration: new THREE.Vector3(), radius: 0.105, color: count % 2 ? 0x8bdcff : 0x8dffb0, lifetimeSeconds: 8, trailLength: 72 });
    count++;
  };
  const draw = (now: number): void => {
    if (!active) return;
    raf = requestAnimationFrame(draw);
    const dt = previous ? Math.min((now - previous) / 1000, 0.05) : 0;
    previous = now;
    if (!paused) motion.update(dt);
    renderer.render(scene, camera);
    if (now - lastReadout > 160) { lastReadout = now; readout.textContent = `OBJECTS ${motion.size} · FIXED STEP 120 Hz · ${paused ? 'PAUSED' : 'RUNNING'}`; }
  };
  const open = (): void => {
    panel.hidden = false; active = true; previous = 0; resize();
    if (!resizeObserver) { resizeObserver = new ResizeObserver(resize); resizeObserver.observe(viewport); }
    if (motion.size === 0) addSphere();
    cancelAnimationFrame(raf); raf = requestAnimationFrame(draw);
  };
  const close = (): void => { active = false; cancelAnimationFrame(raf); panel.hidden = true; resizeObserver?.disconnect(); };
  window.addEventListener('cfs:motion-demo-toggle', () => panel.hidden ? open() : close());
  panel.querySelector('[data-close]')?.addEventListener('click', close);
  panel.querySelector('[data-add]')?.addEventListener('click', addSphere);
  panel.querySelector('[data-pause]')?.addEventListener('click', event => { paused = !paused; (event.currentTarget as HTMLButtonElement).textContent = paused ? '繼續' : '暫停'; });
  panel.querySelector('[data-reset]')?.addEventListener('click', () => { motion.clear(); count = 0; addSphere(); });
  window.addEventListener('pagehide', () => { close(); motion.dispose(); renderer.dispose(); resizeObserver?.disconnect(); }, { once: true });
}