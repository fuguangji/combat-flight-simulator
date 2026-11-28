//! Runtime-generated landing-site geometry shared with the renderer.
use crate::math::Vec3;

#[derive(Clone, Copy, Debug)]
pub struct Runway { pub cx:f64, pub cz:f64, pub half_wid:f64, pub half_len:f64 }
#[derive(Clone, Copy, Debug)]
pub struct Carrier {
    pub cx:f64, pub cz:f64, pub half_len:f64, pub half_wid:f64, pub deck_y:f64,
    pub island_x:f64, pub island_z:f64, pub island_half:f64, pub island_h:f64,
}
pub const CARRIER_CX:f64=0.0;
pub const CARRIER_CZ:f64=-3000.0;
pub const CARRIER_HALF_LEN:f64=175.0;
pub const CARRIER_HALF_WID:f64=35.0;
pub const CARRIER_DECK_Y:f64=24.0;
pub const ISLAND_X:f64=42.0;
pub const ISLAND_Z:f64=-53.0;
pub const ISLAND_HALF:f64=7.0;
pub const ISLAND_H:f64=46.0;
pub const MAX_SINK:f64=5.0;
pub const MAX_ROLL_DEG:f64=10.0;
pub const MIN_PITCH_DEG:f64=-3.0;
pub const MAX_PITCH_DEG:f64=18.0;
pub const MAX_SPEED:f64=95.0;
pub const MAX_HEADING_DEG:f64=25.0;
pub const LAND_NONE:u8=0;
pub const LAND_RUNWAY:u8=1;
pub const LAND_DECK:u8=2;

static mut RUNTIME_RUNWAYS: [Runway;16] = [Runway{cx:0.0,cz:0.0,half_wid:0.0,half_len:0.0};16];
static mut RUNTIME_CARRIERS: [Carrier;16] = [Carrier{cx:0.0,cz:0.0,half_len:0.0,half_wid:0.0,deck_y:0.0,island_x:0.0,island_z:0.0,island_half:0.0,island_h:0.0};16];
static mut RUNWAY_COUNT:usize=0;
static mut CARRIER_COUNT:usize=0;

pub fn install(runways:&[f64], carriers:&[f64]) -> bool {
    if runways.len()%4!=0 || carriers.len()%9!=0 || runways.len()/4==0 || carriers.len()/9==0 || runways.len()/4>16 || carriers.len()/9>16 { return false; }
    let mut rs=[Runway{cx:0.0,cz:0.0,half_wid:0.0,half_len:0.0};16];
    let mut cs=[Carrier{cx:0.0,cz:0.0,half_len:0.0,half_wid:0.0,deck_y:0.0,island_x:0.0,island_z:0.0,island_half:0.0,island_h:0.0};16];
    for (i,v) in runways.chunks_exact(4).enumerate() {
        if !(v[0].is_finite()&&v[1].is_finite()&&v[2].is_finite()&&v[3].is_finite()&&v[2]>0.0&&v[3]>0.0) { return false; }
        rs[i]=Runway{cx:v[0],cz:v[1],half_wid:v[2],half_len:v[3]};
    }
    for (i,v) in carriers.chunks_exact(9).enumerate() {
        if !v.iter().all(|x|x.is_finite()) || v[2]<=0.0 || v[3]<=0.0 || v[4]<=0.0 || v[7]<=0.0 || v[8]<=0.0 { return false; }
        cs[i]=Carrier{cx:v[0],cz:v[1],half_len:v[2],half_wid:v[3],deck_y:v[4],island_x:v[5],island_z:v[6],island_half:v[7],island_h:v[8]};
    }
    unsafe { RUNTIME_RUNWAYS=rs; RUNTIME_CARRIERS=cs; RUNWAY_COUNT=runways.len()/4; CARRIER_COUNT=carriers.len()/9; }
    true
}
pub fn on_runway(x:f64,z:f64,margin:f64)->bool {
    unsafe { RUNTIME_RUNWAYS[..RUNWAY_COUNT].iter().any(|r|(x-r.cx).abs()<=r.half_wid+margin&&(z-r.cz).abs()<=r.half_len+margin) }
}
pub fn deck_height(x:f64,z:f64,margin:f64)->Option<f64> {
    unsafe { RUNTIME_CARRIERS[..CARRIER_COUNT].iter().find(|c|(x-c.cx).abs()<=c.half_wid+margin&&(z-c.cz).abs()<=c.half_len+margin).map(|c|c.deck_y) }
}
pub fn on_deck(x:f64,z:f64,margin:f64)->bool { deck_height(x,z,margin).is_some() }
pub fn island_hit(a:Vec3,b:Vec3,r:f64)->Option<f64> {
    let (p,q)=([a.x,a.y,a.z],[b.x,b.y,b.z]);
    let mut best:Option<f64>=None;
    unsafe { for c in RUNTIME_CARRIERS[..CARRIER_COUNT].iter() {
        let lo=[c.cx+c.island_x-c.island_half-r,-r,c.cz+c.island_z-c.island_half-r];
        let hi=[c.cx+c.island_x+c.island_half+r,c.island_h+r,c.cz+c.island_z+c.island_half+r];
        let(mut t0,mut t1)=(0.0_f64,1.0_f64); let mut hit=true;
        for i in 0..3 {
            let d=q[i]-p[i];
            if d.abs()<1e-12 { if p[i]<lo[i]||p[i]>hi[i] {hit=false;break;} }
            else { let(mut ta,mut tb)=((lo[i]-p[i])/d,(hi[i]-p[i])/d); if ta>tb {core::mem::swap(&mut ta,&mut tb);} t0=t0.max(ta);t1=t1.min(tb);if t0>t1 {hit=false;break;} }
        }
        if hit&&best.map_or(true,|v|t0<v){best=Some(t0);}
    }}
    best
}
pub fn touchdown_ok(velocity:Vec3,fwd:Vec3,right:Vec3,up:Vec3)->bool{
    let sink=-velocity.y;let speed=velocity.length();
    let roll=right.y.atan2(up.y).abs().to_degrees();
    let pitch=fwd.y.clamp(-1.0,1.0).asin().to_degrees();
    let heading=fwd.x.abs().atan2(fwd.z.abs()).to_degrees();
    sink<=MAX_SINK&&speed<=MAX_SPEED&&roll<=MAX_ROLL_DEG&&(MIN_PITCH_DEG..=MAX_PITCH_DEG).contains(&pitch)&&heading<=MAX_HEADING_DEG
}
