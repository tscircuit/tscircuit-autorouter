use serde::{Deserialize, Serialize};
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;

#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ObstacleAliasExpansionInput {
    aliases_by_route: Vec<Vec<u32>>,
    connected_to_by_obstacle: Vec<Vec<u32>>,
}

#[derive(Serialize, Tsify)]
#[serde(transparent)]
pub struct ObstacleAliasReplacements(Vec<Option<Vec<u32>>>);

#[wasm_bindgen(js_name = expandPostProcessingObstacleConnectedIds)]
pub fn expand_post_processing_obstacle_connected_ids(
    params: Ts<ObstacleAliasExpansionInput>,
) -> Result<Ts<ObstacleAliasReplacements>, JsError> {
    let params = params.to_rust()?;
    let replacements = length_matching_solver::post_processing::binding::create_post_processing_model::expand_obstacle_connected_ids(
        &params.aliases_by_route,
        &params.connected_to_by_obstacle,
    );
    Ok(ObstacleAliasReplacements(replacements).into_ts()?)
}
