mod apply_to_point;
mod inverse;
mod rotate;
mod transform;
mod translate;

pub use apply_to_point::*;
pub use inverse::*;
pub use rotate::*;
pub use transform::*;
pub use translate::*;

#[derive(Clone, Copy, Debug)]
pub struct Matrix {
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
    pub e: f64,
    pub f: f64,
}
