//! Minimal vector / quaternion math (f64, right-handed).
//!
//! Body frame : +X forward (nose), +Y up (canopy), +Z right wing.
//! World frame: +X east, +Y up, -Z north (so "north" is the -Z direction).
//! Quaternions rotate body-frame vectors into the world frame.

use std::ops::{Add, Mul, Neg, Sub};

#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Vec3 {
    pub const ZERO: Vec3 = Vec3 { x: 0.0, y: 0.0, z: 0.0 };

    pub const fn new(x: f64, y: f64, z: f64) -> Vec3 {
        Vec3 { x, y, z }
    }

    pub fn dot(self, o: Vec3) -> f64 {
        self.x * o.x + self.y * o.y + self.z * o.z
    }

    pub fn cross(self, o: Vec3) -> Vec3 {
        Vec3::new(
            self.y * o.z - self.z * o.y,
            self.z * o.x - self.x * o.z,
            self.x * o.y - self.y * o.x,
        )
    }

    pub fn length(self) -> f64 {
        self.dot(self).sqrt()
    }

    pub fn normalized(self) -> Option<Vec3> {
        let l = self.length();
        if l > 1e-12 {
            Some(self * (1.0 / l))
        } else {
            None
        }
    }

    pub fn is_finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite() && self.z.is_finite()
    }
}

impl Add for Vec3 {
    type Output = Vec3;
    fn add(self, o: Vec3) -> Vec3 {
        Vec3::new(self.x + o.x, self.y + o.y, self.z + o.z)
    }
}

impl Sub for Vec3 {
    type Output = Vec3;
    fn sub(self, o: Vec3) -> Vec3 {
        Vec3::new(self.x - o.x, self.y - o.y, self.z - o.z)
    }
}

impl Neg for Vec3 {
    type Output = Vec3;
    fn neg(self) -> Vec3 {
        Vec3::new(-self.x, -self.y, -self.z)
    }
}

impl Mul<f64> for Vec3 {
    type Output = Vec3;
    fn mul(self, s: f64) -> Vec3 {
        Vec3::new(self.x * s, self.y * s, self.z * s)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Quat {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub w: f64,
}

impl Quat {
    pub const IDENTITY: Quat = Quat { x: 0.0, y: 0.0, z: 0.0, w: 1.0 };

    pub fn from_axis_angle(axis: Vec3, angle: f64) -> Quat {
        let a = axis.normalized().unwrap_or(Vec3::new(0.0, 1.0, 0.0));
        let (s, c) = (angle * 0.5).sin_cos();
        Quat { x: a.x * s, y: a.y * s, z: a.z * s, w: c }
    }

    /// Hamilton product `self * o` (applies `o` first, then `self`).
    pub fn compose(self, o: Quat) -> Quat {
        Quat {
            w: self.w * o.w - self.x * o.x - self.y * o.y - self.z * o.z,
            x: self.w * o.x + self.x * o.w + self.y * o.z - self.z * o.y,
            y: self.w * o.y - self.x * o.z + self.y * o.w + self.z * o.x,
            z: self.w * o.z + self.x * o.y - self.y * o.x + self.z * o.w,
        }
    }

    pub fn conjugate(self) -> Quat {
        Quat { x: -self.x, y: -self.y, z: -self.z, w: self.w }
    }

    pub fn norm(self) -> f64 {
        (self.x * self.x + self.y * self.y + self.z * self.z + self.w * self.w).sqrt()
    }

    pub fn normalized(self) -> Quat {
        let n = self.norm();
        if n > 1e-12 {
            Quat { x: self.x / n, y: self.y / n, z: self.z / n, w: self.w / n }
        } else {
            Quat::IDENTITY
        }
    }

    pub fn rotate(self, v: Vec3) -> Vec3 {
        let u = Vec3::new(self.x, self.y, self.z);
        let t = u.cross(v) * 2.0;
        v + t * self.w + u.cross(t)
    }

    pub fn is_finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite() && self.z.is_finite() && self.w.is_finite()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::FRAC_PI_2;

    fn close(a: Vec3, b: Vec3) -> bool {
        (a - b).length() < 1e-9
    }

    #[test]
    fn cross_is_right_handed() {
        let x = Vec3::new(1.0, 0.0, 0.0);
        let y = Vec3::new(0.0, 1.0, 0.0);
        assert!(close(x.cross(y), Vec3::new(0.0, 0.0, 1.0)));
    }

    #[test]
    fn heading_north_maps_body_axes_to_world() {
        // 90 deg about world +Y: nose -> north (-Z), right wing -> east (+X).
        let q = Quat::from_axis_angle(Vec3::new(0.0, 1.0, 0.0), FRAC_PI_2);
        assert!(close(q.rotate(Vec3::new(1.0, 0.0, 0.0)), Vec3::new(0.0, 0.0, -1.0)));
        assert!(close(q.rotate(Vec3::new(0.0, 0.0, 1.0)), Vec3::new(1.0, 0.0, 0.0)));
        assert!(close(q.rotate(Vec3::new(0.0, 1.0, 0.0)), Vec3::new(0.0, 1.0, 0.0)));
    }

    #[test]
    fn conjugate_inverts_rotation() {
        let q = Quat::from_axis_angle(Vec3::new(1.0, 2.0, 3.0), 0.7).normalized();
        let v = Vec3::new(0.3, -4.0, 2.5);
        assert!(close(q.conjugate().rotate(q.rotate(v)), v));
    }

    #[test]
    fn compose_applies_right_operand_first() {
        let a = Quat::from_axis_angle(Vec3::new(0.0, 1.0, 0.0), FRAC_PI_2);
        let b = Quat::from_axis_angle(Vec3::new(0.0, 0.0, 1.0), FRAC_PI_2);
        let v = Vec3::new(1.0, 0.0, 0.0);
        assert!(close(a.compose(b).rotate(v), a.rotate(b.rotate(v))));
    }
}
