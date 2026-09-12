use checks::check_via_trace_clearance::{CheckViaTraceClearanceInput, ViaTraceClearanceViolation, check_via_trace_clearance};
use json_bindings::{JsonInput, JsonOutput, SpecialNumber};
use serde::{Deserialize, Serialize};
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
pub struct ViaTraceInput(pub JsonInput<CheckViaTraceClearanceInput>);

#[derive(Serialize, Tsify)]
#[serde(transparent)]
pub struct ViaTraceOutput(pub JsonOutput<Vec<ViaTraceClearanceViolation>>);

#[wasm_bindgen(js_name = checkViaTraceClearanceNative)]
pub fn check_via_trace_clearance_native(input: Ts<ViaTraceInput>) -> Result<Ts<ViaTraceOutput>, JsError> {
    let input = input.to_rust()?.0.deserialize()?;
    let mut errors = check_via_trace_clearance(&input);
    let mut numbers = Vec::new();
    for (index, error) in errors.iter_mut().enumerate() {
        for (path, number) in [
            (vec![index.to_string(), "minimum_clearance".into()], &mut error.minimum_clearance),
            (vec![index.to_string(), "actual_clearance".into()], &mut error.actual_clearance),
            (vec![index.to_string(), "center".into(), "x".into()], &mut error.center.x),
            (vec![index.to_string(), "center".into(), "y".into()], &mut error.center.y),
        ] {
            if !number.is_finite() {
                let value = if number.is_nan() { "NaN" } else if number.is_sign_positive() { "Infinity" } else { "-Infinity" };
                numbers.push(SpecialNumber { path, value: value.into() });
                *number = 0.0;
            }
        }
    }
    Ok(ViaTraceOutput(JsonOutput { value: errors, numbers }).into_ts()?)
}
