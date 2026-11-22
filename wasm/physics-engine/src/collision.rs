//! Static obstacle world for collision queries.
//!
//! The renderer draws "buildings" as axis-aligned boxes standing on the y = 0 ground plane
//! (centre x, centre z, square footprint `w`, height `h`). The very same instance array is
//! uploaded to this module (see `sim_scene_alloc` / `sim_scene_commit` in lib.rs), so what you
//! see is exactly what you can hit.
//!
//! Broad phase: uniform XZ grid; a building is registered in every cell its footprint overlaps.
//! Narrow phase: segment vs. inflated AABB (slab method), which cannot tunnel through a wall no
//! matter how fast the aircraft moves within one sub-step.

use crate::math::Vec3;

pub const CELL: f64 = 1_000.0;
/// Upper bound on grid resolution per axis (keeps memory bounded for absurd scenes).
const MAX_CELLS_PER_AXIS: f64 = 512.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Building {
    pub min_x: f64,
    pub max_x: f64,
    pub min_z: f64,
    pub max_z: f64,
    pub height: f64,
}

#[derive(Clone, Debug, Default)]
pub struct World {
    buildings: Vec<Building>,
    origin_x: f64,
    origin_z: f64,
    cell: f64,
    nx: usize,
    nz: usize,
    cells: Vec<Vec<u32>>,
}

/// Segment `a + t*d`, t in [0, 1], against the box inflated by `m` on every side.
/// Returns the entry parameter (0 if the segment starts inside).
fn slab(a: Vec3, d: Vec3, b: &Building, m: f64) -> Option<f64> {
    let lo = [b.min_x - m, -1.0e9, b.min_z - m];
    let hi = [b.max_x + m, b.height + m, b.max_z + m];
    let o = [a.x, a.y, a.z];
    let dd = [d.x, d.y, d.z];
    let mut t0 = 0.0_f64;
    let mut t1 = 1.0_f64;
    for k in 0..3 {
        if dd[k].abs() < 1e-12 {
            if o[k] < lo[k] || o[k] > hi[k] {
                return None;
            }
        } else {
            let inv = 1.0 / dd[k];
            let mut ta = (lo[k] - o[k]) * inv;
            let mut tb = (hi[k] - o[k]) * inv;
            if ta > tb {
                std::mem::swap(&mut ta, &mut tb);
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

impl World {
    pub fn empty() -> World {
        World::default()
    }

    pub fn building_count(&self) -> usize {
        self.buildings.len()
    }

    /// `inst` holds groups of four values: centre x, centre z, footprint width (square), height.
    pub fn from_instances(inst: &[f32]) -> World {
        let mut list = Vec::with_capacity(inst.len() / 4);
        for c in inst.chunks_exact(4) {
            let (x, z, w, h) = (c[0] as f64, c[1] as f64, c[2] as f64, c[3] as f64);
            if !(x.is_finite() && z.is_finite() && w.is_finite() && h.is_finite()) || w <= 0.0 || h <= 0.0 {
                continue;
            }
            let hw = w * 0.5;
            list.push(Building { min_x: x - hw, max_x: x + hw, min_z: z - hw, max_z: z + hw, height: h });
        }
        World::from_buildings(list)
    }

    pub fn from_buildings(buildings: Vec<Building>) -> World {
        if buildings.is_empty() {
            return World::default();
        }
        let (mut min_x, mut max_x, mut min_z, mut max_z) = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
        for b in &buildings {
            min_x = min_x.min(b.min_x);
            max_x = max_x.max(b.max_x);
            min_z = min_z.min(b.min_z);
            max_z = max_z.max(b.max_z);
        }
        let cell = CELL
            .max((max_x - min_x) / MAX_CELLS_PER_AXIS)
            .max((max_z - min_z) / MAX_CELLS_PER_AXIS);
        let nx = ((max_x - min_x) / cell).floor() as usize + 1;
        let nz = ((max_z - min_z) / cell).floor() as usize + 1;
        let mut world = World {
            buildings,
            origin_x: min_x,
            origin_z: min_z,
            cell,
            nx,
            nz,
            cells: vec![Vec::new(); nx * nz],
        };
        for i in 0..world.buildings.len() {
            let b = world.buildings[i];
            let (x0, x1) = (world.index(b.min_x, world.origin_x, nx), world.index(b.max_x, world.origin_x, nx));
            let (z0, z1) = (world.index(b.min_z, world.origin_z, nz), world.index(b.max_z, world.origin_z, nz));
            for iz in z0..=z1 {
                for ix in x0..=x1 {
                    world.cells[iz * nx + ix].push(i as u32);
                }
            }
        }
        world
    }

    fn index(&self, v: f64, origin: f64, n: usize) -> usize {
        (((v - origin) / self.cell).floor().max(0.0) as usize).min(n - 1)
    }

    /// Earliest contact of the segment a -> b (parameter t in [0, 1]) with any building whose
    /// box has been inflated by `margin` metres. `None` if the path is clear.
    pub fn segment_hit(&self, a: Vec3, b: Vec3, margin: f64) -> Option<f64> {
        if self.buildings.is_empty() {
            return None;
        }
        let lo_x = a.x.min(b.x) - margin;
        let hi_x = a.x.max(b.x) + margin;
        let lo_z = a.z.min(b.z) - margin;
        let hi_z = a.z.max(b.z) + margin;
        let end_x = self.origin_x + self.nx as f64 * self.cell;
        let end_z = self.origin_z + self.nz as f64 * self.cell;
        if hi_x < self.origin_x || lo_x > end_x || hi_z < self.origin_z || lo_z > end_z {
            return None;
        }
        let (ix0, ix1) = (self.index(lo_x, self.origin_x, self.nx), self.index(hi_x, self.origin_x, self.nx));
        let (iz0, iz1) = (self.index(lo_z, self.origin_z, self.nz), self.index(hi_z, self.origin_z, self.nz));
        let d = b - a;
        let mut best: Option<f64> = None;
        for iz in iz0..=iz1 {
            for ix in ix0..=ix1 {
                for &bi in &self.cells[iz * self.nx + ix] {
                    if let Some(t) = slab(a, d, &self.buildings[bi as usize], margin) {
                        if best.map_or(true, |cur| t < cur) {
                            best = Some(t);
                        }
                    }
                }
            }
        }
        best
    }

    pub fn point_inside(&self, p: Vec3, margin: f64) -> bool {
        self.segment_hit(p, p, margin).is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn one_tower() -> World {
        // 100 x 100 footprint centred on (0, 0), 200 m tall.
        World::from_instances(&[0.0, 0.0, 100.0, 200.0])
    }

    #[test]
    fn empty_world_never_hits() {
        let w = World::empty();
        assert!(w.segment_hit(Vec3::new(0.0, 10.0, 0.0), Vec3::new(5.0, 10.0, 5.0), 1.0).is_none());
    }

    #[test]
    fn segment_through_a_wall_hits_at_the_face() {
        let w = one_tower();
        let t = w
            .segment_hit(Vec3::new(-200.0, 50.0, 0.0), Vec3::new(200.0, 50.0, 0.0), 0.0)
            .expect("must hit");
        assert!((t - 0.375).abs() < 1e-9, "face at x = -50 -> t = 150/400");
    }

    #[test]
    fn segment_over_the_roof_misses_but_margin_can_catch_it() {
        let w = one_tower();
        let a = Vec3::new(-200.0, 203.0, 0.0);
        let b = Vec3::new(200.0, 203.0, 0.0);
        assert!(w.segment_hit(a, b, 1.0).is_none());
        assert!(w.segment_hit(a, b, 5.0).is_some());
    }

    #[test]
    fn segment_beside_the_tower_misses() {
        let w = one_tower();
        assert!(w.segment_hit(Vec3::new(-200.0, 50.0, 80.0), Vec3::new(200.0, 50.0, 80.0), 1.0).is_none());
    }

    #[test]
    fn point_inside_detects_containment() {
        let w = one_tower();
        assert!(w.point_inside(Vec3::new(10.0, 100.0, -10.0), 0.0));
        assert!(!w.point_inside(Vec3::new(10.0, 250.0, -10.0), 0.0));
    }

    #[test]
    fn large_building_spanning_many_cells_is_found_from_any_of_them() {
        // 3 km wide massif: registered in several grid cells.
        let w = World::from_instances(&[0.0, 0.0, 3000.0, 500.0, 20_000.0, 20_000.0, 50.0, 50.0]);
        for x in [-1400.0, 0.0, 1400.0] {
            assert!(w.point_inside(Vec3::new(x, 100.0, 0.0), 0.0), "x = {x}");
        }
        assert!(!w.point_inside(Vec3::new(-1600.0, 100.0, 0.0), 0.0));
    }

    #[test]
    fn invalid_instances_are_skipped() {
        let w = World::from_instances(&[f32::NAN, 0.0, 10.0, 10.0, 0.0, 0.0, -5.0, 10.0, 0.0, 0.0, 10.0, 10.0]);
        assert_eq!(w.building_count(), 1);
    }

    #[test]
    fn fast_movers_cannot_tunnel() {
        let w = one_tower();
        // a 2 km segment (way more than any real sub-step) still registers the wall
        assert!(w.segment_hit(Vec3::new(-1000.0, 10.0, 0.0), Vec3::new(1000.0, 10.0, 0.0), 0.5).is_some());
    }
}
