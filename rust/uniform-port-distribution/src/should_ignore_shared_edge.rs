use crate::live_values::*;
use js_sys::{Float64Array, Function};
use wasm_bindgen::{JsCast, JsValue};
const EPSILON: f64 = 1e-6;

pub fn should_ignore_shared_edge(shared_edge: &JsValue, obstacles: &JsValue, read_obstacle: &Function) -> Result<bool, JsValue> {
    for obstacle in values(obstacles)? {
        let obstacle = obstacle?;
        let input: Float64Array = read_obstacle.call1(&JsValue::UNDEFINED,&obstacle)?.unchecked_into();
        let mut scalars = [0.0; 8];
        input.copy_to(&mut scalars);
        let min_x = scalars[0] - scalars[1] / 2.0;
        let max_x = scalars[2] + scalars[3] / 2.0;
        let min_y = scalars[4] - scalars[5] / 2.0;
        let max_y = scalars[6] + scalars[7] / 2.0;
        if get(shared_edge,"orientation")? == property_key("vertical") {
            if (number(get(shared_edge,"x1")?) - min_x).abs() < EPSILON || (number(get(shared_edge,"x1")?) - max_x).abs() < EPSILON {
                let overlap_min = js_sys::Math::max(number(get(shared_edge,"y1")?), min_y);
                let overlap_max = js_sys::Math::min(number(get(shared_edge,"y2")?), max_y);
                if overlap_max - overlap_min > EPSILON { return Ok(true); }
            }
            continue;
        }
        if (number(get(shared_edge,"y1")?) - min_y).abs() < EPSILON || (number(get(shared_edge,"y1")?) - max_y).abs() < EPSILON {
            let overlap_min = js_sys::Math::max(number(get(shared_edge,"x1")?), min_x);
            let overlap_max = js_sys::Math::min(number(get(shared_edge,"x2")?), max_x);
            if overlap_max - overlap_min > EPSILON { return Ok(true); }
        }
    }
    Ok(false)
}

