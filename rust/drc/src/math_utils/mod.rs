use serde::{Deserialize, Serialize};

mod get_bounds_from_points;
mod line_intersections;
mod segment_distance;

pub use get_bounds_from_points::*;
pub use line_intersections::*;
pub use segment_distance::*;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[cfg_attr(feature = "wasm-types", derive(tsify::Tsify))]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Bounds {
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct Circle {
    pub x: f64,
    pub y: f64,
    pub radius: f64,
}

pub fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() { return f64::NAN; }
    if a == 0.0 && b == 0.0 {
        return if a.is_sign_negative() || b.is_sign_negative() { -0.0 } else { 0.0 };
    }
    if a < b { a } else { b }
}

pub fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() { return f64::NAN; }
    if a == 0.0 && b == 0.0 {
        return if a.is_sign_positive() || b.is_sign_positive() { 0.0 } else { -0.0 };
    }
    if a > b { a } else { b }
}

pub fn js_to_fixed(number: f64, digits: u8) -> String {
    assert!(digits <= 100, "toFixed() digits argument must be between 0 and 100");
    ryu_js::Buffer::new().format_to_fixed(number, digits).to_owned()
}

pub fn js_number_to_string(number: f64) -> String {
    ryu_js::Buffer::new().format(number).to_owned()
}
