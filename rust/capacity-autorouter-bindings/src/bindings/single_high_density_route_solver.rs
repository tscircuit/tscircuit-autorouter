use capacity_autorouter::solvers::high_density_solver::single_high_density_route_solver as single_route_solver;
use std::rc::Rc;
use std::cell::{RefCell, RefMut};
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;
use tsify::{Ts, Tsify};
use crate::bindings::high_density_wire::*;
use capacity_autorouter::solvers::high_density_solver::single_high_density_route_solver::{PlanarObstacleQuery, IndexedObstacleSegment};
use capacity_autorouter::data_structures::single_route_candidate_priority_queue::Node;

fn node(value: &Value) -> Rc<Node> {
    Rc::new(Node { x: value["x"].as_f64().expect("Node x required"), y: value["y"].as_f64().expect("Node y required"),
        z: value["z"].as_f64().unwrap_or(0.0), g: value["g"].as_f64().unwrap_or(f64::NAN),
        h: value["h"].as_f64().unwrap_or(f64::NAN), f: value["f"].as_f64().unwrap_or(f64::NAN),
        parent: value.get("parent").filter(|p| !p.is_null()).map(node) })
}

fn node_value(node: &Node) -> Value {
    json!({"x":node.x,"y":node.y,"z":node.z,"g":node.g,"h":node.h,"f":node.f,"parent":node.parent.as_ref().map(|p|node_value(p))})
}

fn segment_value(segment: &IndexedObstacleSegment) -> Value {
    json!({"z":segment.z,"A":segment.a,"B":segment.b,"minX":segment.min_x,"minY":segment.min_y,
        "maxX":segment.max_x,"maxY":segment.max_y,"connectedToCurrentConnection":segment.connected_to_current_connection})
}

enum SingleRouteStorage {
    Owned(RefCell<single_route_solver::SingleHighDensityRouteSolver>),
    Child(Rc<RefCell<crate::GeneralState>>, usize),
}

impl SingleHighDensityRouteSolver {
    pub(crate) fn child(parent: Rc<RefCell<crate::GeneralState>>, id: usize) -> Self {
        parent.borrow_mut().ensure_initialized().observed_child_ids.insert(id);
        Self { engine: SingleRouteStorage::Child(parent, id) }
    }

    fn borrow_engine(&self) -> RefMut<'_, single_route_solver::SingleHighDensityRouteSolver> {
        match &self.engine {
            SingleRouteStorage::Owned(engine) => engine.borrow_mut(),
            SingleRouteStorage::Child(parent, id) => RefMut::map(parent.borrow_mut(), |state| {
                let engine = state.ensure_initialized();
                if engine.active_sub_solver.as_ref().is_some_and(|child| child.diagnostic_id == *id) {
                    return engine.active_sub_solver.as_mut().unwrap();
                }
                engine.failed_sub_solvers.iter_mut().chain(engine.retired_children.iter_mut())
                    .find(|child| child.diagnostic_id == *id).expect("Observed native child must remain available")
            }),
        }
    }
}

#[wasm_bindgen]
pub struct SingleHighDensityRouteSolver {
    engine: SingleRouteStorage,
}

#[wasm_bindgen]
impl SingleHighDensityRouteSolver {
    #[wasm_bindgen(constructor)]
    pub fn new(props: Ts<HighDensityValue>, future_cost: bool) -> Result<Self, JsValue> {
        let props: Value = read_value(props)?;
        let mut engine = if future_cost { single_route_solver::SingleHighDensityRouteSolver::new_future_cost(props) } else { single_route_solver::SingleHighDensityRouteSolver::new(props) };
        engine.pow = js_sys::Math::pow;
        engine.exp = js_sys::Math::exp;
        Ok(Self { engine: SingleRouteStorage::Owned(RefCell::new(engine)) })
    }

    pub fn options(&self) -> Result<Ts<SingleRouteOptions>, JsValue> {
        let e = self.borrow_engine();
        SingleRouteOptions(json!({"connectionName":e.connection_name,"rootConnectionName":e.root_connection_name,
            "regionId":e.region_id,"A":e.a,"B":e.b,"bounds":e.bounds,"obstacleRoutes":e.obstacle_routes,
            "futureConnections":e.future_connections,"hyperParameters":e.hyper_parameters,"viaDiameter":e.via_diameter,
            "traceThickness":e.trace_thickness,"obstacleMargin":e.obstacle_margin,"availableZ":e.available_z,
            "layerCount":e.layer_count,"captureSearchDebug":e.debug_enabled,"minDistBetweenEnteringPoints":0})).into_ts().map_err(|error| JsError::new(&error.to_string()).into())
    }

    pub fn snapshot(&self) -> Result<Ts<SingleRouteSnapshot>, JsValue> {
        let borrowed = self.borrow_engine();
        let e = &*borrowed;
        let mut layers = Vec::new();
        for segment in &e.obstacle_segments {
            if !segment.connected_to_current_connection && !layers.contains(&(segment.z as i64)) { layers.push(segment.z as i64); }
        }
        let by_layer: Vec<_> = layers.iter().map(|layer| json!([layer,e.obstacle_segments_by_layer[layer].iter().map(segment_value).collect::<Vec<_>>()])).collect();
        let mut value = json!({"bounds":e.bounds,"boundsSize":{"width":e.bounds_size.x,"height":e.bounds_size.y},"boundsCenter":e.bounds_center,
            "A":e.a,"B":e.b,"straightLineDistance":e.straight_line_distance,"viaDiameter":e.via_diameter,"traceThickness":e.trace_thickness,
            "obstacleMargin":e.obstacle_margin,"layerCount":e.layer_count,"availableZ":e.available_z,"minCellSize":e.min_cell_size,"cellStep":e.cell_step,
            "GREEDY_MULTIPLER":e.greedy_multiplier,"numRoutes":e.num_routes,"VIA_PENALTY_FACTOR":e.via_penalty_factor,"CELL_SIZE_FACTOR":e.cell_size_factor,
            "NEARBY_SEGMENT_CLEARANCE":e.nearby_segment_clearance,"gridMinXIndex":e.grid_min_x_index,"gridMinYIndex":e.grid_min_y_index,
            "gridWidth":e.grid_width,"gridHeight":e.grid_height,"initialNodeGridOffset":e.initial_node_grid_offset,"debugEnabled":e.debug_enabled,
            "MAX_ITERATIONS":e.max_iterations,"iterations":e.iterations,"solved":e.solved,"failed":e.failed,"error":e.error,"progress":e.progress,
            "solvedPath":e.solved_path,"obstacleSegments":e.obstacle_segments.iter().map(segment_value).collect::<Vec<_>>(),"obstacleVias":e.obstacle_vias,
            "obstacleSegmentsByLayer":by_layer,"exploredNodes":e.explored_nodes.iter().copied().collect::<Vec<_>>(),
            "debug_exploredNodesOrdered":e.debug_explored_nodes_ordered.iter().map(|(key,p)|json!({"key":key,"x":p.x,"y":p.y,"z":p.z})).collect::<Vec<_>>(),
            "debug_nodesTooCloseToObstacle":e.debug_nodes_too_close_to_obstacle.iter().copied().collect::<Vec<_>>(),
            "debug_nodePathToParentIntersectsObstacle":e.debug_node_path_to_parent_intersects_obstacle.iter().copied().collect::<Vec<_>>()});
        if let Some(f) = &e.future_cost {
            value["futureConnectionPoints"] = json!(f.future_connection_points);
            for (key, number) in [("FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR",f.future_connection_prox_trace_penalty_factor),
                ("FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR",f.future_connection_prox_via_penalty_factor),("FUTURE_CONNECTION_PROXIMITY_VD",f.future_connection_proximity_vd),
                ("MISALIGNED_DIST_PENALTY_FACTOR",f.misaligned_dist_penalty_factor),("VIA_PENALTY_FACTOR_2",f.via_penalty_factor_2),
                ("FUTURE_CONNECTION_VIA_TRACE_CLEARANCE",f.future_connection_via_trace_clearance)] { value[key] = json!(number); }
            value["FLIP_TRACE_ALIGNMENT_DIRECTION"] = json!(f.flip_trace_alignment_direction);
        }
        SingleRouteSnapshot(value).into_ts().map_err(|error| JsError::new(&error.to_string()).into())
    }

    pub fn configure(&mut self, config: Ts<HighDensityValue>) -> Result<(), JsValue> {
        let v: Value = read_value(config)?;
        let mut borrowed = self.borrow_engine();
        let e = &mut *borrowed;
        macro_rules! number { ($field:ident,$key:literal) => { if let Some(value) = v[$key].as_f64() { e.$field = value; } }; }
        number!(via_diameter,"viaDiameter"); number!(trace_thickness,"traceThickness"); number!(obstacle_margin,"obstacleMargin");
        number!(cell_step,"cellStep"); number!(min_cell_size,"minCellSize"); number!(greedy_multiplier,"GREEDY_MULTIPLER");
        number!(via_penalty_factor,"VIA_PENALTY_FACTOR"); number!(cell_size_factor,"CELL_SIZE_FACTOR"); number!(nearby_segment_clearance,"NEARBY_SEGMENT_CLEARANCE");
        number!(grid_min_x_index,"gridMinXIndex"); number!(grid_min_y_index,"gridMinYIndex"); number!(grid_width,"gridWidth"); number!(grid_height,"gridHeight");
        if let Some(value) = v["MAX_ITERATIONS"].as_u64() { e.max_iterations = value as usize; }
        e.progress = v["progress"].as_f64().unwrap_or(f64::NAN);
        if let Some(f) = &mut e.future_cost {
            macro_rules! future { ($field:ident,$key:literal) => { if let Some(value) = v[$key].as_f64() { f.$field = value; } }; }
            future!(future_connection_prox_trace_penalty_factor,"FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR");
            future!(future_connection_prox_via_penalty_factor,"FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR");
            future!(future_connection_proximity_vd,"FUTURE_CONNECTION_PROXIMITY_VD"); future!(misaligned_dist_penalty_factor,"MISALIGNED_DIST_PENALTY_FACTOR");
            future!(via_penalty_factor_2,"VIA_PENALTY_FACTOR_2"); future!(future_connection_via_trace_clearance,"FUTURE_CONNECTION_VIA_TRACE_CLEARANCE");
            if let Some(value) = v["FLIP_TRACE_ALIGNMENT_DIRECTION"].as_bool() { f.flip_trace_alignment_direction = value; }
        }
        Ok(())
    }

    pub fn call(&mut self, method: &str, args: Ts<HighDensityValue>) -> Result<Ts<HighDensityValue>, JsValue> {
        let a: Value = read_value(args)?;
        let mut borrowed = self.borrow_engine();
        let e = &mut *borrowed;
        let query = a.get("query").filter(|q| !q.is_null()).map(|q| PlanarObstacleQuery {
            layer: q["layer"].as_i64().expect("Query layer required"),
            segment_ids: q["segmentIds"].as_array().expect("Query ids required").iter().map(|id|id.as_u64().unwrap() as usize).collect(),
        });
        let result = match method {
            "step" => { e.iterations = a["iterations"].as_u64().unwrap() as usize; e.step_inner(); Value::Null }
            "handleSimpleCases" => { e.handle_simple_cases(); Value::Null }
            "buildObstacleIndexes" => { e.obstacle_routes = serde_json::from_value(a["routes"].clone()).map_err(|error|JsValue::from_str(&error.to_string()))?; e.build_obstacle_indexes(); Value::Null }
            "viaPenaltyDistance" => json!(e.via_penalty_distance()),
            "isNodeTooCloseToObstacle" => json!(e.is_node_too_close_to_obstacle(&node(&a["node"]),a["margin"].as_f64(),a["isVia"].as_bool().unwrap_or(false),query.as_ref())),
            "isNodeTooCloseToEdge" => json!(e.is_node_too_close_to_edge(&node(&a["node"]),a["isVia"].as_bool().unwrap_or(false))),
            "doesPathToParentIntersectObstacle" => json!(e.does_path_to_parent_intersect_obstacle(&node(&a["node"]),query.as_ref())),
            "queryBounds" => {
                let n = node(&a["node"]);
                if let Some(p) = &n.parent {
                    if e.obstacle_segment_index_by_layer.contains_key(&(n.z as i64)) {
                        let proximity = e.trace_thickness + e.obstacle_margin;
                        let clearance = if n.z == p.z && !e.obstacle_segments.is_empty() { e.nearby_segment_clearance } else { 0.0 };
                        json!([(n.x-proximity).min(p.x-clearance),(n.y-proximity).min(p.y-clearance),(n.x+proximity).max(p.x+clearance),(n.y+proximity).max(p.y+clearance)])
                    } else { Value::Null }
                } else { Value::Null }
            }
            "search" => {
                let index = match a["kind"].as_str().unwrap() {
                    "segments" => e.obstacle_segment_index.as_ref(), "vias" => e.obstacle_via_index.as_ref(),
                    "layer" => e.obstacle_segment_index_by_layer.get(&a["layer"].as_i64().unwrap()), _ => return Err(JsValue::from_str("Unknown index kind")),
                };
                let bounds = a["bounds"].as_array().unwrap();
                json!(index.expect("Obstacle index required").search(bounds[0].as_f64().unwrap(),bounds[1].as_f64().unwrap(),bounds[2].as_f64().unwrap(),bounds[3].as_f64().unwrap()))
            }
            "computeG" => json!(e.compute_g(&node(&a["node"]))),
            "computeH" => json!(e.compute_h(&node(&a["node"]))),
            "computeF" => json!(e.compute_f(a["g"].as_f64().unwrap_or(f64::NAN),a["h"].as_f64().unwrap_or(f64::NAN))),
            "setNodeCosts" => { let mut n = (*node(&a["node"])).clone(); e.set_node_costs(&mut n); json!({"g":n.g,"h":n.h,"f":n.f}) }
            "getNodeKey" => json!(e.get_node_key(&node(&a["node"]))),
            "getNeighbors" => json!(e.get_neighbors(node(&a["node"])).iter().map(|n|node_value(n)).collect::<Vec<_>>()),
            "getNodePath" => json!(e.get_node_path(node(&a["node"])).iter().map(|n|node_value(n)).collect::<Vec<_>>()),
            "getViasInNodePath" => json!(e.get_vias_in_node_path(&node(&a["node"])).as_ref()),
            "setSolvedPath" => { e.set_solved_path(node(&a["node"])); Value::Null }
            "computeProgress" => json!(e.compute_progress(a["goalDist"].as_f64(),a["isOnLayer"].as_bool())),
            "closestFuturePointIndex" => {
                let closest = e.get_closest_future_connection_point(&node(&a["node"]));
                json!(closest.and_then(|point|e.future_cost.as_ref().unwrap().future_connection_points.iter().position(|p|*p==point)))
            }
            "getFutureConnectionSegments" => json!(e.get_future_connection_segments().iter().map(|s|json!({"connectionName":s.connection_name,"start":s.start,"end":s.end})).collect::<Vec<_>>()),
            "isViaTooCloseToFutureConnectionTrace" => json!(e.is_via_too_close_to_future_connection_trace(&node(&a["node"]))),
            "diminishCloseToGoal" => json!(e.diminish_close_to_goal(&node(&a["node"]))),
            "getFutureConnectionPenalty" => json!(e.get_future_connection_penalty(&node(&a["node"]),a["isVia"].as_bool().unwrap_or(false))),
            "queuePeek" => e.candidates.peek().map(|n|node_value(&n)).unwrap_or(Value::Null),
            "queueDequeue" => e.candidates.dequeue().map(|n|node_value(&n)).unwrap_or(Value::Null),
            "queueEnqueue" => { e.candidates.enqueue(node(&a["node"])); Value::Null }
            "queueHeapifyUp" => { e.candidates.heapify_up(); Value::Null }
            "queueHeapifyDown" => { e.candidates.heapify_down(); Value::Null }
            "queueTop" => json!(e.candidates.get_top_n(a["n"].as_u64().unwrap() as usize).iter().map(|n|node_value(n)).collect::<Vec<_>>()),
            "visualize" => e.visualize(),
            _ => return Err(JsValue::from_str(&format!("Unknown single-route operation {method}"))),
        };
        HighDensityValue(result).into_ts().map_err(|error| JsError::new(&error.to_string()).into())
    }
}
