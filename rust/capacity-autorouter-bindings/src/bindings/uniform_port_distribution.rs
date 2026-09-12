use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;
use capacity_autorouter::solvers::uniform_port_distribution_solver::determine_owner_pair;
use capacity_autorouter::solvers::uniform_port_distribution_solver::get_owner_pair_key;
use capacity_autorouter::solvers::uniform_port_distribution_solver::get_shared_edge_for_node_pair;
use capacity_autorouter::solvers::uniform_port_distribution_solver::precompute_shared_edges;
use capacity_autorouter::solvers::uniform_port_distribution_solver::types::{Bounds, Name, InputNodeWithPortPoints, NodeWithPortPoints, OwnerPair, SharedEdge};
use capacity_autorouter::solvers::uniform_port_distribution_solver::uniform_port_distribution_solver::{UniformPortDistributionConstructor, UniformPortDistributionInput};

#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct UniformOwnerPairInput {
    #[tsify(type = "UniformName | null")]
    port_point_id: Option<Name>,
    #[tsify(type = "UniformName")]
    current_node_id: Name,
    #[tsify(type = "UniformInputNodeWithPortPoints[]")]
    input_nodes: Vec<InputNodeWithPortPoints>,
}

#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct UniformSharedEdgeInput {
    #[tsify(type = "UniformName")]
    node_a_id: Name,
    #[tsify(type = "UniformName")]
    node_b_id: Name,
    #[tsify(type = "[UniformName, UniformBounds][]")]
    node_bounds: Vec<(Name, Bounds)>,
}

#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct UniformSharedEdgesInput {
    #[tsify(type = "UniformOwnerPair[]")]
    owner_pairs: Vec<OwnerPair>,
    #[tsify(type = "[UniformName, UniformBounds][]")]
    node_bounds: Vec<(Name, Bounds)>,
}

#[derive(Deserialize, Serialize, Tsify)]
#[serde(transparent)]
pub struct UniformOwnerPair(#[tsify(type = "[UniformName, UniformName]")] OwnerPair);

#[derive(Serialize, Tsify)]
#[serde(transparent)]
pub struct UniformOptionalSharedEdge(#[tsify(type = "UniformSharedEdge | null")] Option<SharedEdge>);

#[derive(Serialize, Tsify)]
#[serde(transparent)]
pub struct UniformSharedEdges(#[tsify(type = "[UniformName, UniformSharedEdge][]")] Vec<(Name, SharedEdge)>);

#[wasm_bindgen(js_name = buildUniformPortDistribution)]
pub fn build_uniform_port_distribution(input: Ts<UniformPortDistributionInput>) -> Result<Ts<UniformPortDistributionConstructor>, JsError> {
    let input = input.to_rust()?;
    let result = UniformPortDistributionConstructor::new(&input);
    Ok(result.into_ts()?)
}

#[wasm_bindgen(js_name = determineUniformPortOwnerPair)]
pub fn determine_uniform_port_owner_pair(input: Ts<UniformOwnerPairInput>) -> Result<Ts<UniformOwnerPair>, JsError> {
    let input = input.to_rust()?;
    let pair = determine_owner_pair::determine_owner_pair(input.port_point_id.as_ref(), &input.current_node_id, &input.input_nodes);
    Ok(UniformOwnerPair(pair).into_ts()?)
}

#[wasm_bindgen(js_name = normalizeUniformPortOwnerPair)]
pub fn normalize_uniform_port_owner_pair(node_a: Ts<Name>, node_b: Ts<Name>) -> Result<Ts<UniformOwnerPair>, JsError> {
    let a = node_a.to_rust()?;
    let b = node_b.to_rust()?;
    let pair = get_owner_pair_key::normalize_owner_pair(&a, &b);
    Ok(UniformOwnerPair(pair).into_ts()?)
}

#[wasm_bindgen(js_name = getUniformPortOwnerPairKey)]
pub fn get_uniform_port_owner_pair_key(owner_node_ids: Ts<UniformOwnerPair>) -> Result<Ts<Name>, JsError> {
    let pair = owner_node_ids.to_rust()?.0;
    Ok(get_owner_pair_key::get_owner_pair_key(&pair).into_ts()?)
}

#[wasm_bindgen(js_name = getUniformSharedEdge)]
pub fn get_uniform_shared_edge(input: Ts<UniformSharedEdgeInput>) -> Result<Ts<UniformOptionalSharedEdge>, JsError> {
    let input = input.to_rust()?;
    let bounds: IndexMap<_, _> = input.node_bounds.into_iter().collect();
    Ok(UniformOptionalSharedEdge(get_shared_edge_for_node_pair::get_shared_edge_for_node_pair(&input.node_a_id, &input.node_b_id, &bounds)).into_ts()?)
}

#[wasm_bindgen(js_name = precomputeUniformSharedEdges)]
pub fn precompute_uniform_shared_edges(input: Ts<UniformSharedEdgesInput>) -> Result<Ts<UniformSharedEdges>, JsError> {
    let input = input.to_rust()?;
    let bounds: IndexMap<_, _> = input.node_bounds.into_iter().collect();
    let edges = precompute_shared_edges::precompute_shared_edges(&input.owner_pairs, &bounds).into_iter().collect();
    Ok(UniformSharedEdges(edges).into_ts()?)
}

#[wasm_bindgen(js_name = getUniformNodeBounds)]
pub fn get_uniform_node_bounds(input: Ts<NodeWithPortPoints>) -> Result<Ts<Bounds>, JsError> {
    let node = input.to_rust()?;
    let bounds = capacity_autorouter::solvers::uniform_port_distribution_solver::get_bounds_from_node_with_port_points::get_bounds_from_node_with_port_points(&node);
    Ok(bounds.into_ts()?)
}
