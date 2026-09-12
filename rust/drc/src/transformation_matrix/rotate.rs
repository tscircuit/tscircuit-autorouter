use super::{Matrix, transform, translate};

pub fn rotate_with_math(angle: f64, center: Option<(f64, f64)>, sin: fn(f64) -> f64, cos: fn(f64) -> f64) -> Matrix {
    let cos_angle = cos(angle);
    let sin_angle = sin(angle);
    let rotation_matrix = Matrix { a: cos_angle, c: -sin_angle, e: 0.0, b: sin_angle, d: cos_angle, f: 0.0 };
    if let Some((cx, cy)) = center {
        return transform(&[translate(cx, cy), rotation_matrix, translate(-cx, -cy)]);
    }
    rotation_matrix
}

pub fn rotate(angle: f64, center: Option<(f64, f64)>) -> Matrix {
    rotate_with_math(angle, center, f64::sin, f64::cos)
}

pub fn rotate_deg_with_math(angle: f64, sin: fn(f64) -> f64, cos: fn(f64) -> f64) -> Matrix {
    rotate_with_math(angle * std::f64::consts::PI / 180.0, None, sin, cos)
}

pub fn rotate_deg(angle: f64) -> Matrix {
    rotate_deg_with_math(angle, f64::sin, f64::cos)
}
