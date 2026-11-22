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
//! | 24..31| reserved                                  |

pub mod aircraft;
pub mod atmosphere;
pub mod flight;
pub mod math;

use aircraft::AircraftParams;
use flight::{Controls, Sim};

pub const STATE_LEN: usize = 32;
pub const API_VERSION: u32 = 1;

static mut SIM: Option<Sim> = None;
static mut OUT: [f64; STATE_LEN] = [0.0; STATE_LEN];

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
                *core::ptr::addr_of_mut!(SIM) = Some(Sim::new(params));
            }
            1
        }
        None => 0,
    }
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
        let q = (out[3] * out[3] + out[4] * out[4] + out[5] * out[5] + out[6] * out[6]).sqrt();
        assert!((q - 1.0).abs() < 1e-9);
    }
}
