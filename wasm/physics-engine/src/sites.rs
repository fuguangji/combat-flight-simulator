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

static mut RUNTIME_RUNWAYS: Vec<Runway> = Vec::new();
static mut RUNTIME_CARRIERS: Vec<Carrier> = Vec::new();

pub fn install(runways:&[f64], carriers:&[f64]) -> bool {
    if runways.len()%4!=0 || carriers.len()%9!=0 || runways.len()/4>16 || carriers.len()/9>16 { return false; }
    let rs:Vec<Runway>=runways.chunks_exact(4).map(|v|Runway{cx:v[0],cz:v[1],half_wid:v[2],half_len:v[3]}).collect();
    let cs:Vec<Carrier>=carriers.chunks_exact(9).map(|v|Carrier{cx:v[0],cz:v[1],half_len:v[2],half_wid:v[3],deck_y:v[4],island_x:v[5],island_z:v[6],island_half:v[7],island_h:v[8]}).collect();
    if rs.iter().chain(core::iter::empty()).any(|r| !(r.cx.is_finite()&&r.cz.is_finite()&&r.half_wid>0.0&&r.half_len>0.0)) { return false; }
    if cs.iter().any(|c| !(c.cx.is_finite()&&c.cz.is_finite()&&c.half_len>0.0&&c.half_wid>0.0&&c.deck_y>0.0)) { return false; }
    unsafe { RUNTIME_RUNWAYS=rs; RUNTIME_CARRIERS=cs; }
    true
}
pub fn runways()->Vec<Runway>{
    unsafe { if RUNTIME_RUNWAYS.is_empty(){vec![Runway{cx:-5000.0,cz:-3500.0,half_wid:30.0,half_len:1200.0},Runway{cx:4300.0,cz:2500.0,half_wid:30.0,half_len:1200.0}]}else{RUNTIME_RUNWAYS.clone()} }
}
pub fn carriers()->Vec<Carrier>{
    unsafe { if RUNTIME_CARRIERS.is_empty(){vec![Carrier{cx:CARRIER_CX,cz:CARRIER_CZ,half_len:CARRIER_HALF_LEN,half_wid:CARRIER_HALF_WID,deck_y:CARRIER_DECK_Y,island_x:ISLAND_X,island_z:ISLAND_Z,island_half:ISLAND_HALF,island_h:ISLAND_H}]}else{RUNTIME_CARRIERS.clone()} }
}
pub fn on_runway(x:f64,z:f64,margin:f64)->bool{
    runways().iter().any(|r|(x-r.cx).abs()<=r.half_wid+margin&&(z-r.cz).abs()<=r.half_len+margin)
}
pub fn deck_height(x:f64,z:f64,margin:f64)->Option<f64>{
    carriers().iter().find(|c|(x-c.cx).abs()<=c.half_wid+margin&&(z-c.cz).abs()<=c.half_len+margin).map(|c|c.deck_y)
}
pub fn on_deck(x:f64,z:f64,margin:f64)->bool{deck_height(x,z,margin).is_some()}
pub fn island_hit(a:Vec3,b:Vec3,r:f64)->Option<f64>{
    let (p,q)=([a.x,a.y,a.z],[b.x,b.y,b.z]);
    let mut best:Option<f64>=None;
    for c in carriers(){
        let lo=[c.cx+c.island_x-c.island_half-r,-r,c.cz+c.island_z-c.island_half-r];
        let hi=[c.cx+c.island_x+c.island_half+r,c.island_h+r,c.cz+c.island_z+c.island_half+r];
        let(mut t0,mut t1)=(0.0_f64,1.0_f64);
        let mut hit=true;
        for i in 0..3{
            let d=q[i]-p[i];
            if d.abs()<1e-12{if p[i]<lo[i]||p[i]>hi[i]{hit=false;break;}}
            else{let(mut ta,mut tb)=((lo[i]-p[i])/d,(hi[i]-p[i])/d);if ta>tb{core::mem::swap(&mut ta,&mut tb);}t0=t0.max(ta);t1=t1.min(tb);if t0>t1{hit=false;break;}}
        }
        if hit && best.map_or(true,|v|t0<v){best=Some(t0);}
    }
    best
}
pub fn touchdown_ok(velocity:Vec3,fwd:Vec3,right:Vec3,up:Vec3)->bool{
    let sink=-velocity.y;let speed=velocity.length();
    let roll=right.y.atan2(up.y).abs().to_degrees();
    let pitch=fwd.y.clamp(-1.0,1.0).asin().to_degrees();
    let heading=fwd.x.abs().atan2(fwd.z.abs()).to_degrees();
    sink<=MAX_SINK&&speed<=MAX_SPEED&&roll<=MAX_ROLL_DEG&&(MIN_PITCH_DEG..=MAX_PITCH_DEG).contains(&pitch)&&heading<=MAX_HEADING_DEG
}
#[cfg(test)]
mod tests{
 use super::*;
 #[test] fn runtime_sites_install_and_query(){
  assert!(on_runway(-5000.0,-3500.0,0.0));
  assert!(install(&[1000.0,2000.0,40.0,900.0],&[9000.0,-9000.0,200.0,45.0,25.0,52.0,-55.0,8.0,48.0]));
  assert!(on_runway(1000.0,2000.0,0.0));
  assert!(!on_runway(-5000.0,-3500.0,0.0));
  assert_eq!(deck_height(9000.0,-9000.0,0.0),Some(25.0));
  let a=Vec3::new(9052.0,30.0,-9055.0-80.0);
  let b=Vec3::new(9052.0,30.0,-9055.0+80.0);
  assert!(island_hit(a,b,1.0).is_some());
 }
}
