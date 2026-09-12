mod point_distance;
mod bounds_overlap;
mod get_bound_from_centered_rect;
mod polygon;
mod range;
mod map_z_to_layer_name;

pub use point_distance::*;
pub use bounds_overlap::*;
pub use get_bound_from_centered_rect::*;
pub use polygon::*;
pub use range::*;
pub use map_z_to_layer_name::*;

pub use autorouting_drc::math_utils::{js_min, js_max};

pub fn clamp(value: f64, min: f64, max: f64) -> f64 {
    js_max(min, js_min(max, value))
}
