use super::Matrix;

pub fn translate(tx: f64, ty: f64) -> Matrix {
    Matrix { a: 1.0, c: 0.0, e: tx, b: 0.0, d: 1.0, f: ty }
}
