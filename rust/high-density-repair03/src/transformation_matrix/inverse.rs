use super::Matrix;

pub fn inverse(matrix: &Matrix) -> Matrix {
    let Matrix { a, b, c, d, e, f } = *matrix;
    let denom = a * d - b * c;
    Matrix {
        a: d / denom,
        b: b / -denom,
        c: c / -denom,
        d: a / denom,
        e: (d * e - c * f) / -denom,
        f: (b * e - a * f) / denom,
    }
}
