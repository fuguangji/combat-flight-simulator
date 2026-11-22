//! Per-aircraft parameter sets. All values SI and radians unless noted.
//!
//! ASSUMPTIONS (see docs/PHYSICS.md): coefficients are order-of-magnitude values for a
//! generic light single-engine fighter, hand-tuned for plausible handling. They are NOT
//! data of any real aircraft.

use crate::math::Vec3;

#[derive(Clone, Copy, Debug)]
pub struct AircraftParams {
    pub name: &'static str,

    // Mass properties. `empty_mass + fuel_capacity` is the gross mass; the principal inertias are
    // given at gross mass and scale linearly with the current mass.
    pub empty_mass: f64,    // kg
    pub fuel_capacity: f64, // kg (internal fuel, full)
    pub inertia: Vec3,      // kg m^2 about body X (roll), Y (yaw), Z (pitch), at gross mass
    pub ixy: f64,           // kg m^2 product of inertia in the symmetry plane (x forward, y up), at gross mass

    // Geometry
    pub wing_area: f64, // m^2
    pub span: f64,      // m
    pub chord: f64,     // m (mean aerodynamic chord)

    // Propulsion
    pub max_thrust_sl: f64, // N, sea-level static, military (dry) power
    pub ab_thrust_sl: f64,  // N, sea-level static, full afterburner
    pub tsfc_mil: f64,      // kg / (N s), dry
    pub tsfc_ab: f64,       // kg / (N s), afterburning
    pub spool_up: f64,      // s, engine time constant when accelerating
    pub spool_down: f64,    // s, engine time constant when decelerating

    // Lift / drag
    pub cl0: f64,
    pub cl_alpha: f64,      // per rad (attached flow)
    pub alpha_stall: f64,   // rad, symmetric
    pub post_stall_cl: f64, // flat-plate-like CL = k * sin(2a)
    pub post_stall_cd: f64, // CD += k * sin^2(a)
    pub cd0: f64,
    pub induced_k: f64,     // CD_i = k * CL^2
    pub cd_wave: f64,       // peak wave-drag coefficient (supersonic)

    // Side force / static stability
    pub cy_beta: f64,  // per rad
    pub cm0: f64,
    pub cm_alpha: f64, // per rad, negative = stable (applied to sin(alpha))
    pub cl_beta: f64,  // dihedral effect, per rad, positive = stable
    pub cn_beta: f64,  // weathercock, per rad, positive = stable

    // Damping (non-dimensional rates p*b/2V, q*c/2V, r*b/2V)
    pub cl_p: f64,
    pub cm_q: f64,
    pub cn_r: f64,
    pub cl_r: f64, // roll due to yaw rate (positive = nose-left yaw rolls the aircraft left)

    // Cross-coupling
    pub cn_aileron: f64, // adverse yaw per unit aileron
    pub cl_rudder: f64,  // roll per unit rudder

    // Control power
    pub cm_elevator: f64,
    pub cl_aileron: f64,
    pub cn_rudder: f64,
    pub actuator_tau: f64, // s, first-order lag of the control surfaces

    // Flight-control limits and structural / warning envelope
    pub g_limit_pos: f64, // g, the control system stops commanding more pull above this
    pub g_limit_neg: f64, // g (negative)
    pub max_q: f64,       // Pa, structural dynamic-pressure limit
    pub max_mach: f64,    // structural / thrust limit

    // Initial condition (for reset)
    pub start_altitude: f64, // m
    pub start_speed: f64,    // m/s
    pub start_alpha: f64,    // rad
    pub start_throttle: f64, // 0..1

    // Collision hull: points on the airframe extremities, body frame [x forward, y up, z right], m.
    // A contact is any of these points touching the ground or entering a building inflated by
    // `hull_radius` (a little thickness so thin features such as wing tips are not skipped).
    pub hull: &'static [[f64; 3]],
    pub hull_radius: f64, // m
}

impl AircraftParams {
    pub fn generic_fighter() -> AircraftParams {
        AircraftParams {
            name: "generic-fighter",
            empty_mass: 9_000.0,
            fuel_capacity: 3_000.0,
            inertia: Vec3::new(12_875.0, 85_552.0, 75_674.0),
            ixy: 1_200.0,
            wing_area: 28.0,
            span: 9.1,
            chord: 3.45,
            max_thrust_sl: 76_000.0,
            ab_thrust_sl: 120_000.0,
            tsfc_mil: 2.3e-5,
            tsfc_ab: 5.6e-5,
            spool_up: 1.1,
            spool_down: 0.7,
            cl0: 0.0,
            cl_alpha: 4.5,
            alpha_stall: 0.30,
            post_stall_cl: 1.1,
            post_stall_cd: 2.0,
            cd0: 0.022,
            induced_k: 0.12,
            cd_wave: 0.055,
            cy_beta: 0.8,
            cm0: 0.03,
            cm_alpha: -0.6,
            cl_beta: 0.08,
            cn_beta: 0.12,
            cl_p: -0.35,
            cm_q: -12.0,
            cn_r: -1.0,
            cl_r: 0.10,
            cn_aileron: 0.004,
            cl_rudder: 0.006,
            cm_elevator: 0.25,
            cl_aileron: 0.04,
            cn_rudder: 0.05,
            actuator_tau: 0.07,
            g_limit_pos: 9.0,
            g_limit_neg: -3.0,
            max_q: 62_000.0,
            max_mach: 2.0,
            start_altitude: 2_000.0,
            start_speed: 180.0,
            start_alpha: 0.05,
            start_throttle: 0.3,
            hull: &[
                [7.5, 0.0, 0.0],   // nose
                [-7.0, 0.0, 0.0],  // tail cone
                [-1.0, 0.0, -4.55], // left wing tip
                [-1.0, 0.0, 4.55], // right wing tip
                [-6.5, 2.6, 0.0],  // fin tip
                [0.0, -1.0, 0.0],  // belly
                [1.0, 1.2, 0.0],   // canopy
            ],
            hull_radius: 1.0,
        }
    }

    /// Gross (full-fuel) mass.
    pub fn gross_mass(&self) -> f64 {
        self.empty_mass + self.fuel_capacity
    }

    pub fn by_id(id: u32) -> Option<AircraftParams> {
        match id {
            0 => Some(AircraftParams::generic_fighter()),
            _ => None,
        }
    }
}
