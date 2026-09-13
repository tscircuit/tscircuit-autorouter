use super::math::{Bounds, Point, max};

pub fn find_closest_point_to_abc_within_bounds(
    a: Point,
    b: Point,
    c: Point,
    radius: f64,
    bounds: Bounds,
) -> Point {
    let avg = Point {
        x: (a.x + b.x + c.x) / 3.0,
        y: (a.y + b.y + c.y) / 3.0,
    };
    let distance = |p1: Point, p2: Point| {
        let dx = p2.x - p1.x;
        let dy = p2.y - p1.y;
        (dx * dx + dy * dy).sqrt()
    };
    let valid = |p: Point| {
        distance(p, a) >= radius
            && distance(p, b) >= radius
            && distance(p, c) >= radius
            && p.x >= bounds.min_x
            && p.x <= bounds.max_x
            && p.y >= bounds.min_y
            && p.y <= bounds.max_y
    };
    let boundary = |p: Point| {
        (p.x - bounds.min_x).abs() < 1e-6
            || (p.x - bounds.max_x).abs() < 1e-6
            || (p.y - bounds.min_y).abs() < 1e-6
            || (p.y - bounds.max_y).abs() < 1e-6
    };
    if valid(avg) {
        return avg;
    }
    let circle_point = |center: Point, constraint: Point, r: f64| {
        let vx = center.x - constraint.x;
        let vy = center.y - constraint.y;
        let dist = (vx * vx + vy * vy).sqrt();
        if dist < 1e-10 {
            Point {
                x: constraint.x + r,
                y: constraint.y,
            }
        } else {
            Point {
                x: constraint.x + (vx / dist) * r,
                y: constraint.y + (vy / dist) * r,
            }
        }
    };
    let intersections = |c1: Point, c2: Point, r: f64| -> Vec<Point> {
        let dx = c2.x - c1.x;
        let dy = c2.y - c1.y;
        let dist = (dx * dx + dy * dy).sqrt();
        if dist > 2.0 * r - 1e-10 || dist < 1e-10 {
            return vec![];
        }
        let aa = (dist * dist) / (2.0 * dist);
        let h = max(0.0, r * r - aa * aa).sqrt();
        let mx = c1.x + (dx * aa) / dist;
        let my = c1.y + (dy * aa) / dist;
        let i1 = Point {
            x: mx + (h * dy) / dist,
            y: my - (h * dx) / dist,
        };
        let i2 = Point {
            x: mx - (h * dy) / dist,
            y: my + (h * dx) / dist,
        };
        let mut out = vec![];
        if (distance(i1, c1) - r).abs() < 1e-6 && (distance(i1, c2) - r).abs() < 1e-6 {
            out.push(i1);
        }
        if (distance(i2, c1) - r).abs() < 1e-6 && (distance(i2, c2) - r).abs() < 1e-6 {
            out.push(i2);
        }
        out
    };
    let mut candidates = vec![
        circle_point(avg, a, radius),
        circle_point(avg, b, radius),
        circle_point(avg, c, radius),
    ];
    candidates.extend(intersections(a, b, radius));
    candidates.extend(intersections(b, c, radius));
    candidates.extend(intersections(c, a, radius));
    let valid_candidates: Vec<Point> = candidates.iter().copied().filter(|p| valid(*p)).collect();
    if !valid_candidates.is_empty() {
        let mut interior: Vec<Point> = valid_candidates
            .into_iter()
            .filter(|p| !boundary(*p))
            .collect();
        if !interior.is_empty() {
            interior.sort_by(|a, b| {
                (distance(*a, avg) - distance(*b, avg))
                    .partial_cmp(&0.0)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            return interior[0];
        }
    }
    let mut best = None;
    let mut best_distance = f64::INFINITY;
    let mut x = bounds.min_x + 1.0;
    while x < bounds.max_x {
        let mut y = bounds.min_y + 1.0;
        while y < bounds.max_y {
            let p = Point { x, y };
            if valid(p) {
                let dist = distance(p, avg);
                if dist < best_distance {
                    best_distance = dist;
                    best = Some(p);
                }
            }
            y += 5.0;
        }
        x += 5.0;
    }
    if let Some(best) = best {
        return best;
    }
    let mut boundary_points = Vec::new();
    for i in 0..=100 {
        let t = i as f64 / 100.0;
        boundary_points.push(Point {
            x: bounds.min_x + t * (bounds.max_x - bounds.min_x),
            y: bounds.min_y,
        });
        boundary_points.push(Point {
            x: bounds.max_x,
            y: bounds.min_y + t * (bounds.max_y - bounds.min_y),
        });
        boundary_points.push(Point {
            x: bounds.max_x - t * (bounds.max_x - bounds.min_x),
            y: bounds.max_y,
        });
        boundary_points.push(Point {
            x: bounds.min_x,
            y: bounds.max_y - t * (bounds.max_y - bounds.min_y),
        });
    }
    let mut valid_boundary: Vec<Point> = boundary_points
        .iter()
        .copied()
        .filter(|p| valid(*p))
        .collect();
    if !valid_boundary.is_empty() {
        valid_boundary.sort_by(|a, b| {
            (distance(*a, avg) - distance(*b, avg))
                .partial_cmp(&0.0)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        return valid_boundary[0];
    }
    let mut min_violation = f64::INFINITY;
    let mut least_bad = Point {
        x: bounds.min_x,
        y: bounds.min_y,
    };
    for p in candidates.into_iter().chain(boundary_points) {
        if p.x >= bounds.min_x && p.x <= bounds.max_x && p.y >= bounds.min_y && p.y <= bounds.max_y
        {
            let va = max(0.0, radius - distance(p, a));
            let vb = max(0.0, radius - distance(p, b));
            let vc = max(0.0, radius - distance(p, c));
            let total = va + vb + vc;
            if total < min_violation {
                min_violation = total;
                least_bad = p;
            }
        }
    }
    least_bad
}
