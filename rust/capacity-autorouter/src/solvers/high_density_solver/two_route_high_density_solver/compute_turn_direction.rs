use super::calculate_side_traversal::point_to_angle;
use crate::bindings::high_density::specialized_utils::math::{Bounds, Point, SpecializedMath};

pub fn triangle_direction(a: f64, b: f64, c: f64, math: SpecializedMath) -> &'static str {
    let ax = (math.cos)(a);
    let ay = (math.sin)(a);
    let bx = (math.cos)(b);
    let by = (math.sin)(b);
    let cx = (math.cos)(c);
    let cy = (math.sin)(c);
    let area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if area < 0.0 { "ccw" } else { "cw" }
}
pub fn compute_turn_direction(
    a: Point,
    b: Point,
    c: Point,
    bounds: Bounds,
    math: SpecializedMath,
) -> Result<&'static str, String> {
    let aa = point_to_angle(a, bounds)?;
    let bb = point_to_angle(b, bounds)?;
    let cc = point_to_angle(c, bounds)?;
    Ok(triangle_direction(aa, bb, cc, math))
}
