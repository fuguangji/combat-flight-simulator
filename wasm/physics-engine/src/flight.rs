//! Six-degree-of-freedom rigid-body flight dynamics.
//!
//! Pure data + math: no rendering, no I/O, no globals. Given the same inputs and the same
//! sequence of `step(dt)` calls the result is bit-identical on every run.
//!
//! Integration: semi-implicit Euler with internal sub-stepping (<= 1/120 s per sub-step),
//! so a 30 Hz outer step is evaluated as 4 sub-steps.

use crate::aircraft::AircraftParams;
use crate::atmosphere::{isa, G0, RHO0};
use crate::math::{Quat, Vec3};

pub const MAX_SUBSTEP: f64 = 1.0 / 120.0;

/// Pilot commands. throttle 0..1; pitch/roll/yaw -1..1.
/// pitch +1 = stick back (nose up), roll +1 = roll right, yaw +1 = right rudder.
#[derive(Clone, Copy, Debug, Default)]
pub struct Controls {
    pub throttle: f64,
    pub pitch: f64,
    pub roll: f64,
    pub yaw: f64,
}

impl Controls {
    pub fn sanitized(self) -> Controls {
        fn c(v: f64, lo: f64, hi: f64) -> f64 {
            if v.is_finite() { v.clamp(lo, hi) } else { 0.0 }
        }
        Controls {
            throttle: c(self.throttle, 0.0, 1.0),
            pitch: c(self.pitch, -1.0, 1.0),
            roll: c(self.roll, -1.0, 1.0),
            yaw: c(self.yaw, -1.0, 1.0),
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct BodyState {
    pub position: Vec3,         // world, m
    pub velocity: Vec3,         // world, m/s
    pub orientation: Quat,      // body -> world
    pub angular_velocity: Vec3, // body frame, rad/s (x roll, y yaw, z pitch)
    pub time: f64,              // simulated seconds since reset
    pub crashed: bool,
}

/// Values derived from the current state; recomputed after every `step`.
#[derive(Clone, Copy, Debug, Default)]
pub struct Derived {
    pub airspeed: f64,
    pub mach: f64,
    pub alpha: f64,
    pub beta: f64,
    pub dynamic_pressure: f64,
    pub load_factor: f64, // body-Y specific force / g0
    pub density: f64,
    pub stall_warning: bool,
}

pub struct Sim {
    pub params: AircraftParams,
    pub state: BodyState,
    pub controls: Controls,
    pub derived: Derived,
}

fn smoothstep(e0: f64, e1: f64, x: f64) -> f64 {
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Lift coefficient vs. angle of attack: linear up to the stall angle, plateau, then a smooth
/// blend into a flat-plate-like post-stall curve.
pub fn lift_coefficient(p: &AircraftParams, alpha: f64) -> f64 {
    let a_att = alpha.clamp(-p.alpha_stall, p.alpha_stall);
    let attached = p.cl0 + p.cl_alpha * a_att;
    let post = p.post_stall_cl * (2.0 * alpha).sin();
    let s = smoothstep(p.alpha_stall, p.alpha_stall + 0.12, alpha.abs());
    attached * (1.0 - s) + post * s
}

/// Weight of the post-stall regime (0 = attached, 1 = fully stalled).
fn stall_blend(p: &AircraftParams, alpha: f64) -> f64 {
    smoothstep(p.alpha_stall, p.alpha_stall + 0.12, alpha.abs())
}

impl Sim {
    pub fn new(params: AircraftParams) -> Sim {
        let mut s = Sim {
            params,
            state: BodyState {
                position: Vec3::ZERO,
                velocity: Vec3::ZERO,
                orientation: Quat::IDENTITY,
                angular_velocity: Vec3::ZERO,
                time: 0.0,
                crashed: false,
            },
            controls: Controls::default(),
            derived: Derived::default(),
        };
        s.reset();
        s
    }

    /// Level flight heading north at the aircraft's start altitude / speed.
    pub fn reset(&mut self) {
        let p = self.params;
        let heading = Quat::from_axis_angle(Vec3::new(0.0, 1.0, 0.0), std::f64::consts::FRAC_PI_2);
        let pitch = Quat::from_axis_angle(Vec3::new(0.0, 0.0, 1.0), p.start_alpha);
        self.state = BodyState {
            position: Vec3::new(0.0, p.start_altitude, 0.0),
            velocity: Vec3::new(0.0, 0.0, -p.start_speed),
            orientation: heading.compose(pitch).normalized(),
            angular_velocity: Vec3::ZERO,
            time: 0.0,
            crashed: false,
        };
        self.controls = Controls { throttle: p.start_throttle, ..Controls::default() };
        self.refresh_derived();
    }

    pub fn set_controls(&mut self, c: Controls) {
        self.controls = c.sanitized();
    }

    /// Net aerodynamic + thrust force (body frame, N), moment (body frame, N m) and derived values.
    fn forces_and_moments(&self, st: &BodyState, ctl: &Controls) -> (Vec3, Vec3, Derived) {
        let p = &self.params;
        let atmo = isa(st.position.y);
        let v_body = st.orientation.conjugate().rotate(st.velocity);
        let v = v_body.length();

        let thrust = ctl.throttle * p.max_thrust_sl * (atmo.density / RHO0).powf(0.8);
        let mut force = Vec3::new(thrust, 0.0, 0.0);
        let mut moment = Vec3::ZERO;
        let mut d = Derived {
            airspeed: v,
            mach: v / atmo.speed_of_sound,
            density: atmo.density,
            ..Derived::default()
        };
        if v < 1.0 {
            d.load_factor = force.y / (p.mass * G0);
            return (force, moment, d);
        }

        let v_hat = v_body * (1.0 / v);
        let alpha = (-v_body.y).atan2(v_body.x);
        let beta = (v_body.z / v).clamp(-1.0, 1.0).asin();
        let q = 0.5 * atmo.density * v * v;
        let qs = q * p.wing_area;
        let sa = alpha.sin();

        // Coefficients
        let cl = lift_coefficient(p, alpha);
        let blend = stall_blend(p, alpha);
        let mut cd = p.cd0 + p.induced_k * cl * cl + blend * p.post_stall_cd * sa * sa;
        let dm = (d.mach - 0.85).clamp(0.0, 0.5);
        cd += 1.5 * dm * dm; // crude transonic drag rise

        // Forces
        let lift_dir = Vec3::new(0.0, 0.0, 1.0).cross(v_hat).normalized().unwrap_or(Vec3::ZERO);
        force = force + lift_dir * (qs * cl) + v_hat * (-qs * cd) + Vec3::new(0.0, 0.0, -qs * p.cy_beta * beta);

        // Moments (rates made non-dimensional with a floor on V to avoid blow-up at low speed)
        let vc = v.max(30.0);
        let w = st.angular_velocity;
        let p_hat = w.x * p.span / (2.0 * vc);
        let q_hat = w.z * p.chord / (2.0 * vc);
        let r_hat = w.y * p.span / (2.0 * vc);
        moment.x = qs * p.span * (p.cl_p * p_hat + p.cl_aileron * ctl.roll - p.cl_beta * beta);
        moment.y = qs * p.span * (-p.cn_beta * beta - p.cn_rudder * ctl.yaw + p.cn_r * r_hat);
        moment.z = qs * p.chord * (p.cm0 + p.cm_alpha * sa + p.cm_q * q_hat + p.cm_elevator * ctl.pitch);

        d.alpha = alpha;
        d.beta = beta;
        d.dynamic_pressure = q;
        d.load_factor = force.y / (p.mass * G0);
        d.stall_warning = alpha.abs() > 0.85 * p.alpha_stall;
        (force, moment, d)
    }

    fn refresh_derived(&mut self) {
        let (_, _, d) = self.forces_and_moments(&self.state, &self.controls);
        self.derived = d;
    }

    fn substep(&mut self, h: f64) {
        let st = self.state;
        let ctl = self.controls;
        let p = self.params;
        let (f, m, _) = self.forces_and_moments(&st, &ctl);

        // Translational
        let acc = st.orientation.rotate(f) * (1.0 / p.mass) + Vec3::new(0.0, -G0, 0.0);
        let velocity = st.velocity + acc * h;
        let mut position = st.position + velocity * h;

        // Rotational: I w' = M - w x (I w)
        let w = st.angular_velocity;
        let i = p.inertia;
        let iw = Vec3::new(i.x * w.x, i.y * w.y, i.z * w.z);
        let g = w.cross(iw);
        let ang_acc = Vec3::new((m.x - g.x) / i.x, (m.y - g.y) / i.y, (m.z - g.z) / i.z);
        let angular_velocity = w + ang_acc * h;

        // q' = 0.5 * q * (0, w_body)
        let o = st.orientation;
        let w2 = angular_velocity;
        let qd = o.compose(Quat { x: w2.x, y: w2.y, z: w2.z, w: 0.0 });
        let orientation = Quat {
            x: o.x + 0.5 * h * qd.x,
            y: o.y + 0.5 * h * qd.y,
            z: o.z + 0.5 * h * qd.z,
            w: o.w + 0.5 * h * qd.w,
        }
        .normalized();

        let mut next = BodyState { position, velocity, orientation, angular_velocity, ..st };

        // Phase-1 ground model: terrain is the plane y = 0; contact ends the flight.
        if position.y <= 0.0 {
            position.y = 0.0;
            next.position = position;
            next.velocity = Vec3::ZERO;
            next.angular_velocity = Vec3::ZERO;
            next.crashed = true;
        }
        self.state = next;
    }

    /// Advance the simulation by `dt` seconds (typically 1/30).
    pub fn step(&mut self, dt: f64) {
        if !(dt.is_finite() && dt > 0.0) {
            return;
        }
        if !self.state.crashed {
            let n = (dt / MAX_SUBSTEP).ceil().max(1.0) as usize;
            let h = dt / n as f64;
            for _ in 0..n {
                self.substep(h);
                if self.state.crashed {
                    break;
                }
            }
            let s = &self.state;
            if !(s.position.is_finite() && s.velocity.is_finite() && s.orientation.is_finite()
                && s.angular_velocity.is_finite())
            {
                self.reset(); // numerical failure: recover instead of propagating NaN
            }
        }
        self.state.time += dt;
        self.refresh_derived();
    }

    /// Unit vector helpers for tests / HUD logic.
    pub fn forward(&self) -> Vec3 {
        self.state.orientation.rotate(Vec3::new(1.0, 0.0, 0.0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DT: f64 = 1.0 / 30.0;

    fn run(sim: &mut Sim, seconds: f64) {
        for _ in 0..(seconds / DT).round() as usize {
            sim.step(DT);
        }
    }

    fn fighter() -> Sim {
        Sim::new(AircraftParams::generic_fighter())
    }

    #[test]
    fn lift_curve_is_odd_and_stalls() {
        let p = AircraftParams::generic_fighter();
        assert!((lift_coefficient(&p, 0.2) + lift_coefficient(&p, -0.2)).abs() < 1e-12);
        assert!(lift_coefficient(&p, 0.2) > 0.0);
        let at_stall = lift_coefficient(&p, p.alpha_stall);
        assert!(lift_coefficient(&p, 0.6) < at_stall, "lift must fall after stall");
    }

    #[test]
    fn deterministic_replay() {
        let (mut a, mut b) = (fighter(), fighter());
        for k in 0..600 {
            let c = Controls { throttle: 0.6, pitch: ((k as f64) * 0.05).sin(), roll: 0.2, yaw: 0.0 };
            a.set_controls(c);
            b.set_controls(c);
            a.step(DT);
            b.step(DT);
        }
        assert_eq!(a.state.position, b.state.position);
        assert_eq!(a.state.orientation, b.state.orientation);
    }

    #[test]
    fn orientation_stays_unit_length() {
        let mut s = fighter();
        s.set_controls(Controls { throttle: 0.8, pitch: 0.3, roll: 1.0, yaw: 0.2 });
        run(&mut s, 30.0);
        assert!((s.state.orientation.norm() - 1.0).abs() < 1e-9);
    }

    #[test]
    fn hands_off_flight_stays_airborne_and_bounded() {
        let mut s = fighter();
        run(&mut s, 30.0);
        assert!(!s.state.crashed);
        assert!((s.state.position.y - 2000.0).abs() < 1500.0);
        assert!(s.derived.airspeed > 60.0 && s.derived.airspeed < 400.0);
    }

    #[test]
    fn stick_back_pitches_nose_up() {
        let mut s = fighter();
        let before = s.forward().y;
        s.set_controls(Controls { throttle: 0.5, pitch: 1.0, ..Controls::default() });
        run(&mut s, 0.5);
        assert!(s.state.angular_velocity.z > 0.0);
        assert!(s.forward().y > before);
    }

    #[test]
    fn roll_right_input_rolls_right_wing_down() {
        let mut s = fighter();
        s.set_controls(Controls { throttle: 0.5, roll: 1.0, ..Controls::default() });
        run(&mut s, 0.5);
        assert!(s.state.angular_velocity.x > 0.0);
        let right_wing_world = s.state.orientation.rotate(Vec3::new(0.0, 0.0, 1.0));
        assert!(right_wing_world.y < 0.0, "right wing should be below the horizon");
    }

    #[test]
    fn right_rudder_yaws_nose_right() {
        let mut s = fighter();
        s.set_controls(Controls { throttle: 0.5, yaw: 1.0, ..Controls::default() });
        run(&mut s, 0.5);
        assert!(s.state.angular_velocity.y < 0.0, "yaw right = negative rotation about +Y(up)");
        let nose = s.forward();
        assert!(nose.x > 0.0, "north-facing nose should swing toward east (+X)");
    }

    #[test]
    fn more_throttle_means_more_speed() {
        let (mut lo, mut hi) = (fighter(), fighter());
        lo.set_controls(Controls { throttle: 0.0, ..Controls::default() });
        hi.set_controls(Controls { throttle: 1.0, ..Controls::default() });
        run(&mut lo, 5.0);
        run(&mut hi, 5.0);
        assert!(hi.derived.airspeed > lo.derived.airspeed);
    }

    #[test]
    fn ground_contact_ends_flight() {
        let mut s = fighter();
        s.state.position.y = 20.0;
        s.state.velocity = Vec3::new(0.0, -50.0, -100.0);
        s.set_controls(Controls::default());
        run(&mut s, 2.0);
        assert!(s.state.crashed);
        assert_eq!(s.state.position.y, 0.0);
    }

    #[test]
    fn nan_controls_are_neutralised() {
        let mut s = fighter();
        s.set_controls(Controls { throttle: f64::NAN, pitch: f64::INFINITY, roll: f64::NAN, yaw: 0.0 });
        run(&mut s, 1.0);
        assert!(s.state.position.is_finite());
    }
}
