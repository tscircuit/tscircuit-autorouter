use crate::internal_types::{Point, Bounds2D};

pub fn is_point_inside_bounds(point: &Point, bounds: &Bounds2D) -> bool {
    point.x >= bounds.min_x && point.x <= bounds.max_x && point.y >= bounds.min_y && point.y <= bounds.max_y
}
