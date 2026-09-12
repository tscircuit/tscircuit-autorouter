use capacity_autorouter::utils::get_connectivity_map_from_simple_route_json::{
    Input, get_connectivity_map_from_simple_route_json,
};
use circuit_json_to_connectivity_map::connectivity_map::ConnectivityMap;
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = buildConnectivityMap)]
pub fn build_connectivity_map(input: Ts<Input>) -> Result<Ts<ConnectivityMap>, JsError> {
    let input = input.to_rust()?;
    let map = get_connectivity_map_from_simple_route_json(input);
    Ok(map.into_ts()?)
}
