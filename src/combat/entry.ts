import { ArcadeProjectileSystem } from './arcadeProjectiles';

const style = document.createElement('style');
style.textContent = `
  #projectile-effects {
    position: fixed; inset: 0; z-index: 3; pointer-events: none;
  }
  #equipment-status {
    position: fixed; right: max(18px, env(safe-area-inset-right));
    bottom: max(18px, env(safe-area-inset-bottom)); z-index: 4;
    padding: 7px 10px; border: 1px solid rgba(125,255,154,.35);
    border-radius: 4px; color: #7dff9a; background: rgba(0,10,7,.58);
    font: 12px ui-monospace, Menlo, Consolas, monospace;
    letter-spacing: .06em; pointer-events: none; backdrop-filter: blur(5px);
  }
  #equipment-status[data-state="busy"] { color: #ffc56b; border-color: rgba(255,197,107,.4); }
  body.touch #equipment-status { bottom: max(14px, env(safe-area-inset-bottom)); right: 14px; font-size: 10px; }
  body[data-mode="menu"] #equipment-status,
  body[data-mode="loading"] #equipment-status { display: none; }
`;
document.head.append(style);
new ArcadeProjectileSystem();
