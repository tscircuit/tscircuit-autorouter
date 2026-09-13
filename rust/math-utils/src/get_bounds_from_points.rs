use super::{Bounds, Point};

pub fn get_bounds_from_points(points: &[Point]) -> Option<Bounds> {
    if points.is_empty() {
        return None;
    }
    let mut min_x = points[0].x;
    let mut min_y = points[0].y;
    let mut max_x = points[0].x;
    let mut max_y = points[0].y;

    for point in &points[1..] {
        if point.x < min_x {
            min_x = point.x;
        }
        if point.y < min_y {
            min_y = point.y;
        }
        if point.x > max_x {
            max_x = point.x;
        }
        if point.y > max_y {
            max_y = point.y;
        }
    }
    Some(Bounds {
        min_x,
        min_y,
        max_x,
        max_y,
    })
}
