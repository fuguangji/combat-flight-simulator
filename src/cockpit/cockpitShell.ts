/**
 * Airframe-fixed cockpit shell.
 *
 * The cockpit is a small CSS 3D scene, not a flat HUD layer. Head rotation is
 * applied as the inverse camera rotation around the pilot's eye point. Each
 * cockpit surface has a real depth offset, so it translates with perspective
 * parallax instead of simply spinning in place.
 */
import { headShift, variantFor } from './panelVariants';
import { knobAngle, knobDrag, wrapValue } from './knob';

export interface CockpitShell {
  /** Switch the panel to the look of the given aircraft key. */
  setAircraft(key: string): void;
  /** `fovY` (radians) is the 3D camera's current vertical field of view; omit to use raw angles. */
  setHeadPose(yaw: number, pitch: number, fovY?: number): void;
  setFlightReadout(altitude: number, speedKt: number, heading: number): void;
}

/** CSS perspective distance in px; the pilot's eye is this far in front of the screen plane. */
const PERSPECTIVE = 1600;
/** Beyond this the panels are far off-screen anyway; also keeps tan() finite. */
const MAX_PANEL_ANGLE = (83 * Math.PI) / 180;

/**
 * Head angle -> CSS rotation angle. The panels are drawn with a fixed 1600 px perspective while the
 * 3D scene uses the real field of view, so the same head angle would slide them at a different
 * rate. Scaling tan(angle) by pxPerTan / PERSPECTIVE makes a point straight ahead move across the
 * screen by exactly as many pixels as the outside world does.
 */
export function panelAngle(angle: number, pxPerTan: number): number {
  const a = Math.max(-MAX_PANEL_ANGLE, Math.min(MAX_PANEL_ANGLE, angle));
  return Math.atan(Math.tan(a) * (pxPerTan / PERSPECTIVE));
}

export function mountCockpitShell(): CockpitShell {
  const existing = document.getElementById('cockpit-shell');
  if (existing) existing.remove();

  const style = document.createElement('style');
  style.dataset.cockpitShell = 'true';
  style.textContent = `
    #cockpit-shell {
      --cp-accent:#a8ffc9; --cp-body:#0b1410; --cp-trim:#53645b;
      position:fixed; inset:0; z-index:5; pointer-events:none;
      perspective:${PERSPECTIVE}px; perspective-origin:50% 52%; overflow:hidden;
    }
    #cockpit-airframe {
      position:absolute; inset:0; transform-style:preserve-3d;
      /* The eye sits at the perspective distance: the cockpit counter-rotates about it. */
      transform-origin:50% 52% ${PERSPECTIVE}px;
      /* Head pose = yaw first, then pitch about the turned head. The cockpit applies the same two
         rotations to its points in that order (the rightmost function acts first), about the eye. */
      /* The eye sits ahead of the neck pivot, so turning the head also slides the cockpit sideways
         (--head-x/--head-y): the panel is a solid object fixed to the aircraft, not a flat sticker. */
      transform:translate3d(var(--head-x,0px),var(--head-y,0px),0) rotateX(var(--head-pitch,0rad)) rotateY(var(--head-yaw,0rad));
      will-change:transform;
    }
    .canopy-post {
      position:absolute; top:-8%; bottom:17%; width:clamp(12px,2.3vw,30px);
      background:linear-gradient(90deg,#101b1a,#50615b 38%,#111b19 70%,#050a09);
      border:1px solid #64736b; opacity:.9; box-shadow:0 0 18px #000;
      backface-visibility:hidden;
      /* Canopy structure is farther from the pilot than the instrument panel. */
      transform:translateZ(180px);
    }
    .canopy-post.left { left:clamp(3%,5vw,8%); rotate:0deg; }
    .canopy-post.right { right:clamp(3%,5vw,8%); }
    .canopy-post.left { transform:translateZ(180px) rotateZ(8deg) rotateY(10deg); }
    .canopy-post.right { transform:translateZ(180px) rotateZ(-8deg) rotateY(-10deg); }
    .canopy-arch {
      position:absolute; top:-15%; left:50%; width:75vw; height:34vh;
      transform:translate3d(-50%,0,210px) rotateX(70deg);
      border:clamp(8px,1.2vw,16px) solid #1a2824; border-bottom:0;
      border-radius:50% 50% 0 0; box-shadow:0 0 0 2px #65766b,inset 0 0 20px #000;
      opacity:.82; backface-visibility:hidden;
    }
    #cockpit-console {
      position:absolute; left:50%; bottom:6%; width:min(1040px,94vw);
      height:clamp(205px,32vh,310px);
      /* The nearer console has stronger parallax than the canopy frame. */
      transform:translate3d(-50%,0,300px) rotateX(7deg);
      transform-origin:bottom center;
      border:2px solid var(--cp-trim); border-bottom:0;
      border-radius:42% 42% 0 0 / 18% 18% 0 0;
      background:linear-gradient(180deg,color-mix(in srgb,var(--cp-body) 62%,#7a8f82),color-mix(in srgb,var(--cp-body) 92%,#000) 38%,#030605);
      box-shadow:0 -12px 55px rgba(0,0,0,.65),inset 0 3px 12px rgba(190,220,195,.12);
      pointer-events:auto; color:#c8ead2; backface-visibility:hidden;
    }
    #cockpit-console:before {
      content:""; position:absolute; inset:10px 4% auto; height:1px;
      background:linear-gradient(90deg,transparent,#a2b7a7,transparent);
    }
    .cockpit-label {
      position:absolute; top:7px; left:50%; transform:translateX(-50%);
      font:9px ui-monospace,monospace; letter-spacing:.2em; color:#86a795; white-space:nowrap;
    }
    #cockpit-flight-readout {
      position:absolute; top:24px; left:50%; transform:translateX(-50%);
      font:600 11px ui-monospace,monospace; color:var(--cp-accent); white-space:nowrap;
      text-shadow:0 0 8px rgba(100,255,160,.25);
    }
    .bay { position:absolute; top:44px; bottom:12%; display:flex; flex-direction:column; gap:7px; align-items:center; }
    .bay-left { left:4%; width:26%; }
    .bay-right { right:4%; width:26%; align-items:stretch; }
    .bay-centre { left:50%; width:33%; transform:translateX(-50%); }
    .cockpit-screen {
      position:relative; width:100%; flex:1 1 0; min-height:48px; max-height:98px;
      border:2px solid #0e1a16; border-radius:5px;
      background:radial-gradient(ellipse at 50% 40%,color-mix(in srgb,var(--cp-accent) 22%,#061310),#050f0c 74%);
      box-shadow:inset 0 0 14px #000,0 0 0 1px var(--cp-trim); overflow:hidden;
    }
    .cockpit-screen:before {
      content:""; position:absolute; inset:12% 8%; border:1px solid color-mix(in srgb,var(--cp-accent) 40%,transparent);
      background:linear-gradient(160deg,transparent 47%,color-mix(in srgb,var(--cp-accent) 70%,transparent) 48%,transparent 49%),
        linear-gradient(20deg,transparent 60%,color-mix(in srgb,var(--cp-accent) 25%,transparent) 61%,transparent 62%);
    }
    .cockpit-screen:after { content:attr(data-title); position:absolute; left:8px; bottom:4px; color:var(--cp-accent); font:8px ui-monospace,monospace; letter-spacing:.08em; }
    .dials { display:flex; gap:7px; justify-content:center; }
    .dial { position:relative; width:clamp(34px,5.4vw,56px); aspect-ratio:1; border-radius:50%; border:2px solid var(--cp-trim);
      background:radial-gradient(circle at 50% 40%,#16221d,#040807 75%); box-shadow:inset 0 0 8px #000,0 2px 4px #000; }
    .dial:before { content:""; position:absolute; inset:5px; border-radius:50%;
      background:repeating-conic-gradient(from -135deg,rgba(235,245,238,.8) 0 1.2deg,transparent 1.2deg 27deg); mask:radial-gradient(circle,transparent 62%,#000 64%); -webkit-mask:radial-gradient(circle,transparent 62%,#000 64%); }
    .dial i { position:absolute; left:50%; top:12%; width:2px; height:38%; margin-left:-1px; background:var(--cp-accent); border-radius:1px;
      transform-origin:50% 100%; transform:rotate(var(--needle,-135deg)); box-shadow:0 0 5px var(--cp-accent); }
    .dial span { position:absolute; left:0; right:0; bottom:16%; text-align:center; font:6.5px ui-monospace,monospace; color:#f1f6f1; letter-spacing:.06em; }
    #cockpit-dials[data-count="0"] { display:none; }
    #cockpit-dials[data-count="1"] .dial:nth-child(n+2),#cockpit-dials[data-count="2"] .dial:nth-child(n+3) { display:none; }
    .ap-module { padding:6px 8px 8px; border:1px solid color-mix(in srgb,var(--cp-trim) 80%,#fff); border-radius:6px;
      background:linear-gradient(180deg,rgba(255,255,255,.07),rgba(0,0,0,.35)); box-shadow:inset 0 1px 2px rgba(255,255,255,.14),0 2px 6px #000; }
    .ap-title { align-self:stretch; display:flex; justify-content:center; gap:6px; align-items:center; color:#fff; font:700 8.5px ui-monospace,monospace; letter-spacing:.2em; }
    .ap-title small { font:7.5px "Noto Sans TC",sans-serif; letter-spacing:.12em; color:#e6ece6; }
    .ap-knobs { display:flex; gap:clamp(8px,1.6vw,18px); justify-content:center; }
    .knob-unit { display:flex; flex-direction:column; align-items:center; gap:2px; }
    .knob { position:relative; width:clamp(34px,4.6vw,52px); aspect-ratio:1; border-radius:50%; cursor:grab; touch-action:none; outline:none; }
    .knob:active { cursor:grabbing; }
    .knob:focus-visible { box-shadow:0 0 0 2px var(--cp-accent); }
    .knob:before { content:""; position:absolute; inset:-5px; border-radius:50%;
      background:repeating-conic-gradient(from -135deg,rgba(240,246,240,.85) 0 1.1deg,transparent 1.1deg 27deg);
      mask:conic-gradient(from -135deg,#000 0 270deg,transparent 270deg); -webkit-mask:conic-gradient(from -135deg,#000 0 270deg,transparent 270deg);
      -webkit-mask-composite:source-over; }
    .knob-cap { position:absolute; inset:0; border-radius:50%; transform:rotate(var(--angle,-135deg));
      background:repeating-conic-gradient(#2a332e 0 6deg,#4b5851 6deg 12deg); border:1px solid #98a79d;
      box-shadow:0 3px 5px #000,inset 0 1px 2px rgba(255,255,255,.35); }
    .knob-cap:after { content:""; position:absolute; inset:18%; border-radius:50%; background:radial-gradient(circle at 35% 28%,#d9dfd7,#6d7a71 55%,#1a221d); }
    .knob-cap i { position:absolute; left:50%; top:3px; width:3px; height:30%; margin-left:-1.5px; z-index:1; border-radius:2px; background:#fff; box-shadow:0 0 4px rgba(255,255,255,.7); }
    .knob-label { color:#fff; font:700 7.5px ui-monospace,monospace; letter-spacing:.14em; text-align:center; line-height:1.15; }
    .knob-label small { display:block; font:7px "Noto Sans TC",sans-serif; letter-spacing:.06em; color:#e1e8e1; }
    .knob-unit output { color:var(--cp-accent); font:600 8px ui-monospace,monospace; }
    .ap-switches { display:flex; gap:8px; justify-content:center; }
    .cockpit-switches { display:flex; gap:6px; flex-wrap:wrap; justify-content:center; }
    .bay-right .cockpit-switches { flex-direction:column; flex-wrap:nowrap; }
    .cockpit-switches button,.cockpit-config button {
      border:1px solid #597265; border-radius:4px; padding:7px 9px;
      background:linear-gradient(#243a31,#0b1511); color:#c9f4d5;
      font:600 9px ui-monospace,monospace; cursor:pointer; touch-action:manipulation;
    }
    .cockpit-switches button:active,.cockpit-config button:active { background:#42634f; }
    .cockpit-switches .physical-toggle {
      position:relative; display:grid; grid-template-columns:34px auto auto; align-items:center; gap:8px;
      min-width:0; padding:5px 8px; border:1px solid #77867c; border-radius:3px;
      background:linear-gradient(180deg,#39453f 0%,#151e1a 48%,#080e0c 100%);
      box-shadow:inset 0 1px 2px rgba(255,255,255,.22),0 3px 5px #000;
      color:#f0f5ed; text-align:left;
    }
    .physical-toggle .toggle-track { position:relative; width:30px; height:34px; border:1px solid #65766b; border-radius:3px; background:linear-gradient(90deg,#090e0c,#34423a,#0b100d); box-shadow:inset 0 2px 5px #000; }
    .physical-toggle .toggle-track i { position:absolute; left:10px; top:4px; width:8px; height:23px; border-radius:3px; transform:rotate(-24deg); transform-origin:50% 85%; background:linear-gradient(90deg,#68746d,#e0e5df 45%,#58645c); box-shadow:1px 2px 3px #000; transition:transform .16s ease,top .16s ease; }
    .physical-toggle.is-on .toggle-track i { top:1px; transform:rotate(24deg); }
    .physical-toggle .toggle-caption { display:flex; flex-direction:column; gap:2px; }
    .physical-toggle .toggle-caption b { color:#fff; font:700 10px ui-monospace,monospace; letter-spacing:.16em; }
    .physical-toggle .toggle-caption small { color:#d8e1d9; font:9px "Noto Sans TC",sans-serif; letter-spacing:.05em; }
    .physical-toggle .switch-state { color:#e6a69a; font:700 9px ui-monospace,monospace; }
    .physical-toggle.is-on .switch-state { color:#a8ffc9; text-shadow:0 0 7px #6dff9b; }
    .cockpit-config-panel input[type=range] { appearance:none; height:22px; background:transparent; cursor:pointer; }
    .cockpit-config-panel input[type=range]::-webkit-slider-runnable-track { height:6px; border:1px solid #52665b; border-radius:5px; background:repeating-linear-gradient(90deg,#0b1511 0 8px,#31483a 8px 9px); box-shadow:inset 0 1px 3px #000; }
    .cockpit-config-panel input[type=range]::-webkit-slider-thumb { appearance:none; width:22px; height:22px; margin-top:-9px; border:1px solid #b6c1b8; border-radius:50%; background:radial-gradient(circle at 35% 28%,#eef1e9 0,#87978b 32%,#34433a 65%,#111a15 100%); box-shadow:0 2px 4px #000, inset 0 1px 2px rgba(255,255,255,.5); }
    .cockpit-config-panel input[type=range]::-moz-range-track { height:6px; border:1px solid #52665b; border-radius:5px; background:repeating-linear-gradient(90deg,#0b1511 0 8px,#31483a 8px 9px); }
    .cockpit-config-panel input[type=range]::-moz-range-thumb { width:20px; height:20px; border:1px solid #b6c1b8; border-radius:50%; background:radial-gradient(circle at 35% 28%,#eef1e9 0,#87978b 32%,#34433a 65%,#111a15 100%); box-shadow:0 2px 4px #000; }
    .cockpit-switches button.primary { border-color:#b8a36d; color:#ffe0a0; }
    .cockpit-config { position:relative; display:flex; gap:7px; align-items:center; justify-content:flex-end; }
    .cockpit-config summary {
      list-style:none; cursor:pointer; border:1px solid #597265; border-radius:4px;
      padding:8px 10px; background:#0b1511; color:#bce7c9; font:10px ui-monospace,monospace;
    }
    .cockpit-config summary::-webkit-details-marker { display:none; }
    .cockpit-config-panel {
      position:absolute; right:0; bottom:38px; width:min(340px,88vw); z-index:3; max-height:55vh;
      overflow:auto; padding:12px; border:1px solid #61796a; border-radius:6px;
      background:rgba(3,12,9,.97); box-shadow:0 10px 35px #000;
      color:#d7f2df; font:10px ui-monospace,monospace;
    }
    .cockpit-config-panel h3 { margin:0 0 10px; color:#a8ffc9; font-size:11px; }
    .cockpit-config-panel label {
      display:grid; grid-template-columns:1fr auto; gap:6px; margin:10px 0; align-items:center;
    }
    .cockpit-config-panel input[type=range] {
      grid-column:1/-1; width:100%; accent-color:#8cffaa;
    }
    .cockpit-config-panel output { color:#ffda91; }
    .cockpit-divider { height:1px; background:#294237; margin:12px 0; }
    #cockpit-shell .cockpit-help { display:none;
      position:absolute; left:50%; bottom:10px; transform:translateX(-50%);
      color:rgba(210,235,218,.48); font:8px ui-monospace,monospace; white-space:nowrap;
    }
    #cockpit-shell [data-mode-hide] { display:none; }
    body[data-mode="menu"] #cockpit-shell,body[data-mode="loading"] #cockpit-shell,
    body[data-mode="paused"] #cockpit-shell { display:none; }
    /* Per-aircraft panel layouts (all invented for this game) */
    #cockpit-shell[data-layout="wide"] #cockpit-console { width:min(1120px,98vw); border-radius:18% 18% 0 0 / 10% 10% 0 0; }
    #cockpit-shell[data-layout="twin"] #cockpit-console { width:min(980px,94vw); }
    #cockpit-shell[data-layout="stack"] #cockpit-console { width:min(900px,92vw); border-radius:30% 30% 0 0 / 22% 22% 0 0; transform:translate3d(-50%,0,300px) rotateX(11deg); }
    #cockpit-shell[data-layout="stack"] .bay-left .cockpit-screen { max-height:62px; }
    #cockpit-shell[data-layout="compact"] #cockpit-console { width:min(780px,88vw); border-radius:50% 50% 0 0 / 28% 28% 0 0; }
    #cockpit-shell[data-canopy="bubble"] .canopy-post { width:clamp(8px,1.4vw,18px); opacity:.7; }
    #cockpit-shell[data-canopy="bubble"] .canopy-arch { width:84vw; border-width:clamp(4px,.6vw,8px); }
    #cockpit-shell[data-canopy="heavy"] .canopy-post { width:clamp(18px,3.6vw,46px); opacity:.95; }
    #cockpit-shell[data-canopy="heavy"] .canopy-arch { width:68vw; border-width:clamp(12px,1.8vw,24px); }
    #cockpit-shell[data-canopy="slim"] .canopy-post { width:clamp(6px,1vw,12px); opacity:.6; }
    #cockpit-shell[data-canopy="slim"] .canopy-arch { width:80vw; border-width:clamp(3px,.5vw,6px); opacity:.6; }
    #cockpit-plate { color:var(--cp-accent); }
    body.touch #cockpit-shell #cockpit-console { bottom:-1%; width:100vw; height:clamp(120px,22vh,190px); }
    body.touch .bay { top:34px; bottom:6px; gap:3px; }
    body.touch .cockpit-label { top:6px; font-size:7px; }
    body.touch #cockpit-flight-readout { top:19px; font-size:8px; }
    body.touch .dials,body.touch .cockpit-screen:after,body.touch .cockpit-help { display:none; }
    body.touch .cockpit-screen { min-height:26px; }
    body.touch .knob { width:30px; } body.touch .ap-module { padding:3px 6px 4px; }
    body.touch .cockpit-switches button { padding:5px 5px; font-size:8px; }
    body.touch .cockpit-config summary { padding:5px; font-size:8px; }
    @media(max-width:560px) {
      .canopy-post.left {left:1%;}
      .canopy-post.right {right:1%;}
    }
  `;
  document.head.append(style);

  const shell = document.createElement('div');
  shell.id = 'cockpit-shell';
  shell.innerHTML = `
    <div id="cockpit-airframe">
      <div class="canopy-post left"></div><div class="canopy-post right"></div><div class="canopy-arch"></div>
      <section id="cockpit-console" aria-label="固定式駕駛艙儀表板 Cockpit instrument panel">
        <div class="cockpit-label"><span id="cockpit-plate">GENERIC</span> · 駕駛艙固定儀表</div>
        <div id="cockpit-flight-readout">ALT — m · SPD — kt · HDG —°</div>
        <div class="bay bay-left">
          <div class="cockpit-screen" data-title="FLIGHT DATA"></div>
          <div class="dials" id="cockpit-dials" data-count="2"><div class="dial" id="dial-spd"><i></i><span>SPD</span></div><div class="dial" id="dial-alt"><i></i><span>ALT</span></div><div class="dial" id="dial-hdg"><i></i><span>HDG</span></div></div>
        </div>
        <div class="bay bay-centre ap-module">
          <div class="ap-title"><b>AUTO</b><small>自動駕駛</small><div class="cockpit-switches"><button type="button" data-action="autopilot" class="physical-toggle" aria-pressed="false"><span class="toggle-track"><i></i></span><span class="toggle-caption"><b>SW</b><small>開關</small></span><span class="switch-state">OFF</span></button></div></div>
          <div class="ap-knobs"><div class="knob-unit"><div class="knob" data-knob="ap-alt" role="slider" tabindex="0" aria-label="ALT 高度"><div class="knob-cap"><i></i></div></div><span class="knob-label">ALT<small>高度</small></span><output data-knob-out="ap-alt"></output></div><div class="knob-unit"><div class="knob" data-knob="ap-hdg" role="slider" tabindex="0" aria-label="HDG 航向"><div class="knob-cap"><i></i></div></div><span class="knob-label">HDG<small>航向</small></span><output data-knob-out="ap-hdg"></output></div><div class="knob-unit"><div class="knob" data-knob="ap-thr" role="slider" tabindex="0" aria-label="THR 油門"><div class="knob-cap"><i></i></div></div><span class="knob-label">THR<small>油門</small></span><output data-knob-out="ap-thr"></output></div></div>
        </div>
        <div class="bay bay-right">
          <div class="cockpit-screen" data-title="TARGETS"></div>
          <div class="cockpit-switches">
            <button type="button" data-action="fire" class="primary">STORE / 裝備</button>
            <button type="button" data-action="missile" class="primary">MISSILE / 導彈</button>
            <button type="button" data-action="cannon" class="primary">CANNON / 機炮</button>
            <button type="button" data-action="recenter">CENTER / 回正</button>
            <button type="button" data-action="motion-demo">MOTION / 3D 測試</button>
          </div>
        <details class="cockpit-config">
          <summary>SETTINGS / 設定</summary>
          <div class="cockpit-config-panel">
            <h3>AUTOPILOT / 自動駕駛</h3>
            <label>目標高度 Target altitude <output id="ap-alt-out">3000 m</output><input id="ap-alt" type="range" min="500" max="12000" step="100" value="3000"></label>
            <label>目標航向 Target heading <output id="ap-hdg-out">000°</output><input id="ap-hdg" type="range" min="0" max="359" step="1" value="0"></label>
            <label>巡航油門 Cruise throttle <output id="ap-thr-out">55%</output><input id="ap-thr" type="range" min="20" max="100" step="1" value="55"></label>
            <label>高度反應 Altitude response <output id="ap-alt-gain-out">36%</output><input id="ap-alt-gain" type="range" min="10" max="100" step="1" value="36"></label>
            <label>航向反應 Heading response <output id="ap-hdg-gain-out">44%</output><input id="ap-hdg-gain" type="range" min="10" max="100" step="1" value="44"></label>
            <div class="cockpit-divider"></div>
            <h3>SIM TARGET DISPLAY / 遊戲目標顯示</h3>
            <label>顯示靈敏度 Display sensitivity <output id="lock-sens-out">50%</output><input id="lock-sens" type="range" min="10" max="100" step="1" value="50"></label>
            <label>顯示範圍 Display range <output id="lock-range-out">20 km</output><input id="lock-range" type="range" min="2" max="80" step="1" value="20"></label>
            <p>以上鎖定設定只影響虛構訓練接觸點的介面顯示，不控制現實感測、導引或武器行為。</p>
          </div>
        </details>
        </div>
        <div class="cockpit-help">視角轉動時儀表留在機身上 · Look around; the console stays with the aircraft</div>
      </section>
    </div>`;
  document.body.append(shell);

  const fire = (): void => document.querySelector<HTMLButtonElement>('#cockpit-dashboard [data-fire]')?.click();
  const missile = (): void => { window.dispatchEvent(new Event('cfs:missile-launch')); };
  const cannon = (): void => { window.dispatchEvent(new Event('cfs:cannon-trigger')); };
  const ap = (): void => document.querySelector<HTMLButtonElement>('#cockpit-dashboard [data-autopilot]')?.click();
  shell.querySelector('[data-action="fire"]')?.addEventListener('click', fire);
  shell.querySelector('[data-action="missile"]')?.addEventListener('click', missile);
  shell.querySelector('[data-action="cannon"]')?.addEventListener('click', cannon);
  shell.querySelector('[data-action="autopilot"]')?.addEventListener('click', ap);
  shell.querySelector('[data-action="recenter"]')?.addEventListener('click', () => window.dispatchEvent(new Event('cfs:look-recenter')));
  shell.querySelector('[data-action="motion-demo"]')?.addEventListener('click', () => window.dispatchEvent(new Event('cfs:motion-demo-toggle')));

  const KNOBS: Record<string, { min: number; max: number; step: number; wrap?: boolean; fmt: (v: number) => string }> = {
    'ap-alt': { min: 500, max: 12000, step: 100, fmt: (v) => `${v}m` },
    'ap-hdg': { min: 0, max: 359, step: 1, wrap: true, fmt: (v) => `${String(v).padStart(3, '0')}°` },
    'ap-thr': { min: 20, max: 100, step: 1, fmt: (v) => `${v}%` },
  };
  function syncKnobs(): void {
    for (const [id, k] of Object.entries(KNOBS)) {
      const v = Number(shell.querySelector<HTMLInputElement>(`#${id}`)?.value ?? k.min);
      const el = shell.querySelector<HTMLElement>(`[data-knob="${id}"]`);
      el?.style.setProperty('--angle', `${knobAngle(v, k.min, k.max)}deg`);
      el?.setAttribute('aria-valuenow', String(v));
      const out = shell.querySelector<HTMLElement>(`[data-knob-out="${id}"]`);
      if (out) out.textContent = k.fmt(v);
    }
  }
  const setRange = (id: string, v: number): void => {
    const input = shell.querySelector<HTMLInputElement>(`#${id}`);
    if (!input || input.value === String(v)) return;
    input.value = String(v);
    input.dispatchEvent(new Event('input'));
  };
  shell.querySelectorAll<HTMLElement>('[data-knob]').forEach((el) => {
    const id = el.dataset.knob as string;
    const k = KNOBS[id];
    let drag: { x: number; y: number; start: number; pointer: number } | null = null;
    const current = (): number => Number(shell.querySelector<HTMLInputElement>(`#${id}`)?.value ?? k.min);
    const apply = (raw: number): void => setRange(id, k.wrap ? wrapValue(Math.round(raw), k.min, k.max) : Math.max(k.min, Math.min(k.max, raw)));
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, start: current(), pointer: e.pointerId };
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.pointer) return;
      const delta = e.clientX - drag.x + (drag.y - e.clientY); // right or up = clockwise
      if (k.wrap) apply(Math.round((drag.start + (delta / 200) * 360) / k.step) * k.step);
      else apply(knobDrag(drag.start, delta, k.min, k.max, k.step));
    });
    const end = (): void => { drag = null; };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const dir = e.deltaY < 0 ? 1 : -1;
      apply(current() + dir * k.step * (k.wrap ? 5 : 1));
    }, { passive: false });
    el.addEventListener('keydown', (e) => {
      const dir = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      e.stopPropagation();
      apply(current() + dir * k.step * (e.shiftKey ? 10 : 1));
    });
  });

  const readRange = (id: string): number => Number(shell.querySelector<HTMLInputElement>(`#${id}`)?.value ?? 0);
  const updateOutputs = (): void => {
    const alt = readRange('ap-alt'), hdg = readRange('ap-hdg'), thr = readRange('ap-thr');
    const sens = readRange('lock-sens'), range = readRange('lock-range');
    const altitudeGain = readRange('ap-alt-gain') / 100 * 0.0005;
    const headingGain = readRange('ap-hdg-gain') / 100 * 0.5;
    for (const [id, value] of [
      ['ap-alt-out', `${alt} m`],
      ['ap-hdg-out', `${String(hdg).padStart(3,'0')}°`],
      ['ap-thr-out', `${thr}%`],
      ['ap-alt-gain-out', `${readRange('ap-alt-gain')}%`],
      ['ap-hdg-gain-out', `${readRange('ap-hdg-gain')}%`],
      ['lock-sens-out', `${sens}%`],
      ['lock-range-out', `${range} km`],
    ] as const) {
      const out = shell.querySelector<HTMLOutputElement>(`#${id}`);
      if (out) out.textContent = value;
    }
    syncKnobs();
    window.dispatchEvent(new CustomEvent('cfs:autopilot-config', {
      detail: { targetAltitude: alt, targetHeading: hdg * Math.PI / 180, throttle: thr / 100, altitudeGain, headingGain },
    }));
    window.dispatchEvent(new CustomEvent('cfs:target-display-config', {
      detail: { sensitivity: sens / 100, rangeKm: range },
    }));
  };
  shell.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach((input) => input.addEventListener('input', updateOutputs));
  updateOutputs();

  window.addEventListener('cfs:autopilot-state', (event) => {
    const enabled = Boolean((event as CustomEvent<{ enabled?: boolean }>).detail?.enabled);
    const button = shell.querySelector<HTMLButtonElement>('[data-action="autopilot"]');
    if (button) {
      button.classList.toggle('is-on', enabled);
      button.setAttribute('aria-pressed', String(enabled));
      const state = button.querySelector<HTMLElement>('.switch-state');
      if (state) state.textContent = enabled ? 'ON' : 'OFF';
    }
  });

  let lastYaw = Number.NaN;
  let lastPitch = Number.NaN;
  let lastReadout = "";
  let readoutEl: HTMLElement | null = null;
  const dials = {
    spd: shell.querySelector<HTMLElement>('#dial-spd'),
    alt: shell.querySelector<HTMLElement>('#dial-alt'),
    hdg: shell.querySelector<HTMLElement>('#dial-hdg'),
  };
  const needle = (el: HTMLElement | null, frac: number): void => {
    el?.style.setProperty('--needle', `${-135 + Math.max(0, Math.min(1, frac)) * 270}deg`);
  };
  window.addEventListener('cfs:aircraft', (e) => api.setAircraft(String((e as CustomEvent<string>).detail)));
  let lastShiftX = Number.NaN;
  let lastShiftY = Number.NaN;
  const api: CockpitShell = {
    setAircraft: (key) => {
      const v = variantFor(key);
      shell.dataset.layout = v.layout;
      shell.dataset.canopy = v.canopy;
      shell.dataset.seats = String(v.seats);
      shell.style.setProperty('--cp-accent', v.accent);
      shell.style.setProperty('--cp-body', v.body);
      shell.style.setProperty('--cp-trim', v.trim);
      const plate = shell.querySelector('#cockpit-plate');
      if (plate) plate.textContent = v.seats === 2 ? `${v.plate} · 前後雙座` : v.plate;
      shell.querySelector<HTMLElement>('#cockpit-dials')?.setAttribute('data-count', String(v.dials));
    },
    setHeadPose: (yaw, pitch, fovY) => {
      const sh = headShift(yaw, pitch);
      const sx = Math.round(sh.x * 2) / 2;
      const sy = Math.round(sh.y * 2) / 2;
      if (sx !== lastShiftX || sy !== lastShiftY) {
        lastShiftX = sx;
        lastShiftY = sy;
        const st = document.documentElement.style;
        st.setProperty('--head-x', `${sx}px`);
        st.setProperty('--head-y', `${sy}px`);
      }
      // The cockpit rotates about the pilot's eye (transform-origin z = perspective distance), so
      // everything behind the eye plane (z < PERSPECTIVE) swings the way the outside world does:
      // a rightward look (+yaw) moves the cockpit left, an upward look (+pitch) moves it down.
      // Both CSS angles are therefore positive for a positive head angle.
      // Writing a custom property on <html> invalidates style for the whole document, so skip
      // frames where nothing changed (the common case).
      const pxPerTan = fovY && fovY > 0.05 && fovY < 3 ? window.innerHeight / 2 / Math.tan(fovY / 2) : PERSPECTIVE;
      const cssYaw = panelAngle(yaw, pxPerTan);
      const cssPitch = panelAngle(pitch, pxPerTan);
      if (cssYaw === lastYaw && cssPitch === lastPitch) return;
      lastYaw = cssYaw;
      lastPitch = cssPitch;
      const root = document.documentElement.style;
      root.setProperty('--head-yaw', `${cssYaw}rad`);
      root.setProperty('--head-pitch', `${cssPitch}rad`);
    },
    setFlightReadout: (altitude, speedKt, heading) => {
      readoutEl ??= shell.querySelector<HTMLElement>('#cockpit-flight-readout');
      if (!readoutEl) return;
      const text = `ALT ${Math.round(altitude).toLocaleString()} m · SPD ${Math.round(speedKt)} kt · HDG ${String(Math.round(heading * 180 / Math.PI) % 360).padStart(3, '0')}°`;
      if (text !== lastReadout) {
        lastReadout = text;
        readoutEl.textContent = text;
        needle(dials.spd, speedKt / 1600);
        needle(dials.alt, altitude / 20000);
        needle(dials.hdg, (((heading * 180) / Math.PI) % 360 + 360) % 360 / 360);
      }
    },
  };
  return api;
}
