use crate::types::high_density_types::Point;

pub fn orientation(p: &Point, q: &Point, r: &Point) -> u8 {
    let value = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
    if value == 0.0 {
        return 0;
    }
    if value > 0.0 { 1 } else { 2 }
}

pub fn on_segment(p: &Point, q: &Point, r: &Point) -> bool {
    q.x <= p.x.max(r.x)
        && q.x >= p.x.min(r.x)
        && q.y <= p.y.max(r.y)
        && q.y >= p.y.min(r.y)
}

pub fn do_segments_intersect(p1: &Point, q1: &Point, p2: &Point, q2: &Point) -> bool {
    let o1 = orientation(p1, q1, p2);
    let o2 = orientation(p1, q1, q2);
    let o3 = orientation(p2, q2, p1);
    let o4 = orientation(p2, q2, q1);
    if o1 != o2 && o3 != o4 {
        return true;
    }
    if o1 == 0 && on_segment(p1, p2, q1) { return true; }
    if o2 == 0 && on_segment(p1, q2, q1) { return true; }
    if o3 == 0 && on_segment(p2, p1, q2) { return true; }
    if o4 == 0 && on_segment(p2, q1, q2) { return true; }
    false
}

pub fn distance(p1: &Point, p2: &Point) -> f64 {
    let dx = p1.x - p2.x;
    let dy = p1.y - p2.y;
    (dx * dx + dy * dy).sqrt()
}

pub fn point_to_segment_distance(p: &Point, v: &Point, w: &Point) -> f64 {
    let l2 = (w.x - v.x).powi(2) + (w.y - v.y).powi(2);
    if l2 == 0.0 {
        return distance(p, v);
    }
    let mut t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = t.min(1.0).max(0.0);
    let projection = Point {
        x: v.x + t * (w.x - v.x),
        y: v.y + t * (w.y - v.y),
        z: 0.0,
    };
    distance(p, &projection)
}

pub fn js_round(value: f64) -> f64 {
    let floor = value.floor();
    let rounded = if value - floor < 0.5 { floor } else { floor + 1.0 };
    if rounded == 0.0 && value.is_sign_negative() {
        -0.0
    } else {
        rounded
    }
}
