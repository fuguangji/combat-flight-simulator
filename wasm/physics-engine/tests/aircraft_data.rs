//! The aircraft JSON files under src/aircraft/data are the source of truth for every aircraft the
//! game offers. These tests load them the same way the browser does (flat parameter array ->
//! `AircraftParams::from_slice`) and check that each one is a flyable airplane.

use physics_engine::aircraft::{AircraftParams, PARAM_NAMES};
use physics_engine::flight::{Controls, Sim};
use physics_engine::math::Vec3;

const FILES: [(&str, &str); 16] = [
    ("generic-fighter", include_str!("../../../src/aircraft/data/generic-fighter.json")),
    ("light-trainer", include_str!("../../../src/aircraft/data/light-trainer.json")),
    ("heavy-interceptor", include_str!("../../../src/aircraft/data/heavy-interceptor.json")),
    ("aether-vector", include_str!("../../../src/aircraft/data/aether-vector.json")),
    ("stratos-guardian", include_str!("../../../src/aircraft/data/stratos-guardian.json")),
    ("titan-99", include_str!("../../../src/aircraft/data/titan-99.json")),
    ("falcon-16", include_str!("../../../src/aircraft/data/falcon-16.json")),
    ("spectre-03", include_str!("../../../src/aircraft/data/spectre-03.json")),
    ("thunder-97", include_str!("../../../src/aircraft/data/thunder-97.json")),
    ("raptor-22", include_str!("../../../src/aircraft/data/raptor-22.json")),
    ("tornado-04", include_str!("../../../src/aircraft/data/tornado-04.json")),
    ("typhoon-08", include_str!("../../../src/aircraft/data/typhoon-08.json")),
    ("athena-s", include_str!("../../../src/aircraft/data/athena-s.json")),
    ("hornet-18", include_str!("../../../src/aircraft/data/hornet-18.json")),
    ("black-eagle-12", include_str!("../../../src/aircraft/data/black-eagle-12.json")),
    ("apollo-castle-37", include_str!("../../../src/aircraft/data/apollo-castle-37.json")),
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
fn first_aircraft_json_profile_is_loaded_into_the_physics_parameters() {
    let json = params("generic-fighter");
    let source = FILES[0].1;
    assert_eq!(json.empty_mass, num(source, "empty_mass"));
    assert_eq!(json.fuel_capacity, num(source, "fuel_capacity"));
    assert_eq!(json.max_thrust_sl, num(source, "max_thrust_sl"));
    assert_eq!(json.max_mach, num(source, "max_mach"));
    assert_eq!(json.g_limit_pos, num(source, "g_limit_pos"));
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
        assert!((s.state.position.y - alt0).abs() < 3000.0, "{name}: altitude drifted to {}", s.state.position.y);
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
fn every_supersonic_profile_can_cross_mach_one_at_full_throttle() {
    for (name, _) in FILES {
        let mut s = sim(name);
        if s.params.max_mach <= 1.0 {
            continue;
        }
        s.state.position.y = 10_000.0;
        s.state.velocity = Vec3::new(0.0, 0.0, -250.0);
        s.set_controls(Controls { throttle: 1.0, ..Controls::default() });
        let mut max_mach = 0.0f64;
        for _ in 0..(120.0 / DT) as usize {
            s.step(DT);
            max_mach = max_mach.max(s.derived.mach);
            if s.state.crashed {
                break;
            }
        }
        assert!(max_mach > 1.0, "{name}: full throttle only reached Mach {max_mach}");
    }
}

#[test]
fn supplied_profiles_keep_distinct_performance_caps() {
    let viper = params("generic-fighter");
    let atlantic = params("light-trainer");
    let strike = params("heavy-interceptor");
    assert!(atlantic.max_mach < viper.max_mach, "Viper should have a higher game speed cap than Atlantic");
    assert!(viper.max_mach < strike.max_mach, "Strike should have a higher game speed cap than Viper");
    assert!(strike.g_limit_pos < viper.g_limit_pos, "heavy platform should have a lower positive G cap");
    assert!(params("apollo-castle-37").empty_mass > viper.empty_mass);
}
