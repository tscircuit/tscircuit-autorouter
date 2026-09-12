use crate::internal_types::{Point, Bounds2D};

pub fn get_bound_from_centered_rect(center: &Point, width: f64, height: f64) -> Bounds2D {
    let half_width = width / 2.0;
    let half_height = height / 2.0;
    Bounds2D { min_x: center.x - half_width, max_x: center.x + half_width,
        min_y: center.y - half_height, max_y: center.y + half_height }
}
