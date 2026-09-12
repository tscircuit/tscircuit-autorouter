use crate::types::Point2;
use crate::math_utils::{do_segments_intersect, get_segment_intersection, point_to_segment_distance};
use super::minimum_distance_between_segments::minimum_distance_between_segments;
const EPSILON: f64 = 1e-6;

fn is_point_on_segment(p: Point2, start: Point2, end: Point2) -> bool {
    point_to_segment_distance(p, start, end) <= EPSILON
}
fn are_points_close(a: Point2, b: Point2) -> bool { (a.x - b.x).abs() <= EPSILON && (a.y - b.y).abs() <= EPSILON }

pub fn is_point_in_or_on_polygon(point: Point2, polygon: &[Point2]) -> bool {
    if polygon.len() < 3 { return false; }
    for i in 0..polygon.len() {
        if is_point_on_segment(point, polygon[i], polygon[(i + 1) % polygon.len()]) { return true; }
    }
    let mut inside = false;
    let mut j = polygon.len() - 1;
    for i in 0..polygon.len() {
        let pi = polygon[i];
        let pj = polygon[j];
        let intersect = (pi.y > point.y) != (pj.y > point.y)
            && point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x;
        if intersect { inside = !inside; }
        j = i;
    }
    inside
}

pub fn does_segment_cross_polygon_boundary(start: Point2, end: Point2, polygon: &[Point2], margin: f64) -> bool {
    if polygon.len() < 3 { return false; }
    if !is_point_in_or_on_polygon(start, polygon) || !is_point_in_or_on_polygon(end, polygon) { return true; }
    for i in 0..polygon.len() {
        let edge_start = polygon[i];
        let edge_end = polygon[(i + 1) % polygon.len()];
        let start_on_edge = is_point_on_segment(start, edge_start, edge_end);
        let end_on_edge = is_point_on_segment(end, edge_start, edge_end);
        if start_on_edge && end_on_edge { continue; }
        if !do_segments_intersect(start, end, edge_start, edge_end) {
            if !start_on_edge && !end_on_edge
                && minimum_distance_between_segments(start, end, edge_start, edge_end) < margin - EPSILON { return true; }
            continue;
        }
        if let Some(intersection) = get_segment_intersection(start, end, edge_start, edge_end) {
            if (start_on_edge && are_points_close(intersection, start)) || (end_on_edge && are_points_close(intersection, end)) { continue; }
            if are_points_close(intersection, start) || are_points_close(intersection, end) { continue; }
        }
        return true;
    }
    false
}
