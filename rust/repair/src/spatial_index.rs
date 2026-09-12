use std::collections::{HashMap, HashSet};
use autorouting_drc::math_utils::{js_max, js_min};
use rustc_hash::FxBuildHasher;
use crate::internal_types::{Bounds2D, Point};

pub type SpatialIndex = HashMap<(u64, u64), Vec<usize>, FxBuildHasher>;

struct SpatialCellRange {
    min_cell_x: f64,
    max_cell_x: f64,
    min_cell_y: f64,
    max_cell_y: f64,
}

pub fn clamp_value(value: f64, min_value: f64, max_value: f64) -> f64 {
    js_max(min_value, js_min(value, max_value))
}

pub fn clamp_to_bounds(point: &mut Point, bounds: &Bounds2D) {
    point.x = clamp_value(point.x, bounds.min_x, bounds.max_x);
    point.y = clamp_value(point.y, bounds.min_y, bounds.max_y);
}

pub fn expand_bounds_2d(bounds: &Bounds2D, margin: f64) -> Bounds2D {
    Bounds2D {
        min_x: bounds.min_x - margin,
        min_y: bounds.min_y - margin,
        max_x: bounds.max_x + margin,
        max_y: bounds.max_y + margin,
    }
}

fn get_spatial_cell_range(bounds: &Bounds2D, cell_size: f64) -> SpatialCellRange {
    SpatialCellRange {
        min_cell_x: (bounds.min_x / cell_size).floor(),
        max_cell_x: (bounds.max_x / cell_size).floor(),
        min_cell_y: (bounds.min_y / cell_size).floor(),
        max_cell_y: (bounds.max_y / cell_size).floor(),
    }
}

fn get_spatial_cell_key(cell_x: f64, cell_y: f64) -> (u64, u64) {
    // Cell coordinates are integral f64s. Their bits preserve equality without
    // a narrowing cast; JS string keys treat both signs of zero as "0".
    let x = if cell_x == 0.0 { 0 } else { cell_x.to_bits() };
    let y = if cell_y == 0.0 { 0 } else { cell_y.to_bits() };
    (x, y)
}

pub fn create_spatial_index<T>(items: &[T], get_bounds: impl Fn(&T) -> Bounds2D, cell_size: f64) -> SpatialIndex {
    let mut index = SpatialIndex::default();
    for (item_index, item) in items.iter().enumerate() {
        let cell_range = get_spatial_cell_range(&get_bounds(item), cell_size);
        let mut cell_x = cell_range.min_cell_x;
        while cell_x <= cell_range.max_cell_x {
            let mut cell_y = cell_range.min_cell_y;
            while cell_y <= cell_range.max_cell_y {
                let key = get_spatial_cell_key(cell_x, cell_y);
                if let Some(existing_indexes) = index.get_mut(&key) {
                    existing_indexes.push(item_index);
                } else {
                    index.insert(key, vec![item_index]);
                }
                cell_y += 1.0;
            }
            cell_x += 1.0;
        }
    }
    index
}

pub fn get_spatial_candidate_indexes(spatial_index: &SpatialIndex, bounds: &Bounds2D, cell_size: f64) -> Vec<usize> {
    let mut candidate_indexes = HashSet::<usize, FxBuildHasher>::default();
    let cell_range = get_spatial_cell_range(bounds, cell_size);
    let mut cell_x = cell_range.min_cell_x;
    while cell_x <= cell_range.max_cell_x {
        let mut cell_y = cell_range.min_cell_y;
        while cell_y <= cell_range.max_cell_y {
            if let Some(cell_indexes) = spatial_index.get(&get_spatial_cell_key(cell_x, cell_y)) {
                for &index in cell_indexes { candidate_indexes.insert(index); }
            }
            cell_y += 1.0;
        }
        cell_x += 1.0;
    }
    let mut candidates: Vec<usize> = candidate_indexes.into_iter().collect();
    candidates.sort_unstable();
    candidates
}
