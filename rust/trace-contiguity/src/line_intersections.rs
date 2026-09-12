use crate::types::Point;

pub fn min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() { f64::NAN }
    else if a == 0.0 && b == 0.0 { if a.is_sign_negative() || b.is_sign_negative() { -0.0 } else { 0.0 } }
    else if a < b { a } else { b }
}

pub fn max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() { f64::NAN }
    else if a == 0.0 && b == 0.0 { if a.is_sign_positive() || b.is_sign_positive() { 0.0 } else { -0.0 } }
    else if a > b { a } else { b }
}

pub fn does_line_intersect_line(a: [Point; 2], b: [Point; 2], line_thickness: f64) -> bool {
    if line_thickness == 0.0 {
        return do_segments_intersect(a[0], a[1], b[0], b[1]);
    }
    let min_dist = segments_distance(a[0], a[1], b[0], b[1]);
    min_dist <= line_thickness
}

pub fn do_segments_intersect(p1: Point, q1: Point, p2: Point, q2: Point) -> bool {
    let o1 = orientation(p1, q1, p2);
    let o2 = orientation(p1, q1, q2);
    let o3 = orientation(p2, q2, p1);
    let o4 = orientation(p2, q2, q1);
    if o1 != o2 && o3 != o4 { return true; }
    if o1 == 0 && on_segment(p1, p2, q1) { return true; }
    if o2 == 0 && on_segment(p1, q2, q1) { return true; }
    if o3 == 0 && on_segment(p2, p1, q2) { return true; }
    if o4 == 0 && on_segment(p2, q1, q2) { return true; }
    false
}

pub fn orientation(p: Point, q: Point, r: Point) -> u8 {
    let val = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
    if val == 0.0 { return 0; }
    if val > 0.0 { 1 } else { 2 }
}

pub fn on_segment(p: Point, q: Point, r: Point) -> bool {
    q.x <= max(p.x, r.x) && q.x >= min(p.x, r.x)
        && q.y <= max(p.y, r.y) && q.y >= min(p.y, r.y)
}

fn segments_distance(a1: Point, a2: Point, b1: Point, b2: Point) -> f64 {
    if a1.x == a2.x && a1.y == a2.y { return point_to_segment_distance(a1, b1, b2); }
    if b1.x == b2.x && b1.y == b2.y { return point_to_segment_distance(b1, a1, a2); }
    if do_segments_intersect(a1, a2, b1, b2) { return 0.0; }
    let distances = [point_to_segment_distance(a1, b1, b2), point_to_segment_distance(a2, b1, b2),
        point_to_segment_distance(b1, a1, a2), point_to_segment_distance(b2, a1, a2)];
    distances.into_iter().fold(f64::INFINITY, min)
}

pub fn point_to_segment_distance(p: Point, v: Point, w: Point) -> f64 {
    let l2 = (w.x - v.x) * (w.x - v.x) + (w.y - v.y) * (w.y - v.y);
    if l2 == 0.0 { return distance(p, v); }
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    let t = max(0.0, min(1.0, t));
    let projection = Point { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) };
    distance(p, projection)
}

pub fn distance(p1: Point, p2: Point) -> f64 {
    let dx = p1.x - p2.x;
    let dy = p1.y - p2.y;
    (dx * dx + dy * dy).sqrt()
}

pub fn get_segment_intersection(a: Point, b: Point, u: Point, v: Point) -> Option<Point> {
    let dx1 = b.x - a.x;
    let dy1 = b.y - a.y;
    let dx2 = v.x - u.x;
    let dy2 = v.y - u.y;
    let dx3 = a.x - u.x;
    let dy3 = a.y - u.y;
    let denominator = dx1 * dy2 - dy1 * dx2;
    if denominator.abs() < 1e-10 { return None; }
    let t = (dy3 * dx2 - dx3 * dy2) / denominator;
    let s = (dx1 * dy3 - dy1 * dx3) / denominator;
    let epsilon = 1e-9;
    if t >= -epsilon && t <= 1.0 + epsilon && s >= -epsilon && s <= 1.0 + epsilon {
        return Some(Point { x: a.x + t * dx1, y: a.y + t * dy1 });
    }
    None
}

pub fn does_segment_intersect_rect(a: Point, b: Point, min_x: f64, min_y: f64, max_x: f64, max_y: f64) -> bool {
    let point_inside = |p: Point| p.x >= min_x && p.x <= max_x && p.y >= min_y && p.y <= max_y;
    if point_inside(a) || point_inside(b) { return true; }
    let top_left = Point{x:min_x,y:min_y};
    let top_right = Point{x:max_x,y:min_y};
    let bottom_left = Point{x:min_x,y:max_y};
    let bottom_right = Point{x:max_x,y:max_y};
    do_segments_intersect(a,b,top_left,top_right)
        || do_segments_intersect(a,b,top_right,bottom_right)
        || do_segments_intersect(a,b,bottom_right,bottom_left)
        || do_segments_intersect(a,b,bottom_left,top_left)
}
