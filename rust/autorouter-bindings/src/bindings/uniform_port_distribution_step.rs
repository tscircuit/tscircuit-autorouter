use js_sys::Function;
use wasm_bindgen::prelude::*;
use uniform_port_distribution::{live_values::get, redistribute_port_points_on_shared_edge, should_ignore_port_point, should_ignore_shared_edge, uniform_port_distribution_solver::live};

#[wasm_bindgen(js_name = stepUniformPortDistribution)]
pub fn step_uniform_port_distribution(solver: JsValue, input: JsValue, spread_point: Function, find_node: Function, find_point: Function, read_obstacle: Function) -> Result<(), JsValue> {
    live::step(&solver, &input, &spread_point, &find_node, &find_point, &read_obstacle)
}
#[wasm_bindgen(js_name = rebuildUniformPortDistributionNodes)]
pub fn rebuild_uniform_port_distribution_nodes(solver: JsValue, input: JsValue, spread_point: Function, spread_node: Function) -> Result<(), JsValue> {
    live::rebuild_nodes(&solver, &input, &spread_point, &spread_node)
}
#[wasm_bindgen(js_name = shouldIgnoreUniformPortPoint)]
pub fn should_ignore_uniform_port_point(params: JsValue, find_node: Function, find_point: Function) -> Result<bool, JsValue> {
    should_ignore_port_point::should_ignore_port_point(&get(&params,"portPoint")?,&get(&params,"ownerNodeIds")?,&get(&params,"inputNodes")?, &find_node, &find_point)
}
#[wasm_bindgen(js_name = shouldIgnoreUniformSharedEdge)]
pub fn should_ignore_uniform_shared_edge(params: JsValue, read_obstacle: Function) -> Result<bool, JsValue> {
    should_ignore_shared_edge::should_ignore_shared_edge(&get(&params,"sharedEdge")?,&get(&params,"obstacles")?, &read_obstacle)
}
#[wasm_bindgen(js_name = redistributeUniformPortPointsOnSharedEdge)]
pub fn redistribute_uniform_port_points_on_shared_edge(params: JsValue, spread_point: Function) -> Result<JsValue, JsValue> {
    redistribute_port_points_on_shared_edge::redistribute_port_points_on_shared_edge(&get(&params,"sharedEdge")?,&get(&params,"portPoints")?,&spread_point)
}

