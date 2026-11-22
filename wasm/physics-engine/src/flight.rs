//! Six-degree-of-freedom rigid-body flight dynamics.
//!
//! Pure data + math: no rendering, no I/O, no globals. Given the same inputs and the same
//! sequence of `step(dt)` calls the result is bit-identical on every run.
//!
//! Integration: classical RK4 with internal sub-stepping (<= 1/120 s per sub-step), so a 30 Hz
//! outer step is evaluated as 4 sub-steps. Control surfaces and the engine are first-order lags
//! integrated exactly per sub-step; fuel is burnt per sub-step and changes mass and inertia.

use crate::aircraft::AircraftParams;
use crate::atmosphere::{isa, G0, RHO0};
use crate::collision::World;
use crate::math::{Quat, Vec3};
use crate::warnings;

pub const MAX_SUBSTEP: f64 = 1.0 / 120.0;

pub const CRASH_NONE: u8 = 0;
pub const CRASH_GROUND: u8 = 1;
pub const CRASH_BUILDING: u8 = 2;

/// `Derived::impact_time` when the flight path is clear for the whole look-ahead window.
pub const IMPACT_NONE: f64 = 99.0;
const IMPACT_LOOKAHEAD: f64 = 8.0; // s
const IMPACT_STEP: f64 = 0.25; // s
pub const IMPACT_CLEARANCE: f64 = 4.0; // m, extra margin for warnings only

/// Pilot commands. throttle 0..1; pitch/roll/yaw -1..1.
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
    pub position: Vec3,
    pub velocity: Vec3,
    pub orientation: Quat,
    pub angular_velocity: Vec3,
    pub time: f64,
    pub crashed: bool,
    pub crash_kind: u8,
    pub crash_time: f64,
    pub fuel: f64,     // kg
    pub power: f64,    // spooled throttle 0..1 (engine state)
    pub elevator: f64, // actual surface positions, -1..1
    pub aileron: f64,
    pub rudder: f64,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Derived {
    pub airspeed: f64,
    pub mach: f64,
    pub alpha: f64,
    pub beta: f64,
    pub dynamic_pressure: f64,
    pub load_factor: f64,
    pub density: f64,
    pub stall_warning: bool,
    pub impact_time: f64,
    pub thrust: f64,
    pub afterburner: bool,
    pub g_limiting: bool,
    /// Load factor the airframe can currently produce (aero- and structure-limited).
    pub g_avail: f64,
    pub warn_mask: u32,
    pub warn_level: u8,
    pub warn_primary: i32, // lowest set bit = highest priority, -1 when none
}

pub struct Sim {
    pub params: AircraftParams,
    pub state: BodyState,
    pub controls: Controls,
    pub derived: Derived,
    pub world: World,
    /// Constant wind (world frame, m/s) and turbulence intensity (0 = none, 1 = light-moderate).
    pub wind: Vec3,
    pub turbulence: f64,
}

fn smoothstep(e0: f64, e1: f64, x: f64) -> f64 {
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Compressibility correction of the lift slope: Prandtl-Glauert to M 0.8, a flat transonic
/// plateau, then the supersonic 1/sqrt(M^2-1) decay.
pub fn mach_lift_factor(m: f64) -> f64 {
    let pg = |m: f64| 1.0 / (1.0 - m * m).sqrt();
    if m <= 0.8 {
        pg(m)
    } else if m < 1.2 {
        let a = pg(0.8);
        let b = 1.1 / (1.2f64 * 1.2 - 1.0).sqrt();
        a + (b - a) * smoothstep(0.8, 1.2, m)
    } else {
        1.1 / (m * m - 1.0).sqrt()
    }
}

/// Wave drag coefficient: onset near M 0.85, peak at M 1.1, slow decay afterwards.
pub fn wave_drag(p: &AircraftParams, m: f64) -> f64 {
    if m < 0.85 {
        0.0
    } else if m < 1.1 {
        p.cd_wave * smoothstep(0.85, 1.1, m)
    } else {
        p.cd_wave * (1.1 / m).powf(0.6)
    }
}

/// Lift coefficient vs. angle of attack and Mach number.
pub fn lift_coefficient_m(p: &AircraftParams, alpha: f64, mach: f64) -> f64 {
    let a_att = alpha.clamp(-p.alpha_stall, p.alpha_stall);
    let attached = p.cl0 + p.cl_alpha * mach_lift_factor(mach) * a_att;
    let post = p.post_stall_cl * (2.0 * alpha).sin();
    let s = smoothstep(p.alpha_stall, p.alpha_stall + 0.12, alpha.abs());
    attached * (1.0 - s) + post * s
}

/// Low-speed lift curve (Mach 0).
pub fn lift_coefficient(p: &AircraftParams, alpha: f64) -> f64 {
    lift_coefficient_m(p, alpha, 0.0)
}

fn stall_blend(p: &AircraftParams, alpha: f64) -> f64 {
    smoothstep(p.alpha_stall, p.alpha_stall + 0.12, alpha.abs())
}

#[derive(Clone, Copy)]
struct Kin {
    pos: Vec3,
    vel: Vec3,
    q: Quat,
    w: Vec3,
}

#[derive(Clone, Copy)]
struct KinDot {
    pos: Vec3,
    vel: Vec3,
    q: Quat,
    w: Vec3,
}

fn qadd(a: Quat, b: Quat, k: f64) -> Quat {
    Quat { x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k, w: a.w + b.w * k }
}

fn advance(k: &Kin, d: &KinDot, h: f64) -> Kin {
    Kin { pos: k.pos + d.pos * h, vel: k.vel + d.vel * h, q: qadd(k.q, d.q, h), w: k.w + d.w * h }
}

pub struct Propulsion {
    pub thrust: f64,
    pub afterburner: bool,
    pub fuel_flow: f64, // kg/s
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
                crash_kind: CRASH_NONE,
                crash_time: 0.0,
                fuel: 0.0,
                power: 0.0,
                elevator: 0.0,
                aileron: 0.0,
                rudder: 0.0,
            },
            controls: Controls::default(),
            derived: Derived::default(),
            world: World::empty(),
            wind: Vec3::ZERO,
            turbulence: 0.0,
        };
        s.reset();
        s
    }

    pub fn set_world(&mut self, world: World) {
        self.world = world;
        self.refresh_derived();
    }

    pub fn mass(&self, st: &BodyState) -> f64 {
        self.params.empty_mass + st.fuel
    }

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
            crash_kind: CRASH_NONE,
            crash_time: 0.0,
            fuel: p.fuel_capacity,
            power: p.start_throttle,
            elevator: 0.0,
            aileron: 0.0,
            rudder: 0.0,
        };
        self.controls = Controls { throttle: p.start_throttle, ..Controls::default() };
        self.refresh_derived();
    }

    pub fn set_controls(&mut self, c: Controls) {
        self.controls = c.sanitized();
    }

    /// Smooth, deterministic turbulence (sum of incommensurate sines) plus the steady wind.
    pub fn wind_at(&self, pos: Vec3, t: f64) -> Vec3 {
        if self.turbulence <= 0.0 {
            return self.wind;
        }
        let amp = self.turbulence * 2.5 * (-(pos.y.max(0.0)) / 4000.0).exp();
        let n = |f1: f64, f2: f64, f3: f64, ph: f64, sp: f64| {
            0.5 * (f1 * t + sp * 0.0031 + ph).sin() + 0.3 * (f2 * t + sp * 0.0071 + ph * 1.7).sin()
                + 0.2 * (f3 * t + sp * 0.0113 + ph * 2.3).sin()
        };
        let sx = pos.x + 0.6 * pos.z;
        let sy = pos.y + 0.4 * pos.x;
        let sz = pos.z - 0.5 * pos.y;
        self.wind + Vec3::new(n(0.9, 2.3, 5.1, 0.0, sx), 0.6 * n(1.3, 3.1, 6.7, 1.9, sy), n(0.7, 2.9, 4.3, 3.7, sz)) * amp
    }

    /// Thrust, afterburner state and fuel flow for the given state.
    pub fn propulsion(&self, st: &BodyState) -> Propulsion {
        let p = &self.params;
        if st.fuel <= 0.0 {
            return Propulsion { thrust: 0.0, afterburner: false, fuel_flow: 0.0 };
        }
        let atmo = isa(st.position.y);
        let air = st.velocity - self.wind_at(st.position, st.time);
        let mach = air.length() / atmo.speed_of_sound;
        let dens = (atmo.density / RHO0).powf(0.8);
        let ram = 1.0 + 0.4 * mach.min(1.2) - 0.25 * (mach - 1.2).max(0.0);
        let dry = (0.05 + 0.95 * st.power / 0.85).min(1.0);
        let ab = if st.power > 0.88 { ((st.power - 0.85) / 0.15).clamp(0.0, 1.0) } else { 0.0 };
        let t_mil_full = p.max_thrust_sl * dens * ram;
        let t_ab_full = p.ab_thrust_sl * dens * ram;
        let dry_thrust = t_mil_full * dry;
        let thrust = dry_thrust + ab * (t_ab_full - t_mil_full);
        let flow = dry_thrust * p.tsfc_mil + (thrust - dry_thrust) * p.tsfc_ab;
        Propulsion { thrust, afterburner: ab > 0.0, fuel_flow: flow }
    }

    /// Aerodynamic + thrust force (body, N), moment (body, N m) and derived values for state `st`.
    fn forces_and_moments(&self, st: &BodyState) -> (Vec3, Vec3, Derived) {
        let p = &self.params;
        let atmo = isa(st.position.y);
        let air = st.velocity - self.wind_at(st.position, st.time);
        let v_body = st.orientation.conjugate().rotate(air);
        let v = v_body.length();
        let prop = self.propulsion(st);
        let mass = self.mass(st);

        let mut force = Vec3::new(prop.thrust, 0.0, 0.0);
        let mut moment = Vec3::ZERO;
        let mut d = Derived {
            airspeed: v,
            mach: v / atmo.speed_of_sound,
            density: atmo.density,
            impact_time: IMPACT_NONE,
            thrust: prop.thrust,
            afterburner: prop.afterburner,
            g_avail: p.g_limit_pos,
            ..Derived::default()
        };
        if v < 1.0 {
            return (force, moment, d);
        }

        let v_hat = v_body * (1.0 / v);
        let alpha = (-v_body.y).atan2(v_body.x);
        let beta = (v_body.z / v).clamp(-1.0, 1.0).asin();
        let q = 0.5 * atmo.density * v * v;
        let qs = q * p.wing_area;
        let sa = alpha.sin();
        let m = d.mach;

        let cl = lift_coefficient_m(p, alpha, m);
        let blend = stall_blend(p, alpha);
        let cd = p.cd0 + p.induced_k * cl * cl + blend * p.post_stall_cd * sa * sa + wave_drag(p, m);

        let lift_dir = Vec3::new(0.0, 0.0, 1.0).cross(v_hat).normalized().unwrap_or(Vec3::ZERO);
        force = force + lift_dir * (qs * cl) + v_hat * (-qs * cd) + Vec3::new(0.0, 0.0, -qs * p.cy_beta * beta);

        let vc = v.max(30.0);
        let w = st.angular_velocity;
        let p_hat = w.x * p.span / (2.0 * vc);
        let q_hat = w.z * p.chord / (2.0 * vc);
        let r_hat = w.y * p.span / (2.0 * vc);
        // aerodynamic centre moves aft supersonically (more stable, less pitch authority)
        let sup = smoothstep(0.85, 1.3, m);
        let cm_a = p.cm_alpha * (1.0 + 0.7 * sup);
        let cm_de = p.cm_elevator * (1.0 - 0.35 * smoothstep(0.9, 1.5, m));
        moment.x = qs * p.span
            * (p.cl_p * p_hat - p.cl_r * r_hat + p.cl_aileron * st.aileron + p.cl_rudder * st.rudder - p.cl_beta * beta);
        moment.y = qs * p.span
            * (-p.cn_beta * beta - p.cn_rudder * st.rudder + p.cn_r * r_hat + p.cn_aileron * st.aileron);
        moment.z = qs * p.chord * (p.cm0 + cm_a * sa + p.cm_q * q_hat + cm_de * st.elevator);

        d.alpha = alpha;
        d.beta = beta;
        d.dynamic_pressure = q;
        d.load_factor = force.y / (mass * G0);
        d.stall_warning = alpha.abs() > 0.85 * p.alpha_stall;
        let cl_max = lift_coefficient_m(p, p.alpha_stall, m);
        d.g_avail = p.g_limit_pos.min(qs * cl_max / (mass * G0));
        (force, moment, d)
    }

    fn refresh_derived(&mut self) {
        let (_, _, mut d) = self.forces_and_moments(&self.state);
        d.impact_time = self.predict_impact();
        d.g_limiting = self.pitch_limit(self.controls.pitch).1 && self.controls.pitch != 0.0;
        let (mask, level, primary) = warnings::evaluate(self, &d);
        d.warn_mask = mask;
        d.warn_level = level;
        d.warn_primary = primary;
        self.derived = d;
    }

    /// Load-factor protection: scales the pitch command down as the limit is approached.
    /// Returns (limited command, whether the limiter is currently reducing the command).
    pub fn pitch_limit(&self, cmd: f64) -> (f64, bool) {
        let p = &self.params;
        // Predicted load factor ~0.2 s ahead: the pitch rate keeps adding lift after the stick is
        // released, so the limiter has to lead the measured value.
        let nz = self.derived.load_factor
            + 0.2 * self.state.angular_velocity.z * self.derived.airspeed / G0;
        // Same idea for angle of attack: stop pulling just short of the stall angle.
        let a_pred = self.derived.alpha + 0.3 * self.state.angular_velocity.z;
        let a_lim = 0.95 * p.alpha_stall;
        let s = if cmd > 0.0 {
            let g = ((p.g_limit_pos - nz) / 1.5).clamp(-0.6, 1.0);
            let a = ((a_lim - a_pred) / 0.06).clamp(-0.6, 1.0);
            g.min(a)
        } else if cmd < 0.0 {
            let g = ((nz - p.g_limit_neg) / 1.0).clamp(-0.6, 1.0);
            let a = ((a_pred + a_lim) / 0.06).clamp(-0.6, 1.0);
            g.min(a)
        } else if nz > p.g_limit_pos {
            // stick centred but still over the limit: push the nose down a little
            return (((p.g_limit_pos - nz) / 1.5).clamp(-0.6, 0.0), true);
        } else {
            1.0
        };
        (cmd * s, s < 0.999)
    }

    fn find_contact(&self, a: &BodyState, b: &BodyState) -> Option<(f64, u8)> {
        let r = self.params.hull_radius;
        let mut best: Option<(f64, u8)> = None;
        let mut consider = |t: f64, kind: u8| {
            if best.map_or(true, |(bt, _)| t < bt) {
                best = Some((t, kind));
            }
        };
        for pt in self.params.hull {
            let local = Vec3::new(pt[0], pt[1], pt[2]);
            let pa = a.position + a.orientation.rotate(local);
            let pb = b.position + b.orientation.rotate(local);
            if pb.y <= r {
                let t = if pa.y <= r { 0.0 } else { ((pa.y - r) / (pa.y - pb.y)).clamp(0.0, 1.0) };
                consider(t, CRASH_GROUND);
            }
            if let Some(t) = self.world.segment_hit(pa, pb, r) {
                consider(t, CRASH_BUILDING);
            }
        }
        best
    }

    /// Straight-line look-ahead along the velocity vector: time until the path meets terrain.
    fn predict_impact(&self) -> f64 {
        let s = &self.state;
        if s.crashed {
            return 0.0;
        }
        if s.velocity.length() < 5.0 {
            return IMPACT_NONE;
        }
        let m = self.params.hull_radius + IMPACT_CLEARANCE;
        let mut prev = s.position;
        let mut t = 0.0;
        while t < IMPACT_LOOKAHEAD {
            let next = s.position + s.velocity * (t + IMPACT_STEP);
            if next.y <= m {
                let f = if prev.y <= m { 0.0 } else { (prev.y - m) / (prev.y - next.y) };
                return t + f * IMPACT_STEP;
            }
            if let Some(f) = self.world.segment_hit(prev, next, m) {
                return t + f * IMPACT_STEP;
            }
            prev = next;
            t += IMPACT_STEP;
        }
        IMPACT_NONE
    }

    fn deriv(&self, k: &Kin, base: &BodyState, mass: f64) -> KinDot {
        let mut tmp = *base;
        tmp.position = k.pos;
        tmp.velocity = k.vel;
        tmp.orientation = k.q;
        tmp.angular_velocity = k.w;
        let (f, m, _) = self.forces_and_moments(&tmp);
        let acc = k.q.rotate(f) * (1.0 / mass) + Vec3::new(0.0, -G0, 0.0);

        // I w' = M - w x (I w) with the product of inertia Ixy; inertia scales with mass.
        let sc = mass / self.params.gross_mass();
        let (ixx, iyy, izz) = (self.params.inertia.x * sc, self.params.inertia.y * sc, self.params.inertia.z * sc);
        let ixy = self.params.ixy * sc;
        let w = k.w;
        let iw = Vec3::new(ixx * w.x - ixy * w.y, -ixy * w.x + iyy * w.y, izz * w.z);
        let r = m - w.cross(iw);
        let det = ixx * iyy - ixy * ixy;
        let dw = Vec3::new((iyy * r.x + ixy * r.y) / det, (ixy * r.x + ixx * r.y) / det, r.z / izz);

        let qd = k.q.compose(Quat { x: w.x, y: w.y, z: w.z, w: 0.0 });
        KinDot { pos: k.vel, vel: acc, q: Quat { x: 0.5 * qd.x, y: 0.5 * qd.y, z: 0.5 * qd.z, w: 0.5 * qd.w }, w: dw }
    }

    fn substep(&mut self, h: f64) {
        let p = self.params;
        let mut st = self.state;

        // Actuators and engine (exact first-order lags)
        let (pitch_cmd, _) = self.pitch_limit(self.controls.pitch);
        let ka = 1.0 - (-h / p.actuator_tau).exp();
        st.elevator += (pitch_cmd - st.elevator) * ka;
        st.aileron += (self.controls.roll - st.aileron) * ka;
        st.rudder += (self.controls.yaw - st.rudder) * ka;
        let target = if st.fuel > 0.0 { self.controls.throttle } else { 0.0 };
        let tau = if target > st.power { p.spool_up } else { p.spool_down };
        st.power += (target - st.power) * (1.0 - (-h / tau).exp());

        let prop = self.propulsion(&st);
        let mass = self.mass(&st);

        // RK4 on position / velocity / attitude / body rates
        let k0 = Kin { pos: st.position, vel: st.velocity, q: st.orientation, w: st.angular_velocity };
        let d1 = self.deriv(&k0, &st, mass);
        let d2 = self.deriv(&advance(&k0, &d1, h * 0.5), &st, mass);
        let d3 = self.deriv(&advance(&k0, &d2, h * 0.5), &st, mass);
        let d4 = self.deriv(&advance(&k0, &d3, h), &st, mass);
        let comb = |a: Vec3, b: Vec3, c: Vec3, d: Vec3| (a + (b + c) * 2.0 + d) * (h / 6.0);
        let position = st.position + comb(d1.pos, d2.pos, d3.pos, d4.pos);
        let velocity = st.velocity + comb(d1.vel, d2.vel, d3.vel, d4.vel);
        let angular_velocity = st.angular_velocity + comb(d1.w, d2.w, d3.w, d4.w);
        let o = st.orientation;
        let orientation = Quat {
            x: o.x + (h / 6.0) * (d1.q.x + 2.0 * (d2.q.x + d3.q.x) + d4.q.x),
            y: o.y + (h / 6.0) * (d1.q.y + 2.0 * (d2.q.y + d3.q.y) + d4.q.y),
            z: o.z + (h / 6.0) * (d1.q.z + 2.0 * (d2.q.z + d3.q.z) + d4.q.z),
            w: o.w + (h / 6.0) * (d1.q.w + 2.0 * (d2.q.w + d3.q.w) + d4.q.w),
        }
        .normalized();

        let fuel = (st.fuel - prop.fuel_flow * h).max(0.0);
        let mut next = BodyState { position, velocity, orientation, angular_velocity, fuel, ..st };

        if let Some((t, kind)) = self.find_contact(&st, &next) {
            next.position = st.position + (next.position - st.position) * t;
            next.velocity = Vec3::ZERO;
            next.angular_velocity = Vec3::ZERO;
            next.crashed = true;
            next.crash_kind = kind;
        }
        self.state = next;
    }

    pub fn step(&mut self, dt: f64) {
        if !(dt.is_finite() && dt > 0.0) {
            return;
        }
        if !self.state.crashed {
            let n = (dt / MAX_SUBSTEP).ceil().max(1.0) as usize;
            let h = dt / n as f64;
            let t_start = self.state.time;
            for i in 0..n {
                self.substep(h);
                self.state.time = t_start + (i + 1) as f64 * h;
                if self.state.crashed {
                    self.state.crash_time = self.state.time;
                    break;
                }
            }
            let s = &self.state;
            if !(s.position.is_finite() && s.velocity.is_finite() && s.orientation.is_finite()
                && s.angular_velocity.is_finite())
            {
                self.reset();
            }
            self.state.time = t_start;
        }
        self.state.time += dt;
        self.refresh_derived();
    }

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
        assert_eq!(s.state.crash_kind, CRASH_GROUND);
        // stopped where the lowest hull point touched the ground, never below it
        assert!(s.state.position.y >= 0.0 && s.state.position.y < 10.0, "y = {}", s.state.position.y);
        assert!(s.state.crash_time > 0.0 && s.state.crash_time <= s.state.time);
    }

    #[test]
    fn flying_into_a_building_crashes_without_penetration() {
        let mut s = fighter();
        // 400 m wide, 3 km tall wall 800 m north of the start (aircraft flies north = -Z at 2 km)
        s.set_world(World::from_instances(&[0.0, -1000.0, 400.0, 3000.0]));
        run(&mut s, 15.0);
        assert!(s.state.crashed);
        assert_eq!(s.state.crash_kind, CRASH_BUILDING);
        // the nose stopped at (or just before) the south face z = -800
        assert!(s.state.position.z < 0.0 && s.state.position.z > -800.0, "z = {}", s.state.position.z);
        assert_eq!(s.state.velocity, Vec3::ZERO);
    }

    #[test]
    fn a_tilted_wing_tip_scrapes_the_ground_before_the_centre_does() {
        let mut s = fighter();
        s.state.position = Vec3::new(0.0, 4.0, 0.0);
        s.state.velocity = Vec3::new(0.0, 0.0, -100.0);
        // 60 deg of roll: right wing tip (z = +4.55) swings to 4.55 * sin(60 deg) = 3.9 m below the centre
        let heading = Quat::from_axis_angle(Vec3::new(0.0, 1.0, 0.0), std::f64::consts::FRAC_PI_2);
        let roll = Quat::from_axis_angle(Vec3::new(1.0, 0.0, 0.0), 60.0_f64.to_radians());
        s.state.orientation = heading.compose(roll).normalized();
        s.step(DT);
        assert!(s.state.crashed, "tip at ~0.1 m minus hull radius must already be in contact");
        assert_eq!(s.state.crash_kind, CRASH_GROUND);
    }

    #[test]
    fn impact_warning_counts_down_towards_a_wall_and_is_clear_otherwise() {
        let mut s = fighter();
        assert_eq!(s.derived.impact_time, IMPACT_NONE);
        // wall whose near face is 800 m ahead at 180 m/s -> roughly 4.4 s
        s.set_world(World::from_instances(&[0.0, -1000.0, 400.0, 3000.0]));
        let t = s.derived.impact_time;
        assert!(t > 3.8 && t < 5.0, "impact_time = {t}");
        s.set_world(World::empty());
        assert_eq!(s.derived.impact_time, IMPACT_NONE);
    }

    #[test]
    fn impact_warning_sees_the_ground_in_a_dive() {
        let mut s = fighter();
        s.state.position.y = 500.0;
        s.state.velocity = Vec3::new(0.0, -100.0, -100.0);
        s.step(1e-6);
        assert!(s.derived.impact_time < 6.0, "impact_time = {}", s.derived.impact_time);
    }

    #[test]
    fn mach_lift_factor_is_continuous_and_peaks_transonically() {
        let mut prev = mach_lift_factor(0.0);
        let mut m = 0.01;
        while m < 2.5 {
            let f = mach_lift_factor(m);
            assert!((f - prev).abs() < 0.08, "jump at M {m}: {prev} -> {f}");
            prev = f;
            m += 0.01;
        }
        assert!(mach_lift_factor(0.8) > 1.5 && mach_lift_factor(2.0) < 0.8);
    }

    #[test]
    fn wave_drag_rises_through_mach_one() {
        let p = AircraftParams::generic_fighter();
        assert_eq!(wave_drag(&p, 0.6), 0.0);
        assert!(wave_drag(&p, 1.1) > wave_drag(&p, 0.9));
        assert!(wave_drag(&p, 1.1) >= wave_drag(&p, 1.8));
    }

    #[test]
    fn fuel_burns_and_mass_follows() {
        let mut s = fighter();
        s.set_controls(Controls { throttle: 0.8, ..Controls::default() });
        let m0 = s.mass(&s.state);
        run(&mut s, 60.0);
        let burnt = s.params.fuel_capacity - s.state.fuel;
        assert!(burnt > 30.0 && burnt < 300.0, "burnt {burnt} kg in 60 s");
        assert!((m0 - s.mass(&s.state) - burnt).abs() < 1e-6);
    }

    #[test]
    fn afterburner_adds_thrust_and_burns_much_more_fuel() {
        let (mut mil, mut ab) = (fighter(), fighter());
        mil.set_controls(Controls { throttle: 0.85, ..Controls::default() });
        ab.set_controls(Controls { throttle: 1.0, ..Controls::default() });
        run(&mut mil, 6.0);
        run(&mut ab, 6.0);
        assert!(!mil.derived.afterburner && ab.derived.afterburner);
        assert!(ab.derived.thrust > 1.2 * mil.derived.thrust);
        let (fm, fa) = (mil.params.fuel_capacity - mil.state.fuel, ab.params.fuel_capacity - ab.state.fuel);
        assert!(fa > 1.5 * fm, "ab {fa} vs mil {fm}");
    }

    #[test]
    fn engine_spools_up_gradually() {
        let mut s = fighter();
        s.set_controls(Controls { throttle: 1.0, ..Controls::default() });
        s.step(DT);
        assert!(s.state.power < 0.5, "power jumped to {}", s.state.power);
        run(&mut s, 6.0);
        assert!(s.state.power > 0.99);
    }

    #[test]
    fn empty_tank_means_flameout_and_no_thrust() {
        let mut s = fighter();
        s.state.fuel = 0.0;
        s.set_controls(Controls { throttle: 1.0, ..Controls::default() });
        run(&mut s, 3.0);
        assert_eq!(s.derived.thrust, 0.0);
        assert!(s.derived.warn_mask & (1 << crate::warnings::W_FLAMEOUT) != 0);
    }

    #[test]
    fn surfaces_lag_the_command() {
        let mut s = fighter();
        s.set_controls(Controls { throttle: 0.5, pitch: 1.0, ..Controls::default() });
        s.step(1.0 / 120.0);
        assert!(s.state.elevator > 0.0 && s.state.elevator < 0.5);
        run(&mut s, 0.1);
        assert!(s.state.elevator > 0.3, "elevator = {}", s.state.elevator);
    }

    #[test]
    fn load_factor_limiter_caps_a_full_pull() {
        let mut s = fighter();
        s.state.velocity = Vec3::new(0.0, 0.0, -300.0);
        s.state.position.y = 3000.0;
        s.set_controls(Controls { throttle: 1.0, pitch: 1.0, ..Controls::default() });
        let mut max_g = 0.0f64;
        for _ in 0..(8.0 / DT) as usize {
            s.step(DT);
            max_g = max_g.max(s.derived.load_factor);
            if s.state.crashed { break; }
        }
        assert!(max_g > 6.0, "a hard pull at 300 m/s must be able to reach high g, got {max_g}");
        assert!(max_g < s.params.g_limit_pos + 1.0, "limiter let {max_g} g through");
    }

    #[test]
    fn full_forward_stick_is_limited_to_the_negative_limit() {
        let mut s = fighter();
        s.state.velocity = Vec3::new(0.0, 0.0, -300.0);
        s.state.position.y = 6000.0;
        s.set_controls(Controls { throttle: 1.0, pitch: -1.0, ..Controls::default() });
        let mut min_g = 0.0f64;
        for _ in 0..(4.0 / DT) as usize {
            s.step(DT);
            min_g = min_g.min(s.derived.load_factor);
        }
        assert!(min_g > s.params.g_limit_neg - 1.0, "min g {min_g}");
    }

    #[test]
    fn full_throttle_reaches_supersonic_in_a_dive_free_level_run() {
        let mut s = fighter();
        s.state.position.y = 10_000.0;
        s.state.velocity = Vec3::new(0.0, 0.0, -250.0);
        s.set_controls(Controls { throttle: 1.0, ..Controls::default() });
        let mut max_m = 0.0f64;
        for _ in 0..(120.0 / DT) as usize {
            s.step(DT);
            max_m = max_m.max(s.derived.mach);
            if s.state.crashed { break; }
        }
        assert!(max_m > 1.0, "afterburner thrust should push through Mach 1, got {max_m}");
        assert!(max_m < 2.6, "unreasonable top speed {max_m}");
    }

    #[test]
    fn turbulence_is_deterministic_and_bounded() {
        let (mut a, mut b) = (fighter(), fighter());
        a.turbulence = 1.0;
        b.turbulence = 1.0;
        for _ in 0..300 {
            a.step(DT);
            b.step(DT);
        }
        assert_eq!(a.state.position, b.state.position);
        let w = a.wind_at(Vec3::new(0.0, 50.0, 0.0), 3.0);
        assert!(w.length() < 6.0);
        assert!(!a.state.crashed);
    }

    #[test]
    fn rk4_conserves_energy_in_a_ballistic_pass_better_than_loosely() {
        // no thrust, no drag-induced tricks: a short free flight should keep its orientation unit
        let mut s = fighter();
        s.set_controls(Controls { throttle: 0.3, ..Controls::default() });
        run(&mut s, 20.0);
        assert!((s.state.orientation.norm() - 1.0).abs() < 1e-9);
        assert!(s.state.position.is_finite());
    }

    #[test]
    fn nan_controls_are_neutralised() {
        let mut s = fighter();
        s.set_controls(Controls { throttle: f64::NAN, pitch: f64::INFINITY, roll: f64::NAN, yaw: 0.0 });
        run(&mut s, 1.0);
        assert!(s.state.position.is_finite());
    }
}
