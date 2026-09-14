use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub type Point2 = Point;

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

impl Point {
    pub fn from_value(value: &Value) -> Self {
        Self {
            x: value["x"].as_f64().unwrap_or(f64::NAN),
            y: value["y"].as_f64().unwrap_or(f64::NAN),
        }
    }
    pub fn to_value(self) -> Value {
        json!({"x":self.x,"y":self.y})
    }
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bounds {
    pub min_x: f64,
    pub max_x: f64,
    pub min_y: f64,
    pub max_y: f64,
}

#[derive(Clone, Copy)]
pub struct SpecializedMath {
    pub sin: fn(f64) -> f64,
    pub cos: fn(f64) -> f64,
    pub atan2: fn(f64, f64) -> f64,
    pub acos: fn(f64) -> f64,
    pub hypot: fn(f64, f64) -> f64,
    pub pow: fn(f64, f64) -> f64,
    pub exp: fn(f64) -> f64,
    pub round: fn(f64) -> f64,
}
impl Default for SpecializedMath {
    fn default() -> Self {
        Self {
            sin: f64::sin,
            cos: f64::cos,
            atan2: f64::atan2,
            acos: f64::acos,
            hypot: f64::hypot,
            pow: f64::powf,
            exp: f64::exp,
            round: crate::solvers::high_density_solver::geometry::js_round,
        }
    }
}

pub fn min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a == 0.0 && b == 0.0 {
        if a.is_sign_negative() || b.is_sign_negative() {
            -0.0
        } else {
            0.0
        }
    } else {
        a.min(b)
    }
}
pub fn max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a == 0.0 && b == 0.0 {
        if a.is_sign_positive() || b.is_sign_positive() {
            0.0
        } else {
            -0.0
        }
    } else {
        a.max(b)
    }
}
pub fn clamp(value: f64, min_value: f64, max_value: f64) -> f64 {
    max(min_value, min(max_value, value))
}
pub fn distance(a: Point, b: Point) -> f64 {
    let dx = a.x - b.x;
    let dy = a.y - b.y;
    (dx * dx + dy * dy).sqrt()
}
pub fn point_to_segment_distance(p: Point, v: Point, w: Point) -> f64 {
    let l2 = (w.x - v.x) * (w.x - v.x) + (w.y - v.y) * (w.y - v.y);
    if l2 == 0.0 {
        return distance(p, v);
    }
    let mut t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = max(0.0, min(1.0, t));
    distance(
        p,
        Point {
            x: v.x + t * (w.x - v.x),
            y: v.y + t * (w.y - v.y),
        },
    )
}
fn orientation(p: Point, q: Point, r: Point) -> i32 {
    let value = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
    if value == 0.0 {
        0
    } else if value > 0.0 {
        1
    } else {
        2
    }
}
fn on_segment(p: Point, q: Point, r: Point) -> bool {
    q.x <= max(p.x, r.x) && q.x >= min(p.x, r.x) && q.y <= max(p.y, r.y) && q.y >= min(p.y, r.y)
}
pub fn do_segments_intersect(p1: Point, q1: Point, p2: Point, q2: Point) -> bool {
    let o1 = orientation(p1, q1, p2);
    let o2 = orientation(p1, q1, q2);
    let o3 = orientation(p2, q2, p1);
    let o4 = orientation(p2, q2, q1);
    if o1 != o2 && o3 != o4 {
        return true;
    }
    if o1 == 0 && on_segment(p1, p2, q1) {
        return true;
    }
    if o2 == 0 && on_segment(p1, q2, q1) {
        return true;
    }
    if o3 == 0 && on_segment(p2, p1, q2) {
        return true;
    }
    if o4 == 0 && on_segment(p2, q1, q2) {
        return true;
    }
    false
}

pub fn dist_sq(a: Point, b: Point) -> f64 {
    let dx = a.x - b.x;
    let dy = a.y - b.y;
    dx * dx + dy * dy
}

pub fn get_segment_intersection(a: Point, b: Point, u: Point, v: Point) -> Option<Point> {
    let dx1 = b.x - a.x;
    let dy1 = b.y - a.y;
    let dx2 = v.x - u.x;
    let dy2 = v.y - u.y;
    let dx3 = a.x - u.x;
    let dy3 = a.y - u.y;
    let denominator = dx1 * dy2 - dy1 * dx2;
    if denominator.abs() < 1e-10 {
        return None;
    }
    let t = (dy3 * dx2 - dx3 * dy2) / denominator;
    let s = (dx1 * dy3 - dy1 * dx3) / denominator;
    if (-1e-9..=1.0 + 1e-9).contains(&t) && (-1e-9..=1.0 + 1e-9).contains(&s) {
        Some(Point {
            x: a.x + t * dx1,
            y: a.y + t * dy1,
        })
    } else {
        None
    }
}

pub fn point_to_segment_closest_point(p: Point, a: Point, b: Point) -> Point {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let l2 = dx * dx + dy * dy;
    if l2 == 0.0 {
        return a;
    }
    let t = max(0.0, min(1.0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    Point {
        x: a.x + t * dx,
        y: a.y + t * dy,
    }
}

pub fn segment_to_segment_min_distance(a: Point, b: Point, u: Point, v: Point) -> f64 {
    if a.x == b.x && a.y == b.y {
        return point_to_segment_distance(a, u, v);
    }
    if u.x == v.x && u.y == v.y {
        return point_to_segment_distance(u, a, b);
    }
    if do_segments_intersect(a, b, u, v) {
        return 0.0;
    }
    let distances = [
        point_to_segment_distance(a, u, v),
        point_to_segment_distance(b, u, v),
        point_to_segment_distance(u, a, b),
        point_to_segment_distance(v, a, b),
    ];
    distances.into_iter().fold(f64::INFINITY, min)
}
