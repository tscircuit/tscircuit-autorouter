use super::{Bounds, Circle, Point, distance, do_segments_intersect, js_max, js_min, point_to_segment_distance};

pub fn segment_to_segment_min_distance(a: &Point, b: &Point, u: &Point, v: &Point) -> f64 {
    if a.x == b.x && a.y == b.y { return point_to_segment_distance(a, u, v); }
    if u.x == v.x && u.y == v.y { return point_to_segment_distance(u, a, b); }
    if do_segments_intersect(a, b, u, v) { return 0.0; }
    let distances = [
        point_to_segment_distance(a, u, v),
        point_to_segment_distance(b, u, v),
        point_to_segment_distance(u, a, b),
        point_to_segment_distance(v, a, b),
    ];
    distances.into_iter().fold(f64::INFINITY, js_min)
}

pub fn segment_to_bounds_min_distance(a: &Point, b: &Point, bounds: &Bounds) -> f64 {
    let top_left = Point { x: bounds.min_x, y: bounds.min_y };
    let top_right = Point { x: bounds.max_x, y: bounds.min_y };
    let bottom_left = Point { x: bounds.min_x, y: bounds.max_y };
    let bottom_right = Point { x: bounds.max_x, y: bounds.max_y };
    if do_segments_intersect(a, b, &top_left, &top_right)
        || do_segments_intersect(a, b, &top_right, &bottom_right)
        || do_segments_intersect(a, b, &bottom_right, &bottom_left)
        || do_segments_intersect(a, b, &bottom_left, &top_left) { return 0.0; }

    if a.x >= bounds.min_x && a.x <= bounds.max_x && a.y >= bounds.min_y && a.y <= bounds.max_y
        && b.x >= bounds.min_x && b.x <= bounds.max_x && b.y >= bounds.min_y && b.y <= bounds.max_y { return 0.0; }
    let mut distances = vec![
        point_to_segment_distance(&top_left, a, b),
        point_to_segment_distance(&top_right, a, b),
        point_to_segment_distance(&bottom_left, a, b),
        point_to_segment_distance(&bottom_right, a, b),
    ];
    if a.x >= bounds.min_x && a.x <= bounds.max_x && a.y >= bounds.min_y && a.y <= bounds.max_y { return 0.0; }
    if b.x >= bounds.min_x && b.x <= bounds.max_x && b.y >= bounds.min_y && b.y <= bounds.max_y { return 0.0; }
    if a.x < bounds.min_x || a.x > bounds.max_x || a.y < bounds.min_y || a.y > bounds.max_y {
        let closest_x = js_max(bounds.min_x, js_min(bounds.max_x, a.x));
        let closest_y = js_max(bounds.min_y, js_min(bounds.max_y, a.y));
        distances.push(distance(a, &Point { x: closest_x, y: closest_y }));
    }
    if b.x < bounds.min_x || b.x > bounds.max_x || b.y < bounds.min_y || b.y > bounds.max_y {
        let closest_x = js_max(bounds.min_x, js_min(bounds.max_x, b.x));
        let closest_y = js_max(bounds.min_y, js_min(bounds.max_y, b.y));
        distances.push(distance(b, &Point { x: closest_x, y: closest_y }));
    }
    distances.into_iter().fold(f64::INFINITY, js_min)
}

pub fn segment_to_box_min_distance(a: &Point, b: &Point, center: &Point, width: f64, height: f64) -> f64 {
    let half_width = width / 2.0;
    let half_height = height / 2.0;
    let bounds = Bounds {
        min_x: center.x - half_width, max_x: center.x + half_width,
        min_y: center.y - half_height, max_y: center.y + half_height,
    };
    segment_to_bounds_min_distance(a, b, &bounds)
}

pub fn segment_to_circle_min_distance(a: &Point, b: &Point, circle: &Circle) -> f64 {
    let circle_center = Point { x: circle.x, y: circle.y };
    if a.x == b.x && a.y == b.y { return js_max(0.0, distance(a, &circle_center) - circle.radius); }
    let ab = Point { x: b.x - a.x, y: b.y - a.y };
    let ac = Point { x: circle_center.x - a.x, y: circle_center.y - a.y };
    let ab_length_sq = ab.x * ab.x + ab.y * ab.y;
    let t = js_max(0.0, js_min(1.0, (ab.x * ac.x + ab.y * ac.y) / ab_length_sq));
    let closest_point = Point { x: a.x + t * ab.x, y: a.y + t * ab.y };
    let dist_to_center = distance(&closest_point, &circle_center);
    js_max(0.0, dist_to_center - circle.radius)
}

pub fn point_to_segment_closest_point(p: &Point, a: &Point, b: &Point) -> Point {
    let dx_ab = b.x - a.x;
    let dy_ab = b.y - a.y;
    let l2 = dx_ab * dx_ab + dy_ab * dy_ab;
    if l2 == 0.0 { return Point { x: a.x, y: a.y }; }
    let mut t = ((p.x - a.x) * dx_ab + (p.y - a.y) * dy_ab) / l2;
    t = js_max(0.0, js_min(1.0, t));
    Point { x: a.x + t * dx_ab, y: a.y + t * dy_ab }
}
