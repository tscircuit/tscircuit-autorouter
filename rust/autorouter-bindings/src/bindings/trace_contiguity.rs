use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = checkTracesAreContiguousNative)]
pub fn check_traces_are_contiguous_native(circuit_json: &str) -> Result<String, JsValue> {
    let elements: Vec<serde_json::Value> = serde_json::from_str(circuit_json)
        .map_err(|error| js_sys::Error::new(&error.to_string()))?;
    let errors = trace_contiguity::check(&elements, trace_contiguity::Math {
        hypot: js_sys::Math::hypot,
        sin: js_sys::Math::sin,
        cos: js_sys::Math::cos,
    }).map_err(|error| js_sys::Error::new(&error))?;
    serde_json::to_string(&errors)
        .map_err(|error| js_sys::Error::new(&error.to_string()).into())
}
