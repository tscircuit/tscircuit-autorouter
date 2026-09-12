use crate::bindings::trace_simplification::types::Point2;
use crate::bindings::trace_simplification::math_utils::{do_segments_intersect, min};

pub fn minimum_distance_between_segments(a1: Point2, a2: Point2, b1: Point2, b2: Point2) -> f64 {
    if do_segments_intersect(a1, a2, b1, b2) { return 0.0; }
    let da1 = point_to_segment_distance(a1, b1, b2);
    let da2 = point_to_segment_distance(a2, b1, b2);
    let db1 = point_to_segment_distance(b1, a1, a2);
    let db2 = point_to_segment_distance(b2, a1, a2);
    min(min(min(da1, da2), db1), db2)
}

fn point_to_segment_distance(p: Point2, q1: Point2, q2: Point2) -> f64 {
    let v = Point2 { x: q2.x - q1.x, y: q2.y - q1.y };
    let w = Point2 { x: p.x - q1.x, y: p.y - q1.y };
    let c1 = dot_product(w, v);
    if c1 <= 0.0 { return distance(p, q1); }
    let c2 = dot_product(v, v);
    if c2 <= c1 { return distance(p, q2); }
    let b = c1 / c2;
    let pb = Point2 { x: q1.x + b * v.x, y: q1.y + b * v.y };
    distance(p, pb)
}

fn dot_product(a: Point2, b: Point2) -> f64 { a.x * b.x + a.y * b.y }

fn distance(a: Point2, b: Point2) -> f64 {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    (dx * dx + dy * dy).sqrt()
}
