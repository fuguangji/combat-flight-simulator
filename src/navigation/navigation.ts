import { sampleTerrain, type Biome } from '../terrain/procedural';
import { SITE_MARKERS } from '../world/sites';
/** Lightweight flight navigation display and deterministic infinite-world coordinates. */
export interface NavigationSnapshot { x: number; y: number; z: number; heading: number; speed: number; }
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
  private waypoint: { x: number; z: number } = { ...INITIAL_WAYPOINT };
  /** Only picks the next waypoint; the terrain itself is fixed so the map matches what is rendered. */
  private waypointSeed = 1337;
  private siteIndex = -1;
  private waypointName = '';
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
      #navigation-display button { margin-top:7px; width:100%; padding:6px; border:1px solid rgba(125,255,154,.3); border-radius:3px; background:#10241a; color:#c9f4d5; font:10px ui-monospace,monospace; }
      body.touch #navigation-display { width:min(190px,39vw); padding:6px; font-size:8px; }
      body.touch #navigation-display canvas { height:72px; }
      body[data-show-map="0"] #navigation-display .nav-map { display:none; }
      body[data-show-nav="0"] #navigation-display .nav-info { display:none; }
      body[data-show-map="0"][data-show-nav="0"] #navigation-display { display:none; }
      body[data-mode="menu"] #navigation-display,body[data-mode="loading"] #navigation-display,body[data-mode="paused"] #navigation-display { display:none; }
    `;
    document.head.append(style);
    this.root = document.createElement('div');
    this.root.id = 'navigation-display';
    this.root.innerHTML = `<div class="nav-title"><span>NAV / 導航</span><span>PROC WORLD</span></div><div class="nav-map"><canvas width="320" height="140"></canvas></div><div class="nav-info"><div class="nav-data"><span id="nav-coord">X 0 / Z 0</span><span id="nav-heading">HDG 000°</span><span id="nav-alt">ALT 0 m</span><span id="nav-waypoint">WP 000 km</span></div><div class="nav-buttons"><button type="button" id="nav-next">NEXT WAYPOINT / 下一航點</button><button type="button" id="nav-site">AIRFIELD / 機場・航艦</button></div></div>`;
    document.body.append(this.root);
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
      this.waypoint = { x: site.x, z: site.z };
      this.waypointName = site.name;
      this.publishWaypoint(true);
    });
    window.addEventListener('cfs:flight-snapshot', (event) => this.update((event as CustomEvent<NavigationSnapshot>).detail));
    this.drawMap(0, 0, 0);
    this.publishWaypoint(false);
    // the map was not being drawn while hidden: catch up as soon as it is shown again
    window.addEventListener('cfs:panel-toggle', () => { this.lastMapKey = ''; });
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
      ctx.fillStyle='#f4f7f2';ctx.strokeStyle='#0b1511';ctx.lineWidth=1.5;
      if(site.kind==='airport'){ctx.save();ctx.translate(p.x,p.y);ctx.fillRect(-1.5,-7,3,14);ctx.fillRect(-5,-1.5,10,3);ctx.restore();}
      else{ctx.beginPath();ctx.moveTo(p.x,p.y-6);ctx.lineTo(p.x+5,p.y);ctx.lineTo(p.x,p.y+6);ctx.lineTo(p.x-5,p.y);ctx.closePath();ctx.fill();ctx.stroke();}
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
    const headingDeg = ((Math.round(s.heading*180/Math.PI)%360)+360)%360;
    const distance = Math.hypot(this.waypoint.x-s.x,this.waypoint.z-s.z)/1000;
    const set=(id:string,value:string)=>{let el=this.els.get(id);if(!el){el=this.root.querySelector<HTMLElement>(`#${id}`)??undefined;if(!el)return;this.els.set(id,el);}if(el.textContent!==value)el.textContent=value;};
    set('nav-coord',`X ${Math.round(s.x)} / Z ${Math.round(s.z)}`);
    set('nav-heading',`HDG ${String(headingDeg).padStart(3,'0')}°`);
    set('nav-alt',`ALT ${Math.round(s.y).toLocaleString()} m`);
    set('nav-waypoint',`WP ${distance.toFixed(1)} km${this.waypointName ? ` ${this.waypointName}` : ''}`);
    // The map needs ~200 terrain samples: redraw at 10 Hz and only when the picture would change.
    const now = performance.now();
    const key = `${Math.round(s.x / 40)}|${Math.round(s.z / 40)}|${Math.round(s.heading * 40)}|${this.waypoint.x}|${this.waypoint.z}|${this.waypointName}`;
    if (document.body.dataset.showMap !== '0' && now - this.lastMapMs >= 100 && key !== this.lastMapKey) {
      this.lastMapMs = now;
      this.lastMapKey = key;
      this.drawMap(s.x,s.z,s.heading);
    }
  }
}
