//! combat-flight-simulator physics core.
//!
//! Exposed to JavaScript through a tiny C ABI (no wasm-bindgen, no imports required), so the
//! only build tools needed are `rustc` + the `wasm32-unknown-unknown` target.
//!
//! Snapshot layout (`sim_snapshot`, `STATE_LEN` x f64) — mirrored in src/physics/stateLayout.ts:
//!
//! | idx   | meaning                                   |
//! |-------|-------------------------------------------|
//! | 0..2  | position x,y,z (world, m)                 |
//! | 3..6  | orientation quaternion x,y,z,w            |
//! | 7..9  | velocity (world, m/s)                     |
//! | 10..12| angular velocity (body, rad/s)            |
//! | 13    | simulated time (s)                        |
//! | 14    | crashed (0/1)                             |
//! | 15    | airspeed (m/s)                            |
//! | 16    | altitude (m)                              |
//! | 17    | mach                                      |
//! | 18    | angle of attack (rad)                     |
//! | 19    | sideslip (rad)                            |
//! | 20    | load factor (g)                           |
//! | 21    | throttle 0..1                             |
//! | 22    | dynamic pressure (Pa)                     |
//! | 23    | stall warning (0/1)                       |
//! | 24    | crash kind (0 none, 1 ground, 2 building) |
//! | 25    | predicted time to impact (s, 99 = clear)  |
//! | 26    | simulated time of the crash (s)           |
//! | 27..31| reserved                                  |
//!
//! Scene upload (API v2): the host calls `sim_scene_alloc(4 * n)`, writes `n` instances
//! (x, z, width, height as f32) at the returned address, then `sim_scene_commit(n)`.

pub mod aircraft;
pub mod atmosphere;
pub mod collision;
pub mod flight;
pub mod math;

use aircraft::AircraftParams;
use collision::World;
use flight::{Controls, Sim};

pub const STATE_LEN: usize = 32;
pub const API_VERSION: u32 = 2;

static mut SIM: Option<Sim> = None;
static mut OUT: [f64; STATE_LEN] = [0.0; STATE_LEN];
static mut SCENE: Vec<f32> = Vec::new();

/// WebAssembly is single-threaded here (one worker owns the instance), so this global is safe.
fn sim() -> &'static mut Sim {
    unsafe {
        let slot = &mut *core::ptr::addr_of_mut!(SIM);
        slot.get_or_insert_with(|| Sim::new(AircraftParams::generic_fighter()))
    }
}

pub fn write_snapshot(sim: &Sim, out: &mut [f64; STATE_LEN]) {
    let s = &sim.state;
    let d = &sim.derived;
    *out = [0.0; STATE_LEN];
    out[0] = s.position.x;
    out[1] = s.position.y;
    out[2] = s.position.z;
    out[3] = s.orientation.x;
    out[4] = s.orientation.y;
    out[5] = s.orientation.z;
    out[6] = s.orientation.w;
    out[7] = s.velocity.x;
    out[8] = s.velocity.y;
    out[9] = s.velocity.z;
    out[10] = s.angular_velocity.x;
    out[11] = s.angular_velocity.y;
    out[12] = s.angular_velocity.z;
    out[13] = s.time;
    out[14] = if s.crashed { 1.0 } else { 0.0 };
    out[15] = d.airspeed;
    out[16] = s.position.y;
    out[17] = d.mach;
    out[18] = d.alpha;
    out[19] = d.beta;
    out[20] = d.load_factor;
    out[21] = sim.controls.throttle;
    out[22] = d.dynamic_pressure;
    out[23] = if d.stall_warning { 1.0 } else { 0.0 };
    out[24] = s.crash_kind as f64;
    out[25] = d.impact_time;
    out[26] = s.crash_time;
}

#[no_mangle]
pub extern "C" fn sim_api_version() -> u32 {
    API_VERSION
}

/// Select an aircraft model and reset. Returns 1 on success, 0 for an unknown id.
#[no_mangle]
pub extern "C" fn sim_init(aircraft_id: u32) -> u32 {
    match AircraftParams::by_id(aircraft_id) {
        Some(params) => {
            unsafe {
                let slot = &mut *core::ptr::addr_of_mut!(SIM);
                // keep the uploaded scene when the aircraft model is (re)selected
                let world = slot.take().map(|old| old.world).unwrap_or_default();
                let mut fresh = Sim::new(params);
                fresh.set_world(world);
                *slot = Some(fresh);
            }
            1
        }
        None => 0,
    }
}

/// Reserve room for `floats` f32 values of scene data and return its address in linear memory.
/// The host must re-read `memory.buffer` after this call (the allocation may grow memory).
#[no_mangle]
pub extern "C" fn sim_scene_alloc(floats: u32) -> *mut f32 {
    unsafe {
        let buf = &mut *core::ptr::addr_of_mut!(SCENE);
        buf.clear();
        buf.resize(floats as usize, 0.0);
        buf.as_mut_ptr()
    }
}

/// Build the collision world from the first `count` instances written into the scene buffer.
/// Returns how many buildings were accepted.
#[no_mangle]
pub extern "C" fn sim_scene_commit(count: u32) -> u32 {
    let world = unsafe {
        let buf = &*core::ptr::addr_of!(SCENE);
        let n = (count as usize).min(buf.len() / 4);
        World::from_instances(&buf[..n * 4])
    };
    let accepted = world.building_count() as u32;
    sim().set_world(world);
    accepted
}

#[no_mangle]
pub extern "C" fn sim_reset() {
    sim().reset();
}

#[no_mangle]
pub extern "C" fn sim_set_controls(throttle: f64, pitch: f64, roll: f64, yaw: f64) {
    sim().set_controls(Controls { throttle, pitch, roll, yaw });
}

#[no_mangle]
pub extern "C" fn sim_step(dt: f64) {
    sim().step(dt);
}

/// Fill the shared output buffer and return its address inside linear memory.
#[no_mangle]
pub extern "C" fn sim_snapshot() -> *const f64 {
    unsafe {
        let out = &mut *core::ptr::addr_of_mut!(OUT);
        write_snapshot(sim(), out);
        out.as_ptr()
    }
}

#[no_mangle]
pub extern "C" fn sim_snapshot_len() -> u32 {
    STATE_LEN as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_layout_is_stable() {
        let mut sim = Sim::new(AircraftParams::generic_fighter());
        sim.step(1.0 / 30.0);
        let mut out = [0.0; STATE_LEN];
        write_snapshot(&sim, &mut out);
        assert_eq!(out[1], sim.state.position.y);
        assert_eq!(out[16], sim.state.position.y);
        assert!((out[13] - 1.0 / 30.0).abs() < 1e-12);
        assert!(out[15] > 100.0);
        assert_eq!(out[24], 0.0);
        assert_eq!(out[25], flight::IMPACT_NONE);
        let q = (out[3] * out[3] + out[4] * out[4] + out[5] * out[5] + out[6] * out[6]).sqrt();
        assert!((q - 1.0).abs() < 1e-9);
    }
}
