/**
 * Show / hide switches for the map, the navigation read-out and the radar contact list, so none of
 * them has to cover the view. State lives on <body> (`data-show-map|nav|radar` = "0" | "1"), which
 * the panels' CSS reads; it is remembered between sessions.
 */
export type PanelId = 'map' | 'nav' | 'radar';

export const PANELS: readonly { id: PanelId; key: string; code: string; label: string; en: string }[] = [
  { id: 'map', key: 'M', code: 'KeyM', label: '地圖', en: 'MAP' },
  { id: 'nav', key: 'V', code: 'KeyV', label: '導航', en: 'NAV' },
  { id: 'radar', key: 'B', code: 'KeyB', label: '雷達', en: 'RADAR' },
];

const STORAGE_KEY = 'cfs.panels.v1';

/** Parse a stored state; anything unreadable falls back to "all hidden". */
export function parsePanelState(raw: string | null): Record<PanelId, boolean> {
  const state: Record<PanelId, boolean> = { map: false, nav: false, radar: false };
  if (!raw) return state;
  try {
    const o = JSON.parse(raw) as Partial<Record<PanelId, unknown>>;
    for (const p of PANELS) state[p.id] = o[p.id] === true;
  } catch {
    /* ignore corrupt data */
  }
  return state;
}

export class PanelToggles {
  private state: Record<PanelId, boolean>;
  private readonly root: HTMLDivElement;
  private readonly buttons = new Map<PanelId, HTMLButtonElement>();

  constructor() {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      /* storage may be blocked */
    }
    this.state = parsePanelState(raw);

    const style = document.createElement('style');
    style.textContent = `
      #panel-toggles { position:fixed; z-index:9; left:max(12px,env(safe-area-inset-left)); top:max(10px,env(safe-area-inset-top)); display:flex; gap:6px; pointer-events:auto; }
      #panel-toggles button { min-height:30px; padding:4px 9px; border:1px solid rgba(125,255,154,.32); border-radius:4px; color:#9fc5ab; background:rgba(0,10,7,.62); font:600 10px ui-monospace,monospace; letter-spacing:.06em; cursor:pointer; touch-action:manipulation; }
      #panel-toggles button kbd { margin-left:5px; padding:0 3px; border:1px solid rgba(125,255,154,.3); border-radius:2px; font:inherit; opacity:.7; }
      #panel-toggles button[aria-pressed="true"] { color:#06130a; background:#7dff9a; border-color:#7dff9a; }
      body.touch #panel-toggles button { min-height:36px; padding:4px 12px; }
      body.touch #panel-toggles kbd { display:none; }
      body[data-mode="menu"] #panel-toggles, body[data-mode="loading"] #panel-toggles, body[data-mode="paused"] #panel-toggles { display:none; }
      body[data-show-radar="0"] #contact-status { display:none; }
    `;
    document.head.append(style);

    this.root = document.createElement('div');
    this.root.id = 'panel-toggles';
    this.root.setAttribute('role', 'toolbar');
    this.root.setAttribute('aria-label', '顯示面板開關');
    for (const p of PANELS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.title = `${p.label} ${p.en}（${p.key}）`;
      b.innerHTML = `${p.label}<kbd>${p.key}</kbd>`;
      b.addEventListener('click', () => this.toggle(p.id));
      this.buttons.set(p.id, b);
      this.root.append(b);
    }
    document.body.append(this.root);
    window.addEventListener('keydown', (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const p = PANELS.find((x) => x.code === e.code);
      if (p) this.toggle(p.id);
    });
    // Tutorial / other modules can ask for a panel to be shown.
    window.addEventListener('cfs:panel-set', (e) => {
      const d = (e as CustomEvent<{ panel: PanelId; on: boolean }>).detail;
      if (d && PANELS.some((p) => p.id === d.panel)) this.set(d.panel, d.on);
    });
    this.apply(false);
  }

  isOn(id: PanelId): boolean {
    return this.state[id];
  }

  toggle(id: PanelId): void {
    this.set(id, !this.state[id]);
  }

  set(id: PanelId, on: boolean): void {
    if (this.state[id] === on) return;
    this.state[id] = on;
    this.apply(true, id);
  }

  private apply(persist: boolean, changed?: PanelId): void {
    for (const p of PANELS) {
      document.body.dataset[`show${p.id[0].toUpperCase()}${p.id.slice(1)}`] = this.state[p.id] ? '1' : '0';
      this.buttons.get(p.id)?.setAttribute('aria-pressed', String(this.state[p.id]));
    }
    if (persist) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      } catch {
        /* ignore */
      }
    }
    if (changed) window.dispatchEvent(new CustomEvent('cfs:panel-toggle', { detail: { panel: changed, on: this.state[changed] } }));
  }
}
