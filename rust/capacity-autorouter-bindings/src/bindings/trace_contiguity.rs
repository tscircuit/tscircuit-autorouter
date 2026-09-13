use serde::{Deserialize, Serialize};
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
pub struct ContiguityInput(#[tsify(type = "unknown[]")] Vec<serde_json::Value>);

#[derive(Serialize, Tsify)]
#[serde(transparent)]
pub struct ContiguityErrors(
    #[tsify(type = "NativeContiguityError[]")] Vec<checks::ErrorDescriptor>,
);

#[wasm_bindgen(js_name = checkTracesAreContiguousNative)]
pub fn check_traces_are_contiguous_native(
    input: Ts<ContiguityInput>,
) -> Result<Ts<ContiguityErrors>, JsError> {
    let elements = input.to_rust()?.0;
    let errors = checks::check(
        &elements,
        checks::Math {
            hypot: js_sys::Math::hypot,
            sin: js_sys::Math::sin,
            cos: js_sys::Math::cos,
        },
    )
    .map_err(|error| JsError::new(&error))?;
    Ok(ContiguityErrors(errors).into_ts()?)
}
