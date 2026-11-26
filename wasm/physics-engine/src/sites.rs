//! Landing sites: two runways and one carrier deck, all fictional.
//!
//! The numbers mirror `src/world/sites.ts` (a TypeScript test reads this file and compares them),
//! so the runway that is drawn is the runway that can be landed on. Runways and the deck run along
//! the world z axis. The carrier is modelled here (solid hull, island, flat deck) instead of in the
//! box world; the renderer draws it from render-only instances that the box world skips.

use crate::math::Vec3;

/// `(centre x, centre z, half width, half length)`
pub const RUNWAYS: [(f64, f64, f64, f64); 2] = [(-5000.0, -3500.0, 30.0, 1200.0), (4300.0, 2500.0, 30.0, 1200.0)];

pub const CARRIER_CX: f64 = 0.0;
pub const CARRIER_CZ: f64 = -3000.0;
pub const CARRIER_HALF_LEN: f64 = 175.0;
pub const CARRIER_HALF_WID: f64 = 35.0;
pub const CARRIER_DECK_Y: f64 = 24.0;
pub const ISLAND_X: f64 = 42.0;
pub const ISLAND_Z: f64 = -53.0;
pub const ISLAND_HALF: f64 = 7.0;
pub const ISLAND_H: f64 = 46.0;

pub const MAX_SINK: f64 = 5.0; // m/s
pub const MAX_ROLL_DEG: f64 = 10.0;
pub const MIN_PITCH_DEG: f64 = -3.0;
pub const MAX_PITCH_DEG: f64 = 18.0;
pub const MAX_SPEED: f64 = 95.0; // m/s
pub const MAX_HEADING_DEG: f64 = 25.0;

/// Where a landing happened (`landing_kind` in the snapshot).
pub const LAND_NONE: u8 = 0;
pub const LAND_RUNWAY: u8 = 1;
pub const LAND_DECK: u8 = 2;

/// Inside a runway rectangle (grown by `margin`)?
pub fn on_runway(x: f64, z: f64, margin: f64) -> bool {
    RUNWAYS.iter().any(|&(cx, cz, hw, hl)| (x - cx).abs() <= hw + margin && (z - cz).abs() <= hl + margin)
}

/// Inside the carrier's hull / deck footprint (grown by `margin`)?
pub fn on_deck(x: f64, z: f64, margin: f64) -> bool {
    (x - CARRIER_CX).abs() <= CARRIER_HALF_WID + margin && (z - CARRIER_CZ).abs() <= CARRIER_HALF_LEN + margin
}

/// Does the segment a->b (grown by `r`) pass through the island box? Returns the entry fraction.
pub fn island_hit(a: Vec3, b: Vec3, r: f64) -> Option<f64> {
    let lo = [CARRIER_CX + ISLAND_X - ISLAND_HALF - r, -r, CARRIER_CZ + ISLAND_Z - ISLAND_HALF - r];
    let hi = [CARRIER_CX + ISLAND_X + ISLAND_HALF + r, ISLAND_H + r, CARRIER_CZ + ISLAND_Z + ISLAND_HALF + r];
    let (p, q) = ([a.x, a.y, a.z], [b.x, b.y, b.z]);
    let (mut t0, mut t1) = (0.0_f64, 1.0_f64);
    for i in 0..3 {
        let d = q[i] - p[i];
        if d.abs() < 1e-12 {
            if p[i] < lo[i] || p[i] > hi[i] {
                return None;
            }
        } else {
            let (mut ta, mut tb) = ((lo[i] - p[i]) / d, (hi[i] - p[i]) / d);
            if ta > tb {
                core::mem::swap(&mut ta, &mut tb);
            }
            t0 = t0.max(ta);
            t1 = t1.min(tb);
            if t0 > t1 {
                return None;
            }
        }
    }
    Some(t0)
}

/// Is the aircraft attitude / speed within the touchdown limits? `fwd`, `right`, `up` are the
/// body axes in world coordinates. Returns true for a landing, false for a crash.
pub fn touchdown_ok(velocity: Vec3, fwd: Vec3, right: Vec3, up: Vec3) -> bool {
    let sink = -velocity.y;
    let speed = velocity.length();
    let roll = right.y.atan2(up.y).abs().to_degrees();
    let pitch = fwd.y.clamp(-1.0, 1.0).asin().to_degrees();
    let heading = fwd.x.abs().atan2(fwd.z.abs()).to_degrees();
    sink <= MAX_SINK
        && speed <= MAX_SPEED
        && roll <= MAX_ROLL_DEG
        && (MIN_PITCH_DEG..=MAX_PITCH_DEG).contains(&pitch)
        && heading <= MAX_HEADING_DEG
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rectangles() {
        assert!(on_runway(-5000.0, -3500.0, 0.0));
        assert!(!on_runway(-5000.0 + 40.0, -3500.0, 0.0));
        assert!(on_deck(0.0, -3000.0 + 170.0, 0.0));
        assert!(!on_deck(60.0, -3000.0, 0.0));
    }

    #[test]
    fn island_is_solid() {
        let a = Vec3::new(CARRIER_CX + ISLAND_X, 30.0, CARRIER_CZ + ISLAND_Z - 80.0);
        let b = Vec3::new(CARRIER_CX + ISLAND_X, 30.0, CARRIER_CZ + ISLAND_Z + 80.0);
        assert!(island_hit(a, b, 1.0).is_some());
        let above = Vec3::new(a.x, 80.0, a.z);
        let above_b = Vec3::new(b.x, 80.0, b.z);
        assert!(island_hit(above, above_b, 1.0).is_none());
    }

    #[test]
    fn touchdown_limits() {
        // flying toward -z, level, 2 m/s sink, 70 m/s
        let fwd = Vec3::new(0.0, 0.0, -1.0);
        let right = Vec3::new(1.0, 0.0, 0.0);
        let up = Vec3::new(0.0, 1.0, 0.0);
        assert!(touchdown_ok(Vec3::new(0.0, -2.0, -70.0), fwd, right, up));
        assert!(!touchdown_ok(Vec3::new(0.0, -9.0, -70.0), fwd, right, up), "too hard");
        assert!(!touchdown_ok(Vec3::new(0.0, -2.0, -140.0), fwd, right, up), "too fast");
        let banked_right = Vec3::new(0.97, -0.26, 0.0);
        let banked_up = Vec3::new(0.26, 0.97, 0.0);
        assert!(!touchdown_ok(Vec3::new(0.0, -2.0, -70.0), fwd, banked_right, banked_up), "wing down");
        let crabbed = Vec3::new(0.7, 0.0, -0.7);
        assert!(!touchdown_ok(Vec3::new(0.0, -2.0, -70.0), crabbed, right, up), "sideways");
    }
}
