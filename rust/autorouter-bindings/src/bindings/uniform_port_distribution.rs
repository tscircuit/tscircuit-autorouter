use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;
use uniform_port_distribution::{determine_owner_pair, get_owner_pair_key, get_shared_edge_for_node_pair, precompute_shared_edges};
use uniform_port_distribution::types::{Bounds, Name, InputNodeWithPortPoints, NodeWithPortPoints, OwnerPair};
use uniform_port_distribution::uniform_port_distribution_solver::{UniformPortDistributionConstructor, UniformPortDistributionInput};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OwnerPairInput {
    port_point_id: Option<Name>,
    current_node_id: Name,
    input_nodes: Vec<InputNodeWithPortPoints>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SharedEdgeInput {
    node_a_id: Name,
    node_b_id: Name,
    node_bounds: Vec<(Name, Bounds)>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SharedEdgesInput {
    owner_pairs: Vec<OwnerPair>,
    node_bounds: Vec<(Name, Bounds)>,
}

fn encode<T: Serialize>(value: &T) -> Result<JsValue, JsValue> {
    // Ordered Maps use entry arrays at this boundary; metadata stays in JS.
    // Numeric fields remain JS numbers, including signed zero and NaN.
    value.serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

#[wasm_bindgen(js_name = buildUniformPortDistribution)]
pub fn build_uniform_port_distribution(input: JsValue) -> Result<JsValue, JsValue> {
    let input: UniformPortDistributionInput = serde_wasm_bindgen::from_value(input)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let result = UniformPortDistributionConstructor::new(&input);
    encode(&result)
}

#[wasm_bindgen(js_name = determineUniformPortOwnerPair)]
pub fn determine_uniform_port_owner_pair(input: JsValue) -> Result<JsValue, JsValue> {
    let input: OwnerPairInput = serde_wasm_bindgen::from_value(input)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let pair = determine_owner_pair::determine_owner_pair(input.port_point_id.as_ref(), &input.current_node_id, &input.input_nodes);
    encode(&pair)
}

#[wasm_bindgen(js_name = normalizeUniformPortOwnerPair)]
pub fn normalize_uniform_port_owner_pair(node_a: JsValue, node_b: JsValue) -> Result<JsValue, JsValue> {
    let a: Name = serde_wasm_bindgen::from_value(node_a).map_err(|error|JsValue::from_str(&error.to_string()))?;
    let b: Name = serde_wasm_bindgen::from_value(node_b).map_err(|error|JsValue::from_str(&error.to_string()))?;
    let pair = get_owner_pair_key::normalize_owner_pair(&a, &b);
    encode(&pair)
}

#[wasm_bindgen(js_name = getUniformPortOwnerPairKey)]
pub fn get_uniform_port_owner_pair_key(owner_node_ids: JsValue) -> Result<JsValue, JsValue> {
    let pair: OwnerPair = serde_wasm_bindgen::from_value(owner_node_ids)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    encode(&get_owner_pair_key::get_owner_pair_key(&pair))
}

#[wasm_bindgen(js_name = getUniformSharedEdge)]
pub fn get_uniform_shared_edge(input: JsValue) -> Result<JsValue, JsValue> {
    let input: SharedEdgeInput = serde_wasm_bindgen::from_value(input)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let bounds: IndexMap<_, _> = input.node_bounds.into_iter().collect();
    encode(&get_shared_edge_for_node_pair::get_shared_edge_for_node_pair(&input.node_a_id, &input.node_b_id, &bounds))
}

#[wasm_bindgen(js_name = precomputeUniformSharedEdges)]
pub fn precompute_uniform_shared_edges(input: JsValue) -> Result<JsValue, JsValue> {
    let input: SharedEdgesInput = serde_wasm_bindgen::from_value(input)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let bounds: IndexMap<_, _> = input.node_bounds.into_iter().collect();
    let edges: Vec<_> = precompute_shared_edges::precompute_shared_edges(&input.owner_pairs, &bounds).into_iter().collect();
    encode(&edges)
}

#[wasm_bindgen(js_name = getUniformNodeBounds)]
pub fn get_uniform_node_bounds(input: JsValue) -> Result<JsValue, JsValue> {
    let node: NodeWithPortPoints = serde_wasm_bindgen::from_value(input)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let bounds = uniform_port_distribution::get_bounds_from_node_with_port_points::get_bounds_from_node_with_port_points(&node);
    encode(&bounds)
}
