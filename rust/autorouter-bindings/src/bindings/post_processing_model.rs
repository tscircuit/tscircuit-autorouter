use serde::Deserialize;
use wasm_bindgen::prelude::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ObstacleAliasExpansionInput {
    aliases_by_route: Vec<Vec<u32>>,
    connected_to_by_obstacle: Vec<Vec<u32>>,
}

#[wasm_bindgen(js_name = expandPostProcessingObstacleConnectedIds)]
pub fn expand_post_processing_obstacle_connected_ids(params_json: &str) -> Result<String, JsValue> {
    let params: ObstacleAliasExpansionInput = serde_json::from_str(params_json)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let replacements = length_matching::post_processing::binding::create_post_processing_model::expand_obstacle_connected_ids(
        &params.aliases_by_route,
        &params.connected_to_by_obstacle,
    );
    serde_json::to_string(&replacements)
        .map_err(|error| JsValue::from_str(&error.to_string()))
}
