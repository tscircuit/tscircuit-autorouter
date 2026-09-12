use crate::solvers::uniform_port_distribution_solver::live_values::*;
use js_sys::{Array, Function, Map};
use wasm_bindgen::{closure::Closure, JsCast, JsValue};

pub fn redistribute_port_points_on_shared_edge(shared_edge: &JsValue, port_points: &JsValue, spread_point: &Function) -> Result<JsValue, JsValue> {
    if array(port_points).length() == 0 { return Ok(Array::new().into()); }
    let ports_by_z = Map::new();
    for point in values(port_points)? {
        let point = point?;
        let mut z = get(&point, "z")?;
        if z.is_null() || z.is_undefined() { z = JsValue::from_f64(0.0); }
        let existing = ports_by_z.get(&z);
        let existing: Array = if existing.is_null() || existing.is_undefined() { Array::new() } else { existing.unchecked_into() };
        existing.push(&point);
        ports_by_z.set(&z, &existing);
    }
    let redistributed = Array::new();
    let layers = Array::from(&ports_by_z.keys());
    let compare_layers = Closure::wrap(Box::new(|a: JsValue, b: JsValue| -> f64 { number(a) - number(b) }) as Box<dyn FnMut(JsValue, JsValue) -> f64>);
    call(&layers, "sort", &args(&[compare_layers.as_ref().clone()]))?;
    for layer in values(&layers)? {
        let points = ports_by_z.get(&layer?);
        let count = array(&points).length();
        let edge = shared_edge.clone();
        let comparator = Closure::wrap(Box::new(move |a: JsValue, b: JsValue| -> Result<f64, JsValue> {
            let axis = if get(&edge, "orientation")? == property_key("horizontal") { "x" } else { "y" };
            Ok(number(get(&a, axis)?) - number(get(&b, axis)?))
        }) as Box<dyn FnMut(JsValue, JsValue) -> Result<f64, JsValue>>);
        call(&points, "sort", &args(&[comparator.as_ref().clone()]))?;
        for index in 0..count {
            let fraction = (2.0 * index as f64 + 1.0) / (2.0 * count as f64);
            let x = if get(shared_edge, "orientation")? == property_key("horizontal") {
                number(get(shared_edge, "x1")?) + number(get(shared_edge, "length")?) * fraction
            } else { number(get(shared_edge, "x1")?) };
            let y = if get(shared_edge, "orientation")? == property_key("horizontal") {
                number(get(shared_edge, "y1")?)
            } else { number(get(shared_edge, "y1")?) + number(get(shared_edge, "length")?) * fraction };
            redistributed.push(&spread_point.call3(&JsValue::UNDEFINED, &array(&points).get(index), &JsValue::from_f64(x), &JsValue::from_f64(y))?);
        }
    }
    Ok(redistributed.into())
}

