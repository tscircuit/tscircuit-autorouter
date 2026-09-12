use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = computeIntraNodeCacheKey)]
pub fn compute_intra_node_cache_key(
    snapshot_json: &str,
    locale: &js_sys::Function,
) -> Result<String, JsValue> {
    capacity_autorouter::solvers::high_density_solver::cached_intra_node_route_solver::compute(snapshot_json, locale).map_err(|error| JsValue::from_str(&error))
}
