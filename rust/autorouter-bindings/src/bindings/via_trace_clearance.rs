use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = checkViaTraceClearanceNative)]
pub fn check_via_trace_clearance_native(input: JsValue) -> Result<JsValue, JsValue> {
    let input = serde_wasm_bindgen::from_value(input)
        .map_err(|error| js_sys::Error::new(&error.to_string()))?;
    let errors = autorouting_drc::check_via_trace_clearance::check_via_trace_clearance(&input);
    serde_wasm_bindgen::to_value(&errors)
        .map_err(|error| js_sys::Error::new(&error.to_string()).into())
}
