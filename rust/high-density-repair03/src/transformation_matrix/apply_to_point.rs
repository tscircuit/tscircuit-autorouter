use super::Matrix;
use math_utils::Point;

pub fn apply_to_point(matrix: &Matrix, point: &Point) -> Point {
    Point {
        x: matrix.a * point.x + matrix.c * point.y + matrix.e,
        y: matrix.b * point.x + matrix.d * point.y + matrix.f,
    }
}

pub fn apply_to_points(matrix: &Matrix, points: &[Point]) -> Vec<Point> {
    points
        .iter()
        .map(|point| apply_to_point(matrix, point))
        .collect()
}
