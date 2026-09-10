use serde::{Deserialize, Serialize};
use crate::types::Point;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AffineTransform {
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
    pub e: f64,
    pub f: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GridToAffineTransformParams {
    pub origin_x: f64,
    pub origin_y: f64,
    pub rows: f64,
    pub cols: f64,
    pub cell_size_mm: f64,
    pub width: f64,
    pub height: f64,
}

pub fn compute_grid_to_affine_transform(params: GridToAffineTransformParams) -> AffineTransform {
    let GridToAffineTransformParams { origin_x, origin_y, rows, cols, cell_size_mm, width, height } = params;
    let (a, c) = if cols > 1.0 {
        let a = width / ((cols - 1.0) * cell_size_mm);
        (a, origin_x * (1.0 - a) - 0.5 * cell_size_mm * a)
    } else {
        (1.0, origin_x + width / 2.0 - (origin_x + 0.5 * cell_size_mm))
    };
    let (e, f) = if rows > 1.0 {
        let e = height / ((rows - 1.0) * cell_size_mm);
        (e, origin_y * (1.0 - e) - 0.5 * cell_size_mm * e)
    } else {
        (1.0, origin_y + height / 2.0 - (origin_y + 0.5 * cell_size_mm))
    };
    AffineTransform { a, b: 0.0, c, d: 0.0, e, f }
}

pub fn apply_affine_transform_to_point(t: &AffineTransform, p: &Point) -> Point {
    Point {
        x: t.a * p.x + t.b * p.y + t.c,
        y: t.d * p.x + t.e * p.y + t.f,
    }
}
