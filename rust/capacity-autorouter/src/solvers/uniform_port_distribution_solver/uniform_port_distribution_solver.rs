use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use crate::solvers::uniform_port_distribution_solver::types::{Bounds, Name, InputNodeWithPortPoints, NodeWithPortPoints, OwnerPair, SharedEdge};
use crate::solvers::uniform_port_distribution_solver::determine_owner_pair::determine_owner_pair;
use crate::solvers::uniform_port_distribution_solver::get_bounds_from_node_with_port_points::get_bounds_from_node_with_port_points;
use crate::solvers::uniform_port_distribution_solver::get_owner_pair_key::get_owner_pair_key;
use crate::solvers::uniform_port_distribution_solver::precompute_shared_edges::precompute_shared_edges;

#[cfg_attr(feature = "wasm-types", derive(tsify::Tsify))]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UniformPortDistributionInput {
    #[cfg_attr(feature = "wasm-types", tsify(type = "UniformNodeWithPortPoints[]"))]
    pub node_with_port_points: Vec<NodeWithPortPoints>,
    #[cfg_attr(feature = "wasm-types", tsify(type = "UniformInputNodeWithPortPoints[]"))]
    pub input_nodes_with_port_points: Vec<InputNodeWithPortPoints>,
}

#[cfg_attr(feature = "wasm-types", derive(tsify::Tsify))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FamilyPoint {
    pub node_index: usize,
    pub point_index: usize,
    #[cfg_attr(feature = "wasm-types", tsify(type = "[UniformName, UniformName]"))]
    pub owner_node_ids: OwnerPair,
    #[cfg_attr(feature = "wasm-types", tsify(type = "UniformName"))]
    pub owner_pair_key: Name,
}

#[cfg_attr(feature = "wasm-types", derive(tsify::Tsify))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UniformPortDistributionConstructor {
    #[cfg_attr(feature = "wasm-types", tsify(type = "[UniformName, UniformBounds][]"))]
    pub node_bounds: Vec<(Name, Bounds)>,
    #[cfg_attr(feature = "wasm-types", tsify(type = "[UniformName, FamilyPoint[]][]"))]
    pub owner_pair_port_points: Vec<(Name, Vec<FamilyPoint>)>,
    #[cfg_attr(feature = "wasm-types", tsify(type = "[UniformName, UniformSharedEdge][]"))]
    pub shared_edges: Vec<(Name, SharedEdge)>,
    #[cfg_attr(feature = "wasm-types", tsify(type = "UniformName[]"))]
    pub owner_pairs_to_process: Vec<Name>,
}

impl UniformPortDistributionConstructor {
    pub fn new(input: &UniformPortDistributionInput) -> Self {
        let mut map_of_node_id_to_bounds = IndexMap::new();
        for node in &input.node_with_port_points {
            map_of_node_id_to_bounds.insert(node.capacity_mesh_node_id.clone(), get_bounds_from_node_with_port_points(node));
        }
        let mut map_of_owner_pair_to_port_points: IndexMap<Name, Vec<FamilyPoint>> = IndexMap::new();
        let mut unique_owner_pairs = IndexMap::new();
        for (node_index, node) in input.node_with_port_points.iter().enumerate() {
            for (point_index, port_point) in node.port_points.iter().enumerate() {
                let Some(port_point_id) = port_point.port_point_id.as_ref().filter(|id|!id.is_empty()) else { continue; };
                let owner_node_ids = determine_owner_pair(Some(port_point_id), &node.capacity_mesh_node_id, &input.input_nodes_with_port_points);
                let owner_pair_key = get_owner_pair_key(&owner_node_ids);
                let existing = map_of_owner_pair_to_port_points.entry(owner_pair_key.clone()).or_default();
                let already_present = existing.iter().any(|point| {
                    let id = input.node_with_port_points[point.node_index].port_points[point.point_index].port_point_id.as_ref();
                    id.is_some_and(|id| !id.is_empty() && id == port_point_id)
                });
                if !already_present {
                    existing.push(FamilyPoint { node_index, point_index, owner_node_ids: owner_node_ids.clone(), owner_pair_key: owner_pair_key.clone() });
                }
                unique_owner_pairs.insert(owner_pair_key, owner_node_ids);
            }
        }
        let owner_pairs: Vec<_> = unique_owner_pairs.into_values().collect();
        let map_of_owner_pair_to_shared_edge = precompute_shared_edges(&owner_pairs, &map_of_node_id_to_bounds);
        let mut owner_pairs_to_process: Vec<_> = map_of_owner_pair_to_shared_edge.keys().cloned().collect();
        owner_pairs_to_process.sort_by(|a, b| {
            let edge_a = &map_of_owner_pair_to_shared_edge[a];
            let edge_b = &map_of_owner_pair_to_shared_edge[b];
            let x = edge_a.center.x - edge_b.center.x;
            let difference = if x != 0.0 && !x.is_nan() { x } else { edge_a.center.y - edge_b.center.y };
            difference.partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal)
        });
        Self { node_bounds: map_of_node_id_to_bounds.into_iter().collect(),
            owner_pair_port_points: map_of_owner_pair_to_port_points.into_iter().collect(),
            shared_edges: map_of_owner_pair_to_shared_edge.into_iter().collect(), owner_pairs_to_process }
    }
}

#[cfg(target_arch = "wasm32")]
pub mod live {
    use crate::solvers::uniform_port_distribution_solver::live_values::*;
    use crate::solvers::uniform_port_distribution_solver::redistribute_port_points_on_shared_edge::redistribute_port_points_on_shared_edge;
    use crate::solvers::uniform_port_distribution_solver::should_ignore_port_point::should_ignore_port_point;
    use crate::solvers::uniform_port_distribution_solver::should_ignore_shared_edge::should_ignore_shared_edge;
    use js_sys::{Array, Function, Map};
    use wasm_bindgen::{closure::Closure, JsCast, JsValue};

    pub fn step(solver: &JsValue, input: &JsValue, spread_point: &Function, find_node: &Function, find_point: &Function, read_obstacle: &Function) -> Result<(), JsValue> {
        let queue = get(solver, "ownerPairsToProcess")?;
        if array(&queue).length() == 0 {
            // Invoke the public method so an explicitly overridden method receives
            // exactly the same call as the source class.
            call(solver, "rebuildNodes", &Array::new())?;
            set(solver, "solved", &JsValue::TRUE)?;
            return Ok(());
        }
        let owner_pair = call(&queue, "shift", &Array::new())?;
        set(solver, "currentOwnerPairBeingProcessed", &owner_pair)?;
        let owner_pair = get(solver, "currentOwnerPairBeingProcessed")?;
        let shared_edge = call(&get(solver,"mapOfOwnerPairToSharedEdge")?,"get",&args(&[owner_pair.clone()]))?;
        if !truthy(&shared_edge) { return Ok(()); }
        if should_ignore_shared_edge(&shared_edge, &get(input,"obstacles")?, read_obstacle)? { return Ok(()); }
        let family_raw = call(&get(solver,"mapOfOwnerPairToPortPoints")?,"get",&args(&[owner_pair.clone()]))?;
        let family_raw = if family_raw.is_null() || family_raw.is_undefined() { Array::new().into() } else { family_raw };
        let family = Array::new();
        for point in values(&family_raw)? {
            let point = point?;
            if !should_ignore_port_point(&point, &get(&point,"ownerNodeIds")?, &get(input,"inputNodesWithPortPoints")?, find_node, find_point)? { family.push(&point); }
        }
        let redistributed = redistribute_port_points_on_shared_edge(&shared_edge, &family, spread_point)?;
        call(&get(solver,"mapOfOwnerPairToPortPoints")?,"set",&args(&[owner_pair,redistributed]))?;
        Ok(())
    }

    fn update_port_point_position(point: JsValue, positions: &Map, spread_point: &Function) -> Result<JsValue, JsValue> {
        if truthy(&get(&point,"portPointId")?) && positions.has(&get(&point,"portPointId")?) {
            let position = positions.get(&get(&point,"portPointId")?);
            return spread_point.call3(&JsValue::UNDEFINED,&point,&get(&position,"x")?,&get(&position,"y")?);
        }
        Ok(point)
    }
    pub fn rebuild_nodes(solver: &JsValue, input: &JsValue, spread_point: &Function, spread_node: &Function) -> Result<(), JsValue> {
        let positions = Map::new();
        let families = call(&get(solver,"mapOfOwnerPairToPortPoints")?,"values",&Array::new())?;
        for family in values(&families)? {
            for point in values(&family?)? {
                let point = point?;
                if truthy(&get(&point,"portPointId")?) {
                    let id = get(&point,"portPointId")?;
                    let position = js_sys::Object::new();
                    set(&position,"x",&get(&point,"x")?)?;
                    set(&position,"y",&get(&point,"y")?)?;
                    positions.set(&id,&position);
                }
            }
        }
        // These callbacks are owned by JS so a custom map implementation may
        // retain them after rebuild returns, just as it may retain TS callbacks.
        let update_positions = positions.clone();
        let update_spread = spread_point.clone();
        let update = Closure::wrap(Box::new(move |point: JsValue| -> Result<JsValue, JsValue> {
            update_port_point_position(point,&update_positions,&update_spread)
        }) as Box<dyn Fn(JsValue) -> Result<JsValue,JsValue>>).into_js_value();
        let node_spread = spread_node.clone();
        let point_spread = spread_point.clone();
        let map_key = JsValue::from_str("map");
        let node_mapper = Closure::wrap(Box::new(move |node: JsValue| -> Result<JsValue,JsValue> {
            let node_copy = node_spread.call1(&JsValue::UNDEFINED,&node)?;
            let original_points = get(&node,"portPoints")?;
            let point_map = js_sys::Reflect::get(&original_points,&map_key)?.dyn_into::<Function>()?;
            let points = point_map.call1(&original_points,&update)?;
            let original_pairs = get(&node,"portPointsInPairs")?;
            let pairs = if original_pairs.is_null() || original_pairs.is_undefined() { JsValue::UNDEFINED } else {
                let pair_positions = positions.clone();
                let pair_spread = point_spread.clone();
                let pair_mapper = Closure::wrap(Box::new(move |pair: JsValue| -> Result<JsValue,JsValue> {
                    let mut endpoints = values(&pair)?;
                    let start = endpoints.next().transpose()?.unwrap_or(JsValue::UNDEFINED);
                    let end = endpoints.next().transpose()?.unwrap_or(JsValue::UNDEFINED);
                    Ok(args(&[
                        update_port_point_position(start,&pair_positions,&pair_spread)?,
                        update_port_point_position(end,&pair_positions,&pair_spread)?,
                    ]).into())
                }) as Box<dyn Fn(JsValue) -> Result<JsValue,JsValue>>).into_js_value();
                let pair_map = js_sys::Reflect::get(&original_pairs,&map_key)?.dyn_into::<Function>()?;
                pair_map.call1(&original_pairs,&pair_mapper)?
            };
            node_spread.call3(&JsValue::UNDEFINED,&node_copy,&points,&pairs)
        }) as Box<dyn Fn(JsValue) -> Result<JsValue,JsValue>>).into_js_value();
        let nodes = get(input,"nodeWithPortPoints")?;
        let node_map = js_sys::Reflect::get(&nodes,&JsValue::from_str("map"))?.dyn_into::<Function>()?;
        let result = node_map.call1(&nodes,&node_mapper)?;
        set(solver,"redistributedNodes",&result)?;
        Ok(())
    }
}

