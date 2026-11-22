//! International Standard Atmosphere (ISA), geometric altitude used as geopotential.
//! Valid for -500 m .. 30 000 m (input is clamped).

pub const G0: f64 = 9.80665; // m/s^2
pub const R_AIR: f64 = 287.053; // J/(kg K)
pub const GAMMA: f64 = 1.4;
pub const RHO0: f64 = 1.225; // kg/m^3, sea level

#[derive(Clone, Copy, Debug)]
pub struct Atmosphere {
    pub temperature: f64,     // K
    pub pressure: f64,        // Pa
    pub density: f64,         // kg/m^3
    pub speed_of_sound: f64,  // m/s
}

pub fn isa(altitude_m: f64) -> Atmosphere {
    let h = altitude_m.clamp(-500.0, 30_000.0);
    let (t, p) = if h <= 11_000.0 {
        let t = 288.15 - 0.0065 * h;
        (t, 101_325.0 * (t / 288.15).powf(5.255_876))
    } else {
        let t = 216.65;
        (t, 22_632.06 * (-(h - 11_000.0) * G0 / (R_AIR * t)).exp())
    };
    Atmosphere {
        temperature: t,
        pressure: p,
        density: p / (R_AIR * t),
        speed_of_sound: (GAMMA * R_AIR * t).sqrt(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sea_level_matches_standard_values() {
        let a = isa(0.0);
        assert!((a.density - 1.225).abs() < 0.002);
        assert!((a.speed_of_sound - 340.3).abs() < 0.5);
        assert!((a.pressure - 101_325.0).abs() < 1.0);
    }

    #[test]
    fn tropopause_values() {
        let a = isa(11_000.0);
        assert!((a.temperature - 216.65).abs() < 1e-6);
        assert!((a.density - 0.3639).abs() < 0.003);
    }

    #[test]
    fn density_decreases_with_altitude() {
        let mut prev = f64::MAX;
        for h in (0..=30_000).step_by(1000) {
            let d = isa(h as f64).density;
            assert!(d < prev);
            prev = d;
        }
    }
}
