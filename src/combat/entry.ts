import { ArcadeProjectileSystem } from './arcadeProjectiles';

const style = document.createElement('style');
style.textContent = `
  #projectile-effects { position: fixed; inset: 0; z-index: 3; pointer-events: none; }
  #cockpit-dashboard { display:block;
    position: fixed; left: 50%; bottom: max(14px, env(safe-area-inset-bottom)); transform: translateX(-50%);
    z-index: 8; width: min(430px, calc(100vw - 28px)); box-sizing: border-box; padding: 9px 12px;
    border: 1px solid color-mix(in srgb, var(--equipment-color, #7dff9a) 48%, transparent);
    border-radius: 5px; color: #d9f7e1; background: rgba(0,10,7,.84);
    font: 11px ui-monospace, Menlo, Consolas, monospace; letter-spacing: .045em;
    backdrop-filter: blur(8px); pointer-events: auto;
  }
  #cockpit-dashboard .dashboard-heading { display:flex; justify-content:space-between; color:#7dff9a; font-size:9px; letter-spacing:.12em; }
  #cockpit-dashboard .dashboard-readout { margin:7px 0; color:var(--equipment-color,#ffc56b); font-weight:700; }
  #cockpit-dashboard .dashboard-controls { display:flex; gap:8px; }
  #cockpit-dashboard button { flex:1; min-height:38px; border:1px solid rgba(125,255,154,.4); border-radius:3px; color:#e6fff0; background:rgba(125,255,154,.09); font:600 12px ui-monospace,Menlo,Consolas,monospace; cursor:pointer; touch-action:manipulation; }
  #cockpit-dashboard button:disabled,#contact-status button:disabled { opacity:.45; cursor:not-allowed; }
  #cockpit-dashboard button[data-active="true"] { color:#06130a; background:#7dff9a; }
  #cockpit-dashboard button[data-fire] { color:#171006; background:#ffc56b; border-color:#ffc56b; }
  #cockpit-dashboard .dashboard-note { margin-top:6px; color:rgba(210,245,220,.68); font-size:9px; text-align:center; }
  #cockpit-dashboard[data-state="busy"] .dashboard-readout { color:#ffc56b; }
  #contact-status { position:fixed; top:max(14px,env(safe-area-inset-top)); right:max(14px,env(safe-area-inset-right)); z-index:7; width:min(290px,calc(100vw - 28px)); box-sizing:border-box; padding:10px 12px; color:#d9f7e1; background:rgba(0,10,7,.82); border:1px solid rgba(125,255,154,.35); border-radius:5px; font:11px ui-monospace,Menlo,Consolas,monospace; letter-spacing:.04em; backdrop-filter:blur(7px); pointer-events:auto; }
  #contact-status .combat-head,#contact-status .combat-focus { display:flex; justify-content:space-between; gap:10px; }
  #contact-status .combat-head { color:#7dff9a; font-size:10px; letter-spacing:.1em; }
  #combat-radar { display:block; width:160px; height:160px; margin:8px auto 4px; border:1px solid rgba(125,255,154,.2); border-radius:50%; background:rgba(5,20,13,.72); }
  #contact-status .combat-section { margin-top:10px; }
  #contact-status small { display:block; margin-bottom:5px; color:rgba(210,245,220,.55); font-size:9px; }
  #contact-status .contact-actions { display:flex; gap:5px; }
  #contact-status button { flex:1; min-width:0; padding:7px 4px; border:1px solid rgba(125,255,154,.25); border-radius:3px; color:#b8d9c0; background:rgba(125,255,154,.05); font:10px ui-monospace,Menlo,Consolas,monospace; cursor:pointer; }
  #contact-status button[data-active="true"] { color:#07150b; background:#7dff9a; border-color:#7dff9a; }
  #contact-status button[data-destroyed="true"] { opacity:.35; text-decoration:line-through; }
  #contact-status .combat-focus { margin-top:10px; padding-top:8px; border-top:1px solid rgba(125,255,154,.2); }
  #contact-status #focus-state { color:#ffc56b; }
  #contact-status[data-focused="true"] #focus-state { color:#7dff9a; }
  #contact-status .combat-hint { margin-top:8px; color:rgba(210,245,220,.48); font-size:9px; }
  #view-reticle { position:fixed; left:50%; top:50%; width:22px; height:22px; margin:-11px 0 0 -11px; z-index:6; pointer-events:none; }
  #view-reticle i,#view-reticle b { position:absolute; display:block; background:rgba(255,255,255,.92); box-shadow:0 0 3px rgba(0,0,0,.9); }
  #view-reticle i { left:10px; top:2px; width:2px; height:18px; }
  #view-reticle b { left:2px; top:10px; width:18px; height:2px; }
  body.touch #contact-status { top:max(8px,env(safe-area-inset-top)); right:max(8px,env(safe-area-inset-right)); width:min(250px,47vw); padding:7px 8px; }
  body.touch #combat-radar { width:110px; height:110px; }
  body.touch #contact-status .combat-hint { display:none; }
  body.touch #cockpit-dashboard { bottom:max(8px,env(safe-area-inset-bottom)); width:min(380px,calc(100vw - 20px)); padding:7px 9px; }
  body.touch #cockpit-dashboard button { min-height:42px; }
  body[data-mode="menu"] #cockpit-dashboard, body[data-mode="loading"] #cockpit-dashboard,
  body[data-mode="menu"] #contact-status, body[data-mode="loading"] #contact-status,
  body[data-mode="menu"] #view-reticle, body[data-mode="loading"] #view-reticle { display:none; }
  body[data-mode="paused"] #cockpit-dashboard, body[data-mode="paused"] #contact-status, body[data-mode="paused"] #view-reticle { display:none; }
`;
document.head.append(style);
new ArcadeProjectileSystem();
