import { sampleTerrain, type Biome } from '../terrain/procedural';
import { SITE_MARKERS, type SiteMarker } from '../world/sites';
import {
  calculateLandingGuidance,
  createLandingApproach,
  landingAdvice,
  nearestLandingSite,
  type LandingApproach,
  type LandingGuidance,
} from './landingGuidance';
/** Lightweight flight navigation display and deterministic infinite-world coordinates. */
export interface NavigationSnapshot { x: number; y: number; z: number; heading: number; speed: number; verticalSpeed: number; }
const BIOME_COLOUR: Record<Biome, string> = {
  water: 'rgba(40,110,150,.55)',
  shore: 'rgba(190,175,120,.40)',
  desert: 'rgba(176,150,96,.32)',
  plain: 'rgba(76,126,72,.22)',
  forest: 'rgba(36,98,52,.40)',
  ridge: 'rgba(130,145,135,.34)',
  snow: 'rgba(225,232,232,.50)',
};
/** Where the first waypoint is, so listeners that start later still know it. */
export const INITIAL_WAYPOINT = { x: 12000, z: -18000 } as const;
export class NavigationDisplay {
  private readonly root: HTMLDivElement;
  private readonly landingGuideRoot: HTMLElement;
  private waypoint: { x: number; z: number } = { ...INITIAL_WAYPOINT };
  /** Only picks the next waypoint; the terrain itself is fixed so the map matches what is rendered. */
  private waypointSeed = 1337;
  private siteIndex = -1;
  private waypointName = '';
  private latestState: NavigationSnapshot | null = null;
  private approach: LandingApproach | null = null;
  private readonly els = new Map<string, HTMLElement>();
  private lastMapMs = -Infinity;
  private lastMapKey = '';
  constructor() {
    const style = document.createElement('style');
    style.textContent = `
      #navigation-display { position:fixed; z-index:6; left:max(12px,env(safe-area-inset-left)); top:calc(max(10px,env(safe-area-inset-top)) + 40px); width:min(245px,32vw); padding:9px 11px; box-sizing:border-box; border:1px solid rgba(125,255,154,.38); border-radius:5px; color:#d9f7e1; background:rgba(0,10,7,.76); backdrop-filter:blur(7px); font:10px ui-monospace,monospace; pointer-events:auto; }
      #navigation-display .nav-title { display:flex; justify-content:space-between; color:#8effae; letter-spacing:.1em; }
      #navigation-display canvas { display:block; width:100%; height:104px; margin:7px 0; border:1px solid rgba(125,255,154,.2); background:#07140f; }
      #navigation-display .nav-data { display:grid; grid-template-columns:1fr 1fr; gap:5px; color:#9fc5ab; }
      #navigation-display .nav-buttons { display:grid; grid-template-columns:1fr 1fr; gap:5px; }
      #navigation-display button { margin-top:7px; width:100%; padding:6px; border:1px solid rgba(125,255,154,.3); border-radius:3px; background:#10241a; color:#c9f4d5; font:10px ui-monospace,monospace; cursor:pointer; }
      #navigation-display button[data-active="true"] { color:#06130a; border-color:#7dff9a; background:#7dff9a; }
      #landing-guidance-ui { position:fixed; z-index:6; top:max(12px,env(safe-area-inset-top)); left:50%; transform:translateX(-50%); width:min(430px,calc(100vw - 32px)); box-sizing:border-box; padding:8px 12px; border:1px solid rgba(125,255,154,.52); border-radius:5px; color:#ddffe6; background:rgba(0,12,8,.82); backdrop-filter:blur(7px); font:10px ui-monospace,Menlo,Consolas,monospace; pointer-events:none; }
      #landing-guidance-ui[hidden] { display:none; }
      #landing-guidance-ui .landing-title { display:flex; justify-content:space-between; gap:10px; color:#7dff9a; font-weight:700; letter-spacing:.08em; }
      #landing-guidance-ui .landing-readouts { display:grid; grid-template-columns:repeat(3,1fr); gap:5px 10px; margin-top:6px; }
      #landing-guidance-ui .landing-advice { margin-top:6px; color:#ffc56b; text-align:center; }
      body.touch #navigation-display { width:min(190px,39vw); padding:6px; font-size:8px; }
      body.touch #navigation-display canvas { height:72px; }
      body.touch #landing-guidance-ui { top:max(8px,env(safe-area-inset-top)); width:min(390px,calc(100vw - 24px)); padding:6px 8px; font-size:8px; }
      body[data-show-map="0"] #navigation-display .nav-map { display:none; }
      body[data-show-nav="0"] #navigation-display .nav-info { display:none; }
      body[data-show-map="0"][data-show-nav="0"] #navigation-display { display:none; }
      body[data-mode="menu"] #navigation-display,body[data-mode="loading"] #navigation-display,body[data-mode="paused"] #navigation-display { display:none; }
      body[data-mode="menu"] #landing-guidance-ui,body[data-mode="loading"] #landing-guidance-ui,body[data-mode="paused"] #landing-guidance-ui { display:none; }
    `;
    document.head.append(style);
    this.root = document.createElement('div');
    this.root.id = 'navigation-display';
    this.root.innerHTML = `<div class="nav-title"><span>NAV / 導航</span><span>PROC WORLD</span></div><div class="nav-map"><canvas width="320" height="140"></canvas></div><div class="nav-info"><div class="nav-data"><span id="nav-coord">X 0 / Z 0</span><span id="nav-heading">HDG 000°</span><span id="nav-alt">ALT 0 m</span><span id="nav-waypoint">WP 000 km</span></div><div class="nav-buttons"><button type="button" id="nav-next">NEXT WAYPOINT / 下一航點</button><button type="button" id="nav-site">AIRFIELD / 機場・航艦</button><button type="button" id="landing-guide-toggle">LANDING GUIDE / 降落導引</button></div></div>`;
    document.body.append(this.root);
    this.landingGuideRoot = document.createElement('aside');
    this.landingGuideRoot.id = 'landing-guidance-ui';
    this.landingGuideRoot.hidden = true;
    this.landingGuideRoot.innerHTML = `
      <div class="landing-title"><span id="landing-site-name">LANDING APPROACH</span><span id="landing-phase">INTERCEPT</span></div>
      <div class="landing-readouts">
        <span id="landing-range"></span><span id="landing-course"></span><span id="landing-heading"></span>
        <span id="landing-localizer"></span><span id="landing-glideslope"></span><span id="landing-speed"></span>
      </div>
      <div class="landing-advice" id="landing-advice"></div>
    `;
    document.body.append(this.landingGuideRoot);
    this.root.querySelector('#nav-next')?.addEventListener('click', () => {
      this.waypointSeed = (this.waypointSeed + 7919) >>> 0;
      const angle = ((this.waypointSeed % 360) * Math.PI) / 180;
      const radius = 8000 + (this.waypointSeed % 12000);
      this.waypoint = { x: Math.sin(angle) * radius, z: -Math.cos(angle) * radius };
      this.waypointName = '';
      this.publishWaypoint(true);
    });
    // Cycle the waypoint through the airports and the carrier (landing sites).
    this.root.querySelector('#nav-site')?.addEventListener('click', () => {
      this.siteIndex = (this.siteIndex + 1) % SITE_MARKERS.length;
      const site = SITE_MARKERS[this.siteIndex];
      this.selectSite(site, this.approach !== null);
    });
    this.root.querySelector('#landing-guide-toggle')?.addEventListener('click', () => {
      if (this.approach) {
        this.setApproach(null);
        const site = SITE_MARKERS[this.siteIndex];
        if (site) {
          this.waypoint = { x: site.x, z: site.z };
          this.waypointName = site.name;
          this.publishWaypoint(true);
        }
      } else {
        const state = this.latestState;
        if (!state) return;
        const site = SITE_MARKERS[this.siteIndex] ?? nearestLandingSite([state.x, state.y, state.z]);
        this.siteIndex = SITE_MARKERS.findIndex((item) => item.id === site.id);
        this.selectSite(site, true);
      }
    });
    window.addEventListener('cfs:landing-site-select', (event) => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      const site = SITE_MARKERS.find((item) => item.id === id);
      if (site) {
        this.siteIndex = SITE_MARKERS.findIndex((item) => item.id === site.id);
        this.selectSite(site, true);
      }
    });
    window.addEventListener('cfs:flight-start', () => this.setApproach(null));
    window.addEventListener('cfs:flight-snapshot', (event) => this.update((event as CustomEvent<NavigationSnapshot>).detail));
    this.drawMap(0, 0, 0);
    this.publishWaypoint(false);
    // the map was not being drawn while hidden: catch up as soon as it is shown again
    window.addEventListener('cfs:panel-toggle', () => { this.lastMapKey = ''; });
  }
  private selectSite(site: SiteMarker, enableApproach: boolean): void {
    this.siteIndex = SITE_MARKERS.findIndex((item) => item.id === site.id);
    const siteButton = this.root.querySelector<HTMLButtonElement>('#nav-site');
    if (siteButton) {
      const side = site.faction === 'friendly' ? '友軍' : '敵軍';
      const threat = site.strikeCapable ? ' · 具打擊能力' : site.threat === 'elevated' ? ' · 高威脅' : '';
      siteButton.textContent = `${side} · ${site.name}${threat}`;
      siteButton.title = `${site.kind === 'carrier' ? '航艦' : '機場'} · ${side}${threat}`;
    }
    if (enableApproach && this.latestState) {
      const state = this.latestState;
      const approach = createLandingApproach(site, [state.x, state.y, state.z], state.heading);
      this.setApproach(approach);
      this.waypoint = { x: approach.entryX, z: approach.entryZ };
      this.waypointName = `${site.name} FINAL`;
    } else {
      this.setApproach(null);
      this.waypoint = { x: site.x, z: site.z };
      this.waypointName = site.name;
    }
    this.publishWaypoint(true);
    this.lastMapKey = '';
  }

  private setApproach(approach: LandingApproach | null): void {
    this.approach = approach;
    const button = this.root.querySelector<HTMLButtonElement>('#landing-guide-toggle');
    if (button) {
      button.dataset.active = String(approach !== null);
      button.textContent = approach ? 'LANDING GUIDE / ON' : 'LANDING GUIDE / 降落導引';
    }
    if (!approach) {
      this.landingGuideRoot.hidden = true;
      window.dispatchEvent(new CustomEvent('cfs:landing-guidance', { detail: null }));
      window.dispatchEvent(new CustomEvent('cfs:landing-approach-state', { detail: { active: false, siteId: null } }));
      return;
    }
    window.dispatchEvent(new CustomEvent('cfs:landing-approach-state', {
      detail: { active: true, siteId: approach.site.id },
    }));
    this.updateLandingGuide();
  }

  private updateLandingGuide(): void {
    const approach = this.approach;
    const state = this.latestState;
    if (!approach || !state) return;
    const guidance = calculateLandingGuidance(approach, {
      position: [state.x, state.y, state.z],
      heading: state.heading,
      altitude: state.y,
      speed: state.speed,
      verticalSpeed: state.verticalSpeed,
    });
    const heading = (radians: number): string =>
      `${String(((Math.round(radians * 180 / Math.PI) % 360) + 360) % 360).padStart(3, '0')}°`;
    const headingDelta = `${guidance.headingError >= 0 ? '+' : ''}${Math.round(guidance.headingError * 180 / Math.PI)}°`;
    const signed = (value: number): string => `${value >= 0 ? '+' : ''}${Math.round(value)} m`;
    const set = (id: string, value: string): void => {
      const el = this.landingGuideRoot.querySelector<HTMLElement>(`#${id}`);
      if (el && el.textContent !== value) el.textContent = value;
    };
    const loc = Math.abs(guidance.lateralError) <= 35
      ? 'LOC CENTER'
      : `LOC ${guidance.lateralError > 0 ? 'LEFT' : 'RIGHT'} ${Math.round(Math.abs(guidance.lateralError))} m`;
    const glide = Math.abs(guidance.glideError) <= 25
      ? `G/S ON · ${Math.round(guidance.targetAltitude)} m`
      : `G/S ${guidance.glideError > 0 ? 'HIGH' : 'LOW'} ${signed(guidance.glideError)}`;
    set('landing-site-name', `APPROACH · ${approach.site.name}`);
    set('landing-phase', guidance.phase);
    set('landing-range', `THR ${(guidance.distanceToThreshold / 1000).toFixed(1)} km`);
    set('landing-course', `COURSE ${heading(guidance.course)}`);
    set('landing-heading', `HDG ${heading(state.heading)} · Δ${headingDelta}`);
    set('landing-localizer', loc);
    set('landing-glideslope', glide);
    set('landing-speed', `${Math.round(guidance.speed * 1.943844)} KT · VS ${Math.round(guidance.verticalSpeed)} m/s`);
    set('landing-advice', landingAdvice(guidance));
    this.landingGuideRoot.hidden = false;
    window.dispatchEvent(new CustomEvent<LandingGuidance>('cfs:landing-guidance', { detail: guidance }));
  }

  /** Lets the tutorial (and anything else) follow the active waypoint. */
  private publishWaypoint(changed: boolean): void {
    window.dispatchEvent(new CustomEvent('cfs:waypoint', { detail: { x: this.waypoint.x, z: this.waypoint.z, changed } }));
  }
  private drawMap(x: number, z: number, heading: number): void {
    const canvas = this.root.querySelector('canvas');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0,0,w,h);
    ctx.strokeStyle = 'rgba(125,255,154,.12)'; ctx.lineWidth = 1;
    for(let gx=0;gx<=w;gx+=32){ctx.beginPath();ctx.moveTo(gx,0);ctx.lineTo(gx,h);ctx.stroke();}
    for(let gy=0;gy<=h;gy+=28){ctx.beginPath();ctx.moveTo(0,gy);ctx.lineTo(w,gy);ctx.stroke();}
    // The map samples the same deterministic world field used by the terrain system.
    for(let gy=0;gy<10;gy++) for(let gx=0;gx<20;gx++) {
      const wx=x+(gx-10)*1200, wz=z+(gy-5)*1200;
      ctx.fillStyle=BIOME_COLOUR[sampleTerrain(wx,wz).biome];
      ctx.fillRect(gx*16,gy*14,16,14);
    }
    const hash=(a:number,b:number)=>{const v=Math.sin(a*127.1+b*311.7)*43758.5453;return v-Math.floor(v);};
    for(let i=0;i<26;i++){
      const tx=(hash(i,Math.floor(x/4000))*w), ty=(hash(i+9,Math.floor(z/4000))*h);
      const r=4+hash(i+2,3)*12;
      ctx.fillStyle='rgba(72,120,84,.18)';ctx.beginPath();ctx.ellipse(tx,ty,r*1.5,r,0,0,Math.PI*2);ctx.fill();
    }
    const cx=w/2,cy=h/2;
    // North-up map: 1200 m per 16 x 14 px tile, the same tiling as the terrain samples above.
    const toMap=(wx:number,wz:number)=>({x:cx+(wx-x)/75,y:cy+(wz-z)/85.7});
    for(const site of SITE_MARKERS){
      const p=toMap(site.x,site.z);
      if(p.x<-8||p.x>w+8||p.y<-8||p.y>h+8)continue;
      ctx.fillStyle=site.faction==='friendly'?'#7dff9a':'#ff7777';ctx.strokeStyle='#0b1511';ctx.lineWidth=1.5;
      if(site.kind==='airport'){ctx.save();ctx.translate(p.x,p.y);ctx.fillRect(-1.5,-7,3,14);ctx.fillRect(-5,-1.5,10,3);ctx.restore();}
      else{ctx.beginPath();ctx.moveTo(p.x,p.y-6);ctx.lineTo(p.x+5,p.y);ctx.lineTo(p.x,p.y+6);ctx.lineTo(p.x-5,p.y);ctx.closePath();ctx.fill();ctx.stroke();}
    }
    if (this.approach) {
      const entry = toMap(this.approach.entryX, this.approach.entryZ);
      const threshold = toMap(this.approach.thresholdX, this.approach.thresholdZ);
      ctx.strokeStyle = '#7dff9a';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(entry.x, entry.y); ctx.lineTo(threshold.x, threshold.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#7dff9a';
      ctx.beginPath(); ctx.arc(threshold.x, threshold.y, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    const wp=toMap(this.waypoint.x,this.waypoint.z);
    const px=Math.max(6,Math.min(w-6,wp.x)), py=Math.max(6,Math.min(h-6,wp.y));
    ctx.strokeStyle='#ffc56b';ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(px,py);ctx.stroke();ctx.setLineDash([]);
    ctx.save();ctx.translate(cx,cy);ctx.rotate(heading);
    ctx.fillStyle='#a8ffc9';ctx.beginPath();ctx.moveTo(0,-9);ctx.lineTo(-6,7);ctx.lineTo(6,7);ctx.closePath();ctx.fill();
    ctx.restore();
    ctx.fillStyle='#ffc56b';ctx.beginPath();ctx.arc(px,py,5,0,Math.PI*2);ctx.fill();
  }
  private update(s: NavigationSnapshot): void {
    this.latestState = s;
    this.updateLandingGuide();
    const headingDeg = ((Math.round(s.heading*180/Math.PI)%360)+360)%360;
    const distance = Math.hypot(this.waypoint.x-s.x,this.waypoint.z-s.z)/1000;
    const set=(id:string,value:string)=>{let el=this.els.get(id);if(!el){el=this.root.querySelector<HTMLElement>(`#${id}`)??undefined;if(!el)return;this.els.set(id,el);}if(el.textContent!==value)el.textContent=value;};
    set('nav-coord',`X ${Math.round(s.x)} / Z ${Math.round(s.z)}`);
    set('nav-heading',`HDG ${String(headingDeg).padStart(3,'0')}°`);
    set('nav-alt',`ALT ${Math.round(s.y).toLocaleString()} m`);
    set('nav-waypoint',`WP ${distance.toFixed(1)} km${this.waypointName ? ` ${this.waypointName}` : ''}`);
    // The map needs ~200 terrain samples: redraw at 10 Hz and only when the picture would change.
    const now = performance.now();
    const key = `${Math.round(s.x / 40)}|${Math.round(s.z / 40)}|${Math.round(s.heading * 40)}|${this.waypoint.x}|${this.waypoint.z}|${this.waypointName}|${this.approach?.site.id ?? ''}`;
    if (now - this.lastMapMs >= 100 && key !== this.lastMapKey) {
      this.lastMapMs = now;
      this.lastMapKey = key;
      this.drawMap(s.x,s.z,s.heading);
    }
  }
}
