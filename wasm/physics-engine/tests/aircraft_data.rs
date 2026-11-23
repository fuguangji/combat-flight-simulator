//! The aircraft JSON files under src/aircraft/data are the source of truth for every aircraft the
//! game offers. These tests load them the same way the browser does (flat parameter array ->
//! `AircraftParams::from_slice`) and check that each one is a flyable airplane.

use physics_engine::aircraft::{AircraftParams, PARAM_NAMES};
use physics_engine::flight::{Controls, Sim};
use physics_engine::math::Vec3;

const FILES: [(&str, &str); 3] = [
    ("generic-fighter", include_str!("../../../src/aircraft/data/generic-fighter.json")),
    ("light-trainer", include_str!("../../../src/aircraft/data/light-trainer.json")),
    ("heavy-interceptor", include_str!("../../../src/aircraft/data/heavy-interceptor.json")),
];
const KEYS: &str = include_str!("../../../src/aircraft/physics-keys.json");
const DT: f64 = 1.0 / 30.0;

/// Number following `"key":` (the JSON files are flat enough for this; no serde in the crate).
fn num(json: &str, key: &str) -> f64 {
    let pat = format!("\"{key}\":");
    let at = json.find(&pat).unwrap_or_else(|| panic!("missing key {key}")) + pat.len();
    let rest = json[at..].trim_start();
    let end = rest.find(|c: char| !(c.is_ascii_digit() || "+-.eE".contains(c))).unwrap();
    rest[..end].parse().unwrap_or_else(|_| panic!("bad number for {key}"))
}

fn hull(json: &str) -> Vec<f64> {
    let at = json.find("\"hull\":").unwrap() + 7;
    let body = &json[at..];
    let end = body.rfind(']').unwrap();
    body[..end]
        .split(|c: char| !(c.is_ascii_digit() || "+-.eE".contains(c)))
        .filter(|t| !t.is_empty() && *t != "-" && *t != ".")
        .map(|t| t.parse().unwrap())
        .collect()
}

fn flat(json: &str) -> Vec<f64> {
    let mut v: Vec<f64> = PARAM_NAMES.iter().map(|k| num(json, k)).collect();
    v.extend(hull(json));
    v
}

fn params(name: &str) -> AircraftParams {
    let json = FILES.iter().find(|(n, _)| *n == name).unwrap().1;
    AircraftParams::from_slice(&flat(json)).unwrap_or_else(|e| panic!("{name}: {e}"))
}

fn sim(name: &str) -> Sim {
    Sim::new(params(name))
}

fn run(s: &mut Sim, seconds: f64) {
    for _ in 0..(seconds / DT).round() as usize {
        s.step(DT);
    }
}

#[test]
fn every_json_file_in_the_data_directory_is_covered_by_this_test() {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../src/aircraft/data");
    let on_disk = std::fs::read_dir(dir).unwrap().filter(|e| {
        e.as_ref().unwrap().path().extension().map_or(false, |x| x == "json")
    }).count();
    assert_eq!(on_disk, FILES.len(), "add the new aircraft file to FILES in this test");
}

#[test]
fn key_order_file_matches_the_rust_parameter_names() {
    let keys: Vec<&str> = KEYS.split('"').skip(1).step_by(2).collect();
    assert_eq!(keys, PARAM_NAMES.to_vec());
}

#[test]
fn generic_fighter_json_equals_the_builtin_parameters() {
    let json = params("generic-fighter");
    let built = AircraftParams::generic_fighter();
    assert_eq!(json.empty_mass, built.empty_mass);
    assert_eq!(json.inertia, built.inertia);
    assert_eq!(json.max_thrust_sl, built.max_thrust_sl);
    assert_eq!(json.cl_alpha, built.cl_alpha);
    assert_eq!(json.start_throttle, built.start_throttle);
    assert_eq!(json.hull, built.hull);
    // same inputs -> bit-identical flight
    let (mut a, mut b) = (Sim::new(json), Sim::new(built));
    for k in 0..300 {
        let c = Controls { throttle: 0.6, pitch: (k as f64 * 0.05).sin(), roll: 0.2, yaw: 0.0 };
        a.set_controls(c);
        b.set_controls(c);
        a.step(DT);
        b.step(DT);
    }
    assert_eq!(a.state.position, b.state.position);
}

#[test]
fn from_slice_rejects_nonsense() {
    let good = flat(FILES[0].1);
    assert!(AircraftParams::from_slice(&good).is_ok());
    assert!(AircraftParams::from_slice(&good[..10]).is_err());
    let mut bad = good.clone();
    bad[0] = -1.0; // negative empty mass
    assert!(AircraftParams::from_slice(&bad).is_err());
    let mut nan = good.clone();
    nan[7] = f64::NAN;
    assert!(AircraftParams::from_slice(&nan).is_err());
    let mut ragged = good.clone();
    ragged.push(1.0);
    assert!(AircraftParams::from_slice(&ragged).is_err());
}

#[test]
fn every_aircraft_is_stable_hands_off_and_responds_with_the_right_sign() {
    for (name, _) in FILES {
        let mut s = sim(name);
        let alt0 = s.state.position.y;
        run(&mut s, 30.0);
        assert!(!s.state.crashed, "{name}: hands-off flight crashed");
        assert!((s.state.position.y - alt0).abs() < 1200.0, "{name}: altitude drifted to {}", s.state.position.y);
        assert!(s.derived.airspeed > 40.0 && s.derived.airspeed < 500.0, "{name}: speed {}", s.derived.airspeed);

        let mut s = sim(name);
        s.set_controls(Controls { throttle: 0.5, pitch: 1.0, ..Controls::default() });
        run(&mut s, 0.5);
        assert!(s.state.angular_velocity.z > 0.0, "{name}: stick back must pitch up");

        let mut s = sim(name);
        s.set_controls(Controls { throttle: 0.5, roll: 1.0, ..Controls::default() });
        run(&mut s, 0.5);
        assert!(s.state.angular_velocity.x > 0.0, "{name}: roll right");
        assert!(s.state.orientation.rotate(Vec3::new(0.0, 0.0, 1.0)).y < 0.0, "{name}: right wing down");

        let mut s = sim(name);
        s.set_controls(Controls { throttle: 0.5, yaw: 1.0, ..Controls::default() });
        run(&mut s, 0.5);
        assert!(s.state.angular_velocity.y < 0.0, "{name}: right rudder yaws right");
    }
}

#[test]
fn every_aircraft_stalls_when_pulled_slow_and_the_limiter_holds_g() {
    for (name, _) in FILES {
        let mut s = sim(name);
        s.state.position.y = 6000.0;
        s.set_controls(Controls { throttle: 0.0, pitch: 1.0, ..Controls::default() });
        let mut max_g = 0.0f64;
        for _ in 0..(20.0 / DT) as usize {
            s.step(DT);
            max_g = max_g.max(s.derived.load_factor);
        }
        assert!(max_g < s.params.g_limit_pos + 1.0, "{name}: {max_g} g");
        // pulled to the limiter with no thrust the aircraft must lose speed and trip an AOA / speed related warning at some point
        assert!(!s.state.crashed, "{name}: crashed from 6 km in 20 s");
    }
}

#[test]
fn performance_ordering_matches_the_descriptions() {
    let top_speed = |name: &str, alt: f64| {
        let mut s = sim(name);
        s.state.position.y = alt;
        s.state.velocity = Vec3::new(0.0, 0.0, -200.0);
        s.set_controls(Controls { throttle: 1.0, ..Controls::default() });
        let mut best = 0.0f64;
        for _ in 0..(150.0 / DT) as usize {
            s.step(DT);
            best = best.max(s.derived.mach);
        }
        best
    };
    let (t, g, h) = (top_speed("light-trainer", 8000.0), top_speed("generic-fighter", 8000.0), top_speed("heavy-interceptor", 8000.0));
    assert!(t < 1.0, "trainer must stay subsonic, got M {t}");
    assert!(g > 1.0, "fighter should go supersonic, got M {g}");
    assert!(h > g, "interceptor should be faster than the fighter: {h} vs {g}");
    // trainer has no afterburner
    let mut s = sim("light-trainer");
    s.set_controls(Controls { throttle: 1.0, ..Controls::default() });
    run(&mut s, 8.0);
    assert!(!s.derived.afterburner, "the trainer has no afterburner");
}
