use crate::internal_types::{Point, Bounds2D};
use super::clamp;
use autorouting_drc::math_utils::distance;

pub fn point_to_bounds_distance(point: &Point, bounds: &Bounds2D) -> f64 {
    if point.x >= bounds.min_x && point.x <= bounds.max_x && point.y >= bounds.min_y && point.y <= bounds.max_y {
        return 0.0;
    }
    let closest_x = clamp(point.x, bounds.min_x, bounds.max_x);
    let closest_y = clamp(point.y, bounds.min_y, bounds.max_y);
    distance(point, &Point { x: closest_x, y: closest_y })
}

pub fn dist_sq(left: &Point, right: &Point) -> f64 {
    let dx = left.x - right.x;
    let dy = left.y - right.y;
    dx * dx + dy * dy
}
