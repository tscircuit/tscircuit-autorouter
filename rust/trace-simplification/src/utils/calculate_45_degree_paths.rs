use crate::types::Point2;
use crate::math_utils::{min};

pub fn calculate_45_degree_paths(a: Point2, b: Point2) -> Vec<Vec<Point2>> {
    let mut result = Vec::new();
    let dx = (b.x - a.x).abs();
    let dy = (b.y - a.y).abs();
    let sign_x = if b.x > a.x { 1.0 } else { -1.0 };
    let sign_y = if b.y > a.y { 1.0 } else { -1.0 };
    let mid1 = Point2 { x: b.x - sign_x * (b.y - a.y).abs(), y: a.y };
    if (mid1.x - a.x) * sign_x >= 0.0 && (mid1.x - b.x) * sign_x <= 0.0 {
        result.push(vec![a, mid1, b]);
    }
    let mid2 = Point2 { x: a.x, y: b.y - sign_y * (b.x - a.x).abs() };
    if (mid2.y - a.y) * sign_y >= 0.0 && (mid2.y - b.y) * sign_y <= 0.0 {
        result.push(vec![a, mid2, b]);
    }
    let min_dist = min(dx, dy);
    let mid3 = Point2 { x: a.x + sign_x * min_dist, y: a.y + sign_y * min_dist };
    if (mid3.x - a.x) * sign_x >= 0.0 && (mid3.x - b.x) * sign_x <= 0.0
        && (mid3.y - a.y) * sign_y >= 0.0 && (mid3.y - b.y) * sign_y <= 0.0 {
        result.push(vec![a, mid3, b]);
    }
    result
}
