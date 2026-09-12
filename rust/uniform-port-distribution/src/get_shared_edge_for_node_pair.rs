use indexmap::IndexMap;
use crate::get_owner_pair_key::{get_owner_pair_key, normalize_owner_pair};
use crate::types::{Bounds, Name, EdgeOrientation, Point, SharedEdge, Side};

const EPSILON: f64 = 1e-6;

pub fn get_shared_edge_for_node_pair(node_a_id: &Name, node_b_id: &Name, node_bounds: &IndexMap<Name, Bounds>) -> Option<SharedEdge> {
    if node_a_id == node_b_id { return None; }
    let bounds_a = node_bounds.get(node_a_id)?;
    let bounds_b = node_bounds.get(node_b_id)?;
    let owner_node_ids = normalize_owner_pair(node_a_id, node_b_id);
    let owner_pair_key = get_owner_pair_key(&owner_node_ids);
    let vertical_touch = (bounds_a.max_x - bounds_b.min_x).abs() <= EPSILON ||
        (bounds_b.max_x - bounds_a.min_x).abs() <= EPSILON;
    if vertical_touch {
        let y1 = js_max(bounds_a.min_y, bounds_b.min_y);
        let y2 = js_min(bounds_a.max_y, bounds_b.max_y);
        let length = y2 - y1;
        if length > EPSILON {
            let a_on_left = (bounds_a.max_x - bounds_b.min_x).abs() <= EPSILON;
            let x = if a_on_left { bounds_a.max_x } else { bounds_a.min_x };
            let mut node_side_by_owner_id = IndexMap::new();
            node_side_by_owner_id.insert(node_a_id.to_owned(), if a_on_left { Side::Right } else { Side::Left });
            node_side_by_owner_id.insert(node_b_id.to_owned(), if a_on_left { Side::Left } else { Side::Right });
            return Some(SharedEdge { owner_node_ids, owner_pair_key, orientation: EdgeOrientation::Vertical,
                x1: x, y1, x2: x, y2, center: Point { x, y: (y1 + y2) / 2.0 }, length, node_side_by_owner_id });
        }
    }
    let horizontal_touch = (bounds_a.max_y - bounds_b.min_y).abs() <= EPSILON ||
        (bounds_b.max_y - bounds_a.min_y).abs() <= EPSILON;
    if horizontal_touch {
        let x1 = js_max(bounds_a.min_x, bounds_b.min_x);
        let x2 = js_min(bounds_a.max_x, bounds_b.max_x);
        let length = x2 - x1;
        if length > EPSILON {
            let a_below = (bounds_a.max_y - bounds_b.min_y).abs() <= EPSILON;
            let y = if a_below { bounds_a.max_y } else { bounds_a.min_y };
            let mut node_side_by_owner_id = IndexMap::new();
            node_side_by_owner_id.insert(node_a_id.to_owned(), if a_below { Side::Top } else { Side::Bottom });
            node_side_by_owner_id.insert(node_b_id.to_owned(), if a_below { Side::Bottom } else { Side::Top });
            return Some(SharedEdge { owner_node_ids, owner_pair_key, orientation: EdgeOrientation::Horizontal,
                x1, y1: y, x2, y2: y, center: Point { x: (x1 + x2) / 2.0, y }, length, node_side_by_owner_id });
        }
    }
    None
}

fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() { return f64::NAN; }
    if a == 0.0 && b == 0.0 {
        return if a.is_sign_negative() || b.is_sign_negative() { -0.0 } else { 0.0 };
    }
    if a < b { a } else { b }
}

fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() { return f64::NAN; }
    if a == 0.0 && b == 0.0 {
        return if a.is_sign_positive() || b.is_sign_positive() { 0.0 } else { -0.0 };
    }
    if a > b { a } else { b }
}
