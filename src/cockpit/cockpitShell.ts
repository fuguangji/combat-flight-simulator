/**
 * Airframe-fixed cockpit shell.
 *
 * The cockpit is a small CSS 3D scene, not a flat HUD layer. Head rotation is
 * applied as the inverse camera rotation around the pilot's eye point. Each
 * cockpit surface has a real depth offset, so it translates with perspective
 * parallax instead of simply spinning in place.
 */
export interface CockpitShell {
  setHeadPose(yaw: number, pitch: number): void;
  setFlightReadout(altitude: number, speedKt: number, heading: number): void;
}

export function mountCockpitShell(): CockpitShell {
  const existing = document.getElementById('cockpit-shell');
  if (existing) existing.remove();

  const style = document.createElement('style');
  style.dataset.cockpitShell = 'true';
  style.textContent = `
    #cockpit-shell {
      position:fixed; inset:0; z-index:5; pointer-events:none;
      perspective:1600px; perspective-origin:50% 52%; overflow:hidden;
    }
    #cockpit-airframe {
      position:absolute; inset:0; transform-style:preserve-3d;
      transform-origin:50% 52%;
      /* The scene counter-rotates around the pilot's eye, not around each panel. */
      transform:rotateY(var(--head-yaw,0rad)) rotateX(var(--head-pitch,0rad));
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
      position:absolute; left:50%; bottom:-3.5%; width:min(1040px,94vw);
      height:clamp(150px,25vh,260px);
      /* The nearer console has stronger parallax than the canopy frame. */
      transform:translate3d(-50%,0,360px) rotateX(7deg);
      transform-origin:bottom center;
      border:2px solid #53645b; border-bottom:0;
      border-radius:42% 42% 0 0 / 18% 18% 0 0;
      background:linear-gradient(180deg,rgba(48,62,56,.94),rgba(9,16,14,.99) 38%,#050908);
      box-shadow:0 -12px 55px rgba(0,0,0,.65),inset 0 3px 12px rgba(190,220,195,.12);
      pointer-events:auto; color:#c8ead2; backface-visibility:hidden;
    }
    #cockpit-console:before {
      content:""; position:absolute; inset:10px 4% auto; height:1px;
      background:linear-gradient(90deg,transparent,#a2b7a7,transparent);
    }
    .cockpit-label {
      position:absolute; top:12px; left:50%; transform:translateX(-50%);
      font:9px ui-monospace,monospace; letter-spacing:.2em; color:#86a795; white-space:nowrap;
    }
    #cockpit-flight-readout {
      position:absolute; top:30px; left:50%; transform:translateX(-50%);
      font:600 11px ui-monospace,monospace; color:#a8ffc9; white-space:nowrap;
      text-shadow:0 0 8px rgba(100,255,160,.25);
    }
    .cockpit-screen {
      position:absolute; top:55px; width:24%; height:clamp(54px,9vh,92px);
      border:2px solid #182d27; border-radius:5px;
      background:radial-gradient(ellipse at 50% 40%,#163c36,#071713 72%);
      box-shadow:inset 0 0 14px #000,0 0 0 1px #65776b; overflow:hidden;
    }
    .cockpit-screen.left { left:12%; }
    .cockpit-screen.right { right:12%; }
    .cockpit-screen:before {
      content:""; position:absolute; inset:12% 8%; border:1px solid rgba(110,255,180,.35);
      background:linear-gradient(160deg,transparent 47%,rgba(105,255,170,.7) 48%,transparent 49%),
        linear-gradient(20deg,transparent 60%,rgba(105,255,170,.25) 61%,transparent 62%);
    }
    .cockpit-screen:after {
      content:"SYS  /  FLIGHT DATA"; position:absolute; left:8px; bottom:5px;
      color:#75dca2; font:8px ui-monospace,monospace; letter-spacing:.08em;
    }
    .cockpit-switches {
      position:absolute; left:50%; top:64%; transform:translateX(-50%);
      display:flex; gap:8px;
    }
    .cockpit-switches button,.cockpit-config button {
      border:1px solid #597265; border-radius:4px; padding:8px 11px;
      background:linear-gradient(#243a31,#0b1511); color:#c9f4d5;
      font:600 10px ui-monospace,monospace; cursor:pointer; touch-action:manipulation;
    }
    .cockpit-switches button:active,.cockpit-config button:active { background:#42634f; }
    .cockpit-switches .physical-toggle {
      position:relative; display:grid; grid-template-columns:34px auto auto; align-items:center; gap:8px;
      min-width:150px; padding:7px 9px; border:1px solid #77867c; border-radius:3px;
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
    .cockpit-config {
      position:absolute; right:4%; bottom:12px; display:flex; gap:7px; align-items:center;
    }
    .cockpit-config summary {
      list-style:none; cursor:pointer; border:1px solid #597265; border-radius:4px;
      padding:8px 10px; background:#0b1511; color:#bce7c9; font:10px ui-monospace,monospace;
    }
    .cockpit-config summary::-webkit-details-marker { display:none; }
    .cockpit-config-panel {
      position:absolute; right:0; bottom:38px; width:min(340px,88vw); max-height:55vh;
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
    #cockpit-shell .cockpit-help {
      position:absolute; left:50%; bottom:10px; transform:translateX(-50%);
      color:rgba(210,235,218,.48); font:8px ui-monospace,monospace; white-space:nowrap;
    }
    #cockpit-shell [data-mode-hide] { display:none; }
    body[data-mode="menu"] #cockpit-shell,body[data-mode="loading"] #cockpit-shell,
    body[data-mode="paused"] #cockpit-shell { display:none; }
    body.touch #cockpit-console { width:100vw; height:clamp(120px,20vh,190px); }
    body.touch .cockpit-screen { top:44px; height:5vh; }
    body.touch .cockpit-label { top:6px; font-size:7px; }
    body.touch #cockpit-flight-readout { top:21px; font-size:8px; }
    body.touch .cockpit-switches { top:59%; gap:4px; }
    body.touch .cockpit-switches button { padding:7px 6px; font-size:8px; }
    body.touch .cockpit-config { right:2%; bottom:6px; }
    body.touch .cockpit-config summary { padding:6px; font-size:8px; }
    @media(max-width:560px) {
      .cockpit-screen { width:22%; }
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
        <div class="cockpit-label">AIRFRAME FIXED CONSOLE / 駕駛艙固定儀表</div>
        <div id="cockpit-flight-readout">ALT — m · SPD — kt · HDG —°</div>
        <div class="cockpit-screen left"></div><div class="cockpit-screen right"></div>
        <div class="cockpit-switches">
          <button type="button" data-action="fire" class="primary">STORE / 裝備</button>
          <button type="button" data-action="missile" class="primary">MISSILE / 導彈</button>
          <button type="button" data-action="autopilot" class="physical-toggle" aria-pressed="false"><span class="toggle-track"><i></i></span><span class="toggle-caption"><b>AUTO</b><small>自動駕駛</small></span><span class="switch-state">OFF</span></button>
          <button type="button" data-action="recenter">CENTER / 回正</button>
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
        <div class="cockpit-help">視角轉動時儀表留在機身上 · Look around; the console stays with the aircraft</div>
      </section>
    </div>`;
  document.body.append(shell);

  const fire = (): void => document.querySelector<HTMLButtonElement>('#cockpit-dashboard [data-fire]')?.click();
  const missile = (): void => window.dispatchEvent(new Event('cfs:missile-launch'));
  const ap = (): void => document.querySelector<HTMLButtonElement>('#cockpit-dashboard [data-autopilot]')?.click();
  shell.querySelector('[data-action="fire"]')?.addEventListener('click', fire);
  shell.querySelector('[data-action="missile"]')?.addEventListener('click', missile);
  shell.querySelector('[data-action="autopilot"]')?.addEventListener('click', ap);
  shell.querySelector('[data-action="recenter"]')?.addEventListener('click', () => window.dispatchEvent(new Event('cfs:look-recenter')));

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
  return {
    setHeadPose: (yaw, pitch) => {
      // Inverse camera pose: a rightward look moves the fixed cockpit left,
      // while an upward look moves the lower console down. CSS perspective
      // supplies the depth-dependent amount of displacement.
      // Writing a custom property on <html> invalidates style for the whole document, so skip
      // frames where the head has not moved (the common case).
      if (yaw === lastYaw && pitch === lastPitch) return;
      lastYaw = yaw;
      lastPitch = pitch;
      const root = document.documentElement.style;
      root.setProperty('--head-yaw', `${-yaw}rad`);
      root.setProperty('--head-pitch', `${-pitch}rad`);
    },
    setFlightReadout: (altitude, speedKt, heading) => {
      readoutEl ??= shell.querySelector<HTMLElement>('#cockpit-flight-readout');
      if (!readoutEl) return;
      const text = `ALT ${Math.round(altitude).toLocaleString()} m · SPD ${Math.round(speedKt)} kt · HDG ${String(Math.round(heading * 180 / Math.PI) % 360).padStart(3, '0')}°`;
      if (text !== lastReadout) {
        lastReadout = text;
        readoutEl.textContent = text;
      }
    },
  };
}
