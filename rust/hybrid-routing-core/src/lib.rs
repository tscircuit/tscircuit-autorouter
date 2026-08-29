mod geometry;
mod protocol;
mod search;

use protocol::{CoreResponse, SearchRequest};
use thiserror::Error;

pub use protocol::{CORE_PROTOCOL_VERSION, CoreFailureCode};

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("invalid hybrid routing core request: {0}")]
    InvalidRequest(#[from] serde_json::Error),
    #[error("unsupported hybrid routing core protocol version {actual}; expected {expected}")]
    UnsupportedProtocolVersion { actual: u32, expected: u32 },
    #[error("invalid hybrid routing core search rules: {0}")]
    InvalidRules(String),
}

pub fn execute_protocol(input_json: &str) -> Result<String, CoreError> {
    let request: SearchRequest = serde_json::from_str(input_json)?;
    request.validate()?;
    let response: CoreResponse = search::search_region(&request);
    Ok(serde_json::to_string(&response)?)
}

#[cfg(feature = "node")]
#[napi_derive::napi(js_name = "executeHybridRoutingCore")]
pub fn execute_hybrid_routing_core_node(input_json: String) -> napi::Result<String> {
    execute_protocol(&input_json).map_err(|error| napi::Error::from_reason(error.to_string()))
}

#[cfg(feature = "wasm")]
#[wasm_bindgen::prelude::wasm_bindgen(js_name = executeHybridRoutingCore)]
pub fn execute_hybrid_routing_core_wasm(input_json: &str) -> Result<String, wasm_bindgen::JsValue> {
    execute_protocol(input_json)
        .map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))
}
