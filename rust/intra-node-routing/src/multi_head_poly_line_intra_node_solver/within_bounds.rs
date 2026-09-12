use super::types2::MHPoint2;
use crate::specialized_utils::get_bounds_from_node_with_port_points::Bounds;

pub fn within_bounds(point: &MHPoint2, bounds: &Bounds, padding: f64) -> bool {
    point.x >= bounds.min_x + padding
        && point.x <= bounds.max_x - padding
        && point.y >= bounds.min_y + padding
        && point.y <= bounds.max_y - padding
}
