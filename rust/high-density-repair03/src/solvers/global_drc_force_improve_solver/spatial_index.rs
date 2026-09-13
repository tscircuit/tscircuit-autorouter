use crate::solvers::global_drc_force_improve_solver::internal_types::{Bounds2D, Point};
use math_utils::{js_max, js_min};
use rustc_hash::FxBuildHasher;
use std::collections::HashMap;

pub struct SpatialIndex {
    cells: HashMap<(u64, u64), Vec<usize>, FxBuildHasher>,
    candidate_indexes: Vec<usize>,
    seen_indexes: Vec<bool>,
}

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

pub fn create_spatial_index<T>(
    items: &[T],
    get_bounds: impl Fn(&T) -> Bounds2D,
    cell_size: f64,
) -> SpatialIndex {
    let mut index = SpatialIndex {
        cells: HashMap::default(),
        candidate_indexes: Vec::new(),
        seen_indexes: vec![false; items.len()],
    };
    for (item_index, item) in items.iter().enumerate() {
        let cell_range = get_spatial_cell_range(&get_bounds(item), cell_size);
        let mut cell_x = cell_range.min_cell_x;
        while cell_x <= cell_range.max_cell_x {
            let mut cell_y = cell_range.min_cell_y;
            while cell_y <= cell_range.max_cell_y {
                let key = get_spatial_cell_key(cell_x, cell_y);
                if let Some(existing_indexes) = index.cells.get_mut(&key) {
                    existing_indexes.push(item_index);
                } else {
                    index.cells.insert(key, vec![item_index]);
                }
                cell_y += 1.0;
            }
            cell_x += 1.0;
        }
    }
    index
}

pub fn get_spatial_candidate_indexes<'a>(
    spatial_index: &'a mut SpatialIndex,
    bounds: &Bounds2D,
    cell_size: f64,
) -> &'a [usize] {
    for &index in &spatial_index.candidate_indexes {
        spatial_index.seen_indexes[index] = false;
    }
    spatial_index.candidate_indexes.clear();
    let cell_range = get_spatial_cell_range(bounds, cell_size);
    let mut cell_x = cell_range.min_cell_x;
    while cell_x <= cell_range.max_cell_x {
        let mut cell_y = cell_range.min_cell_y;
        while cell_y <= cell_range.max_cell_y {
            if let Some(cell_indexes) = spatial_index.cells.get(&get_spatial_cell_key(cell_x, cell_y))
            {
                for &index in cell_indexes {
                    if !spatial_index.seen_indexes[index] {
                        spatial_index.seen_indexes[index] = true;
                        spatial_index.candidate_indexes.push(index);
                    }
                }
            }
            cell_y += 1.0;
        }
        cell_x += 1.0;
    }
    spatial_index.candidate_indexes.sort_unstable();
    &spatial_index.candidate_indexes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidate_queries_reuse_buffers_without_retaining_previous_results() {
        let bounds = Bounds2D {
            min_x: -0.0,
            min_y: -0.0,
            max_x: 2.0,
            max_y: 2.0,
        };
        let distant = Bounds2D {
            min_x: 10.0,
            min_y: 10.0,
            max_x: 11.0,
            max_y: 11.0,
        };
        let mut index = create_spatial_index(&[bounds, distant, bounds], |item| *item, 1.0);
        assert_eq!(
            get_spatial_candidate_indexes(&mut index, &bounds, 1.0),
            [0, 2]
        );
        assert_eq!(
            get_spatial_candidate_indexes(&mut index, &distant, 1.0),
            [1]
        );
        let empty = Bounds2D {
            min_x: 20.0,
            max_x: 21.0,
            ..distant
        };
        assert!(get_spatial_candidate_indexes(&mut index, &empty, 1.0).is_empty());
        assert_eq!(
            get_spatial_candidate_indexes(&mut index, &bounds, 1.0),
            [0, 2]
        );
    }
}
