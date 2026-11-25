//! Cockpit warning logic (TAWS / stall / overspeed / G / fuel / engine / attitude).
//!
//! `evaluate` returns a bit mask. Bit numbers are in priority order (bit 0 = highest), so the
//! primary warning is the lowest set bit. Levels: 3 = warning (red), 2 = caution (amber),
//! 1 = advisory. The same table is mirrored in `src/physics/warnings.ts`.
//!
//! PULL UP is not a plain "straight line hits the ground" test: it simulates the best escape
//! (wings-level pull-up at the load factor the airframe can actually deliver, after a reaction and
//! roll-out delay) and only fires when that escape would still hit terrain. A straight-line
//! predicted impact that the escape can still avoid is the lower-level TERRAIN caution.

use crate::flight::{Derived, Sim, IMPACT_CLEARANCE};
use crate::math::Vec3;
use crate::atmosphere::G0;

pub const W_PULL_UP: u32 = 0;
pub const W_STALL: u32 = 1;
pub const W_OVERSPEED: u32 = 2;
pub const W_FLAMEOUT: u32 = 3;
pub const W_OVER_G: u32 = 4;
pub const W_TERRAIN: u32 = 5;
pub const W_SINK_RATE: u32 = 6;
pub const W_AOA: u32 = 7;
pub const W_SPEED: u32 = 8;
pub const W_BANK: u32 = 9;
pub const W_FUEL_LOW: u32 = 10;
pub const W_LOW_ALT: u32 = 11;
pub const W_G_LIMIT: u32 = 12;
pub const W_BINGO: u32 = 13;
pub const WARNING_COUNT: u32 = 14;

pub const LEVELS: [u8; WARNING_COUNT as usize] = [3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 1, 1, 1];

const ESCAPE_STEP: f64 = 0.1; // s
const ESCAPE_HORIZON: f64 = 14.0; // s
const REACTION_DELAY: f64 = 0.7; // s
const ROLL_RATE: f64 = 2.0; // rad/s, wings-level roll-out
const ESCAPE_G_FACTOR: f64 = 0.85; // fraction of the available load factor actually flown
const BINGO_FRACTION: f64 = 0.25;
const LOW_FUEL_FRACTION: f64 = 0.10;

/// Would a wings-level pull-up started now (after the delay) still hit the ground or a building?
/// Returns the time of the predicted contact.
pub fn escape_impact(sim: &Sim, g_avail: f64) -> Option<f64> {
    let s = &sim.state;
    let mut pos = s.position;
    let mut vel = s.velocity;
    if vel.length() < 5.0 {
        return None;
    }
    let up = Vec3::new(0.0, 1.0, 0.0);
    // bank angle of the aircraft: angle between body-up and world-up
    let body_up = s.orientation.rotate(up);
    let bank = body_up.dot(up).clamp(-1.0, 1.0).acos();
    let delay = REACTION_DELAY + bank / ROLL_RATE;
    let n = (g_avail * ESCAPE_G_FACTOR).max(1.0);
    let margin = sim.params.hull_radius + IMPACT_CLEARANCE;

    let mut t = 0.0;
    while t < ESCAPE_HORIZON {
        let acc = if t < delay {
            Vec3::ZERO // flying straight while the pilot reacts and rolls out
        } else {
            let speed = vel.length();
            let vh = vel * (1.0 / speed);
            // pull towards world-up, perpendicular to the velocity
            let lift_dir = (up - vh * up.dot(vh)).normalized().unwrap_or(Vec3::ZERO);
            lift_dir * (n * G0) + Vec3::new(0.0, -G0, 0.0)
        };
        let nv = vel + acc * ESCAPE_STEP;
        let np = pos + nv * ESCAPE_STEP;
        if np.y <= margin {
            return Some(t + ESCAPE_STEP);
        }
        if let Some(f) = sim.world.segment_hit(pos, np, margin) {
            return Some(t + f * ESCAPE_STEP);
        }
        pos = np;
        vel = nv;
        t += ESCAPE_STEP;
    }
    None
}

/// Returns (mask, highest level, primary bit or -1).
pub fn evaluate(sim: &Sim, d: &Derived) -> (u32, u8, i32) {
    let p = &sim.params;
    let s = &sim.state;
    let mut mask = 0u32;
    let mut set = |bit: u32, on: bool| {
        if on {
            mask |= 1 << bit;
        }
    };
    if s.crashed {
        return (0, 0, -1);
    }

    let alt = s.position.y;
    let vs = s.velocity.y;

    // Terrain: straight-line prediction (caution) and escape-aware PULL UP (warning)
    let straight = d.impact_time < 8.0;
    let escape_fails = (straight || alt < 1500.0) && escape_impact(sim, d.g_avail).is_some();
    set(W_PULL_UP, (straight && escape_fails) || d.impact_time < 2.0);
    set(W_TERRAIN, straight);
    // Sink rate close to the ground
    set(W_SINK_RATE, alt < 1000.0 && -vs > (0.12 * alt).max(15.0));
    set(W_LOW_ALT, alt < 150.0);

    // Aerodynamic envelope
    set(W_STALL, d.airspeed > 30.0 && d.alpha.abs() > 1.02 * p.alpha_stall);
    set(W_AOA, d.stall_warning);
    set(W_OVERSPEED, d.dynamic_pressure > p.max_q || d.mach > p.max_mach);
    set(W_SPEED, d.dynamic_pressure > 0.9 * p.max_q || d.mach > 0.92 * p.max_mach);

    // Load factor
    set(W_OVER_G, d.load_factor > p.g_limit_pos + 0.5 || d.load_factor < p.g_limit_neg - 0.5);
    // Avoid flashing the limiter advisory for tiny predictive corrections near the envelope.
    let near_g_limit = d.load_factor > 0.82 * p.g_limit_pos || d.load_factor < 0.82 * p.g_limit_neg;
    set(W_G_LIMIT, d.g_limiting && near_g_limit);

    // Attitude near the ground
    let body_up = s.orientation.rotate(Vec3::new(0.0, 1.0, 0.0));
    let bank = body_up.dot(Vec3::new(0.0, 1.0, 0.0)).clamp(-1.0, 1.0).acos();
    set(W_BANK, alt < 400.0 && bank > 1.2);

    // Fuel and engine
    let frac = s.fuel / p.fuel_capacity;
    set(W_FLAMEOUT, s.fuel <= 0.0);
    set(W_FUEL_LOW, s.fuel > 0.0 && frac < LOW_FUEL_FRACTION);
    set(W_BINGO, frac < BINGO_FRACTION);

    let (mut level, mut primary) = (0u8, -1i32);
    for bit in 0..WARNING_COUNT {
        if mask & (1 << bit) != 0 {
            level = level.max(LEVELS[bit as usize]);
            if primary < 0 {
                primary = bit as i32;
            }
        }
    }
    (mask, level, primary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::aircraft::AircraftParams;
    use crate::collision::World;

    fn fighter() -> Sim {
        Sim::new(AircraftParams::generic_fighter())
    }
    /// Fly north along a flight path `gamma_deg` above the horizon at `speed`, alpha = 0.
    fn aim(s: &mut Sim, y: f64, gamma_deg: f64, speed: f64) {
        use crate::math::Quat;
        let g = gamma_deg.to_radians();
        s.state.position.y = y;
        s.state.velocity = Vec3::new(0.0, speed * g.sin(), -speed * g.cos());
        let heading = Quat::from_axis_angle(Vec3::new(0.0, 1.0, 0.0), std::f64::consts::FRAC_PI_2);
        let pitch = Quat::from_axis_angle(Vec3::new(0.0, 0.0, 1.0), g + 0.05);
        s.state.orientation = heading.compose(pitch).normalized();
        s.step(1e-6);
    }
    fn has(sim: &Sim, bit: u32) -> bool {
        sim.derived.warn_mask & (1 << bit) != 0
    }

    #[test]
    fn level_flight_at_altitude_is_quiet() {
        let s = fighter();
        assert_eq!(s.derived.warn_mask, 0, "mask = {:b}", s.derived.warn_mask);
        assert_eq!(s.derived.warn_level, 0);
        assert_eq!(s.derived.warn_primary, -1);
    }

    #[test]
    fn steep_dive_triggers_pull_up() {
        let mut s = fighter();
        aim(&mut s, 300.0, -45.0, 170.0);
        assert!(has(&s, W_PULL_UP), "mask = {:b}", s.derived.warn_mask);
        assert_eq!(s.derived.warn_level, 3);
        assert_eq!(s.derived.warn_primary, W_PULL_UP as i32);
    }

    #[test]
    fn shallow_descent_with_room_to_recover_is_only_a_caution_or_nothing() {
        let mut s = fighter();
        // 2.3 km above ground, gentle 5 degree descent: the straight path is clear for 8 s anyway
        aim(&mut s, 2300.0, -5.0, 180.0);
        assert!(!has(&s, W_PULL_UP));
        // closer to the ground the straight line meets terrain within 8 s but a pull-up still clears it
        aim(&mut s, 200.0, -10.0, 175.0);
        assert!(has(&s, W_TERRAIN), "mask = {:b}", s.derived.warn_mask);
        assert!(!has(&s, W_PULL_UP), "a pull-up from here still clears the ground");
    }

    #[test]
    fn wall_ahead_that_cannot_be_cleared_gives_pull_up() {
        let mut s = fighter();
        s.set_world(World::from_instances(&[0.0, -1000.0, 400.0, 3000.0]));
        assert!(has(&s, W_PULL_UP));
        assert!(has(&s, W_TERRAIN));
    }

    #[test]
    fn low_wall_can_be_cleared_so_only_terrain_caution() {
        let mut s = fighter();
        aim(&mut s, 200.0, 0.0, 180.0);
        // 300 m building 1.2 km ahead: a pull-up easily clears it
        s.set_world(World::from_instances(&[0.0, -1400.0, 200.0, 300.0]));
        assert!(has(&s, W_TERRAIN), "mask = {:b}", s.derived.warn_mask);
        assert!(!has(&s, W_PULL_UP), "mask = {:b}", s.derived.warn_mask);
    }

    #[test]
    fn stall_and_aoa_warnings() {
        let mut s = fighter();
        s.state.velocity = Vec3::new(0.0, 0.0, -90.0);
        // pitch the nose 20 degrees above the velocity vector (alpha > 17 deg stall)
        let heading = crate::math::Quat::from_axis_angle(Vec3::new(0.0, 1.0, 0.0), std::f64::consts::FRAC_PI_2);
        let pitch = crate::math::Quat::from_axis_angle(Vec3::new(0.0, 0.0, 1.0), 20.0_f64.to_radians());
        s.state.orientation = heading.compose(pitch).normalized();
        s.step(1e-6);
        assert!(has(&s, W_STALL));
        assert!(has(&s, W_AOA));
        assert_eq!(s.derived.warn_primary, W_STALL as i32);
    }

    #[test]
    fn overspeed_when_dynamic_pressure_exceeds_the_limit() {
        let mut s = fighter();
        s.state.position.y = 1000.0;
        s.state.velocity = Vec3::new(0.0, 0.0, -420.0);
        s.step(1e-6);
        assert!(has(&s, W_OVERSPEED), "q = {}", s.derived.dynamic_pressure);
    }

    #[test]
    fn fuel_warnings_follow_the_tank() {
        let mut s = fighter();
        s.state.fuel = 0.2 * s.params.fuel_capacity;
        s.step(1e-6);
        assert!(has(&s, W_BINGO) && !has(&s, W_FUEL_LOW));
        s.state.fuel = 0.05 * s.params.fuel_capacity;
        s.step(1e-6);
        assert!(has(&s, W_FUEL_LOW));
        s.state.fuel = 0.0;
        s.step(1e-6);
        assert!(has(&s, W_FLAMEOUT));
        assert_eq!(s.derived.warn_level, 3);
    }

    #[test]
    fn low_altitude_and_steep_bank() {
        let mut s = fighter();
        s.state.position.y = 120.0;
        let heading = crate::math::Quat::from_axis_angle(Vec3::new(0.0, 1.0, 0.0), std::f64::consts::FRAC_PI_2);
        let roll = crate::math::Quat::from_axis_angle(Vec3::new(1.0, 0.0, 0.0), 80.0_f64.to_radians());
        s.state.orientation = heading.compose(roll).normalized();
        s.step(1e-6);
        assert!(has(&s, W_LOW_ALT));
        assert!(has(&s, W_BANK));
    }

    #[test]
    fn warnings_are_cleared_after_a_crash() {
        let mut s = fighter();
        s.state.position.y = 20.0;
        s.state.velocity = Vec3::new(0.0, -50.0, -100.0);
        for _ in 0..60 {
            s.step(1.0 / 30.0);
        }
        assert!(s.state.crashed);
        assert_eq!(s.derived.warn_mask, 0);
    }
}
