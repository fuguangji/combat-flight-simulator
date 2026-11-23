import { ArcadeProjectileSystem } from './arcadeProjectiles';

const style = document.createElement('style');
style.textContent = `
  #projectile-effects { position: fixed; inset: 0; z-index: 3; pointer-events: none; }
  #equipment-status { position: fixed; right: max(18px, env(safe-area-inset-right)); bottom: max(18px, env(safe-area-inset-bottom)); z-index: 4; padding: 7px 10px; border: 1px solid color-mix(in srgb, var(--equipment-color, #7dff9a) 40%, transparent); border-radius: 4px; color: var(--equipment-color, #7dff9a); background: rgba(0,10,7,.68); font: 12px ui-monospace, Menlo, Consolas, monospace; letter-spacing: .06em; pointer-events: none; backdrop-filter: blur(5px); }
  #equipment-status[data-state="busy"] { color: #ffc56b; }
  #contact-status { position: fixed; top: max(14px, env(safe-area-inset-top)); right: max(14px, env(safe-area-inset-right)); z-index: 5; width: min(310px, calc(100vw - 28px)); box-sizing: border-box; padding: 10px 12px; color: #d9f7e1; background: rgba(0,10,7,.78); border: 1px solid rgba(125,255,154,.35); border-radius: 5px; font: 11px ui-monospace, Menlo, Consolas, monospace; letter-spacing: .04em; backdrop-filter: blur(7px); pointer-events: auto; }
  #contact-status .combat-head, #contact-status .combat-focus { display: flex; justify-content: space-between; gap: 10px; }
  #contact-status .combat-head { color: #7dff9a; font-size: 10px; letter-spacing: .1em; }
  #contact-status .combat-section { margin-top: 10px; }
  #contact-status small { display: block; margin-bottom: 5px; color: rgba(210,245,220,.55); font-size: 9px; }
  #contact-status .combat-actions, #contact-status .contact-actions { display: flex; gap: 5px; }
  #contact-status button { flex: 1; min-width: 0; padding: 7px 4px; border: 1px solid rgba(125,255,154,.25); border-radius: 3px; color: #b8d9c0; background: rgba(125,255,154,.05); font: 10px ui-monospace, Menlo, Consolas, monospace; cursor: pointer; }
  #contact-status button[data-active="true"] { color: #07150b; background: #7dff9a; border-color: #7dff9a; }
  #contact-status .combat-focus { margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(125,255,154,.2); }
  #contact-status #focus-state { color: #ffc56b; }
  #contact-status[data-focused="true"] #focus-state { color: #7dff9a; }
  #contact-status .combat-hint { margin-top: 8px; color: rgba(210,245,220,.48); font-size: 9px; }
  body.touch #contact-status { top: max(10px, env(safe-area-inset-top)); right: max(10px, env(safe-area-inset-right)); width: min(270px, 48vw); padding: 7px 8px; }
  body.touch #contact-status .combat-hint { display: none; }
  body[data-mode="menu"] #equipment-status, body[data-mode="loading"] #equipment-status, body[data-mode="menu"] #contact-status, body[data-mode="loading"] #contact-status { display: none; }
`;
document.head.append(style);
new ArcadeProjectileSystem();
