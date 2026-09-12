use wasm_bindgen::prelude::*;
use connectivity_map::get_connectivity_map_from_simple_route_json::{Input,get_connectivity_map_from_simple_route_json};
#[wasm_bindgen(js_name=buildConnectivityMap)]
pub fn build_connectivity_map(input_json:&str)->Result<String,JsValue>{
    let input:Input=serde_json::from_str(input_json).map_err(|error|JsValue::from_str(&error.to_string()))?;
    serde_json::to_string(&get_connectivity_map_from_simple_route_json(input)).map_err(|error|JsValue::from_str(&error.to_string()))
}
