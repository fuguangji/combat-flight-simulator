/** Lightweight flight navigation display and deterministic infinite-world coordinates. */
export interface NavigationSnapshot { x: number; y: number; z: number; heading: number; speed: number; }
export class NavigationDisplay {
  private readonly root: HTMLDivElement;
  private waypoint = { x: 12000, z: -18000 };
  private seed = 1337;
  constructor() {
    const style = document.createElement('style');
    style.textContent = `
      #navigation-display { position:fixed; z-index:6; left:max(12px,env(safe-area-inset-left)); top:max(12px,env(safe-area-inset-top)); width:min(245px,32vw); padding:9px 11px; box-sizing:border-box; border:1px solid rgba(125,255,154,.38); border-radius:5px; color:#d9f7e1; background:rgba(0,10,7,.76); backdrop-filter:blur(7px); font:10px ui-monospace,monospace; pointer-events:auto; }
      #navigation-display .nav-title { display:flex; justify-content:space-between; color:#8effae; letter-spacing:.1em; }
      #navigation-display canvas { display:block; width:100%; height:104px; margin:7px 0; border:1px solid rgba(125,255,154,.2); background:#07140f; }
      #navigation-display .nav-data { display:grid; grid-template-columns:1fr 1fr; gap:5px; color:#9fc5ab; }
      #navigation-display button { margin-top:7px; width:100%; padding:6px; border:1px solid rgba(125,255,154,.3); border-radius:3px; background:#10241a; color:#c9f4d5; font:10px ui-monospace,monospace; }
      body.touch #navigation-display { width:min(190px,39vw); padding:6px; font-size:8px; }
      body.touch #navigation-display canvas { height:72px; }
      body[data-mode="menu"] #navigation-display,body[data-mode="loading"] #navigation-display,body[data-mode="paused"] #navigation-display { display:none; }
    `;
    document.head.append(style);
    this.root = document.createElement('div');
    this.root.id = 'navigation-display';
    this.root.innerHTML = `<div class="nav-title"><span>NAV / 導航</span><span>PROC WORLD</span></div><canvas width="320" height="140"></canvas><div class="nav-data"><span id="nav-coord">X 0 / Z 0</span><span id="nav-heading">HDG 000°</span><span id="nav-alt">ALT 0 m</span><span id="nav-waypoint">WP 000 km</span></div><button type="button" id="nav-next">NEXT WAYPOINT / 下一航點</button>`;
    document.body.append(this.root);
    this.root.querySelector('#nav-next')?.addEventListener('click', () => {
      this.seed = (this.seed + 7919) >>> 0;
      const angle = ((this.seed % 360) * Math.PI) / 180;
      const radius = 8000 + (this.seed % 12000);
      this.waypoint = { x: Math.sin(angle) * radius, z: -Math.cos(angle) * radius };
    });
    window.addEventListener('cfs:flight-snapshot', (event) => this.update((event as CustomEvent<NavigationSnapshot>).detail));
    this.drawMap(0, 0, 0);
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
    const hash=(a:number,b:number)=>{const v=Math.sin(a*127.1+b*311.7)*43758.5453;return v-Math.floor(v);};
    for(let i=0;i<26;i++){
      const tx=(hash(i,Math.floor(x/4000))*w), ty=(hash(i+9,Math.floor(z/4000))*h);
      const r=4+hash(i+2,3)*12;
      ctx.fillStyle='rgba(72,120,84,.18)';ctx.beginPath();ctx.ellipse(tx,ty,r*1.5,r,0,0,Math.PI*2);ctx.fill();
    }
    const cx=w/2,cy=h/2;
    const dx=this.waypoint.x-x, dz=this.waypoint.z-z;
    const angle=Math.atan2(dx,-dz)-heading;
    const distance=Math.hypot(dx,dz);
    const px=cx+Math.sin(angle)*Math.min(w*.42,distance/80000*w);
    const py=cy-Math.cos(angle)*Math.min(h*.42,distance/80000*h);
    ctx.strokeStyle='#ffc56b';ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(px,py);ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle='#a8ffc9';ctx.beginPath();ctx.moveTo(cx,cy-9);ctx.lineTo(cx-6,cy+7);ctx.lineTo(cx+6,cy+7);ctx.closePath();ctx.fill();
    ctx.fillStyle='#ffc56b';ctx.beginPath();ctx.arc(px,py,5,0,Math.PI*2);ctx.fill();
  }
  private update(s: NavigationSnapshot): void {
    const headingDeg = ((Math.round(s.heading*180/Math.PI)%360)+360)%360;
    const distance = Math.hypot(this.waypoint.x-s.x,this.waypoint.z-s.z)/1000;
    const set=(id:string,value:string)=>{const el=this.root.querySelector<HTMLElement>(`#${id}`);if(el)el.textContent=value;};
    set('nav-coord',`X ${Math.round(s.x)} / Z ${Math.round(s.z)}`);
    set('nav-heading',`HDG ${String(headingDeg).padStart(3,'0')}°`);
    set('nav-alt',`ALT ${Math.round(s.y).toLocaleString()} m`);
    set('nav-waypoint',`WP ${distance.toFixed(1)} km`);
    this.drawMap(s.x,s.z,s.heading);
  }
}
