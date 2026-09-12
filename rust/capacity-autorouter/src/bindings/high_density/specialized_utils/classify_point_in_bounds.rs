use super::math::{Bounds, Point};
pub const BOUNDARY_COORDINATE_TOLERANCE_MM: f64 = 1e-6;

pub fn classify_point_in_bounds(point: Point, b: Bounds, epsilon: Option<f64>) -> &'static str {
    let epsilon = epsilon.unwrap_or(BOUNDARY_COORDINATE_TOLERANCE_MM);
    if ![point.x, point.y, b.min_x, b.max_x, b.min_y, b.max_y]
        .iter()
        .all(|v| v.is_finite())
    {
        return "outside";
    }
    if point.x < b.min_x - epsilon
        || point.x > b.max_x + epsilon
        || point.y < b.min_y - epsilon
        || point.y > b.max_y + epsilon
    {
        return "outside";
    }
    let vertical = (point.x - b.min_x).abs() <= epsilon || (point.x - b.max_x).abs() <= epsilon;
    let horizontal = (point.y - b.min_y).abs() <= epsilon || (point.y - b.max_y).abs() <= epsilon;
    if vertical && horizontal {
        return "on-boundary";
    }
    let within_y = point.y >= b.min_y && point.y <= b.max_y;
    let within_x = point.x >= b.min_x && point.x <= b.max_x;
    if vertical && within_y || horizontal && within_x {
        "on-boundary"
    } else {
        "inside"
    }
}
