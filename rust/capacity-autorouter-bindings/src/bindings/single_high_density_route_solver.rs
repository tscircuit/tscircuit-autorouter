use crate::bindings::high_density_wire::*;
use capacity_autorouter::data_structures::single_route_candidate_priority_queue::Node;
use capacity_autorouter::solvers::high_density_solver::single_high_density_route_solver as single_route_solver;
use capacity_autorouter::solvers::high_density_solver::single_high_density_route_solver::{
    IndexedObstacleSegment, PlanarObstacleQuery,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::cell::{RefCell, RefMut};
use std::rc::Rc;
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;

#[derive(Serialize, Deserialize, Tsify)]
#[serde(transparent)]
pub struct SingleRouteNode(
    #[tsify(
        type = "import('../../../lib/data-structures/SingleRouteCandidatePriorityQueue').Node"
    )]
    pub Value,
);

#[derive(Serialize, Tsify)]
#[serde(transparent)]
pub struct SingleRouteNodes(#[tsify(type = "SingleRouteNode[]")] pub Vec<Value>);

#[derive(Serialize, Tsify)]
#[serde(transparent)]
pub struct OptionalSingleRouteNode(#[tsify(type = "SingleRouteNode | null")] pub Option<Value>);

#[derive(Serialize, Tsify)]
pub struct SingleRouteNodeCosts {
    pub g: Option<f64>,
    pub h: Option<f64>,
    pub f: Option<f64>,
}

#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct SingleRouteQuery {
    pub layer: i64,
    pub segment_ids: Vec<usize>,
}

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
pub struct OptionalSingleRouteQuery(pub Option<SingleRouteQuery>);

#[derive(Serialize, Deserialize, Tsify)]
#[serde(transparent)]
pub struct SingleRouteQueryBounds(pub [f64; 4]);

#[derive(Serialize, Tsify)]
#[serde(transparent)]
pub struct OptionalSingleRouteQueryBounds(pub Option<[f64; 4]>);

#[derive(Serialize, Tsify)]
#[serde(transparent)]
pub struct SingleRouteIndices(pub Vec<usize>);

#[derive(Serialize, Tsify)]
#[serde(transparent)]
pub struct SingleRouteVias(#[tsify(type = "{ x: number; y: number }[]")] pub Value);

#[derive(Serialize, Tsify)]
#[serde(transparent)]
pub struct SingleRouteFutureSegments(
    #[tsify(
        type = "import('../../../lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost').FutureConnectionSegment[]"
    )]
    pub Vec<Value>,
);

fn read_node(value: Ts<SingleRouteNode>) -> Result<Rc<Node>, JsValue> {
    value
        .to_rust()
        .map(|value| node(&value.0))
        .map_err(|error| JsError::new(&error.to_string()).into())
}

fn read_query(value: Ts<OptionalSingleRouteQuery>) -> Result<Option<PlanarObstacleQuery>, JsValue> {
    value
        .to_rust()
        .map(|value| {
            value.0.map(|query| PlanarObstacleQuery {
                layer: query.layer,
                segment_ids: query.segment_ids,
            })
        })
        .map_err(|error| JsError::new(&error.to_string()).into())
}

fn numeric_result(value: f64) -> f64 {
    // The JSON adapter converted nonfinite scalar results to null, then TS NaN.
    if value.is_finite() { value } else { f64::NAN }
}

fn unsigned_count(value: f64) -> Result<usize, JsValue> {
    if !(0.0..18_446_744_073_709_551_616.0).contains(&value) || value.fract() != 0.0 {
        return Err(JsError::new("Expected a nonnegative integer count").into());
    }
    // Match the former JSON u64 conversion followed by the WASM usize cast.
    Ok(value as u64 as usize)
}

fn node(value: &Value) -> Rc<Node> {
    Rc::new(Node {
        x: value["x"].as_f64().expect("Node x required"),
        y: value["y"].as_f64().expect("Node y required"),
        z: value["z"].as_f64().unwrap_or(0.0),
        g: value["g"].as_f64().unwrap_or(f64::NAN),
        h: value["h"].as_f64().unwrap_or(f64::NAN),
        f: value["f"].as_f64().unwrap_or(f64::NAN),
        parent: value.get("parent").filter(|p| !p.is_null()).map(node),
    })
}

fn node_value(node: &Node) -> Value {
    json!({"x":node.x,"y":node.y,"z":node.z,"g":node.g,"h":node.h,"f":node.f,"parent":node.parent.as_ref().map(|p|node_value(p))})
}

fn segment_value(segment: &IndexedObstacleSegment) -> Value {
    json!({"z":segment.z,"A":segment.a,"B":segment.b,"minX":segment.min_x,"minY":segment.min_y,
        "maxX":segment.max_x,"maxY":segment.max_y,"connectedToCurrentConnection":segment.connected_to_current_connection})
}

#[expect(
    clippy::large_enum_variant,
    reason = "Keep solver storage inline without introducing another allocation."
)]
enum SingleRouteStorage {
    Owned(RefCell<single_route_solver::SingleHighDensityRouteSolver>),
    Child(Rc<RefCell<crate::GeneralState>>, usize),
}

impl SingleHighDensityRouteSolver {
    pub(crate) fn child(parent: Rc<RefCell<crate::GeneralState>>, id: usize) -> Self {
        parent
            .borrow_mut()
            .ensure_initialized()
            .observed_child_ids
            .insert(id);
        Self {
            engine: SingleRouteStorage::Child(parent, id),
        }
    }

    fn borrow_engine(&self) -> RefMut<'_, single_route_solver::SingleHighDensityRouteSolver> {
        match &self.engine {
            SingleRouteStorage::Owned(engine) => engine.borrow_mut(),
            SingleRouteStorage::Child(parent, id) => RefMut::map(parent.borrow_mut(), |state| {
                let engine = state.ensure_initialized();
                if engine
                    .active_sub_solver
                    .as_ref()
                    .is_some_and(|child| child.diagnostic_id == *id)
                {
                    return engine.active_sub_solver.as_mut().unwrap();
                }
                engine
                    .failed_sub_solvers
                    .iter_mut()
                    .chain(engine.retired_children.iter_mut())
                    .find(|child| child.diagnostic_id == *id)
                    .expect("Observed native child must remain available")
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
        let mut engine = if future_cost {
            single_route_solver::SingleHighDensityRouteSolver::new_future_cost(props)
        } else {
            single_route_solver::SingleHighDensityRouteSolver::new(props)
        };
        engine.pow = js_sys::Math::pow;
        engine.exp = js_sys::Math::exp;
        Ok(Self {
            engine: SingleRouteStorage::Owned(RefCell::new(engine)),
        })
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
            if !segment.connected_to_current_connection && !layers.contains(&(segment.z as i64)) {
                layers.push(segment.z as i64);
            }
        }
        let by_layer: Vec<_> = layers
            .iter()
            .map(|layer| {
                json!([
                    layer,
                    e.obstacle_segments_by_layer[layer]
                        .iter()
                        .map(segment_value)
                        .collect::<Vec<_>>()
                ])
            })
            .collect();
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
            for (key, number) in [
                (
                    "FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR",
                    f.future_connection_prox_trace_penalty_factor,
                ),
                (
                    "FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR",
                    f.future_connection_prox_via_penalty_factor,
                ),
                (
                    "FUTURE_CONNECTION_PROXIMITY_VD",
                    f.future_connection_proximity_vd,
                ),
                (
                    "MISALIGNED_DIST_PENALTY_FACTOR",
                    f.misaligned_dist_penalty_factor,
                ),
                ("VIA_PENALTY_FACTOR_2", f.via_penalty_factor_2),
                (
                    "FUTURE_CONNECTION_VIA_TRACE_CLEARANCE",
                    f.future_connection_via_trace_clearance,
                ),
            ] {
                value[key] = json!(number);
            }
            value["FLIP_TRACE_ALIGNMENT_DIRECTION"] = json!(f.flip_trace_alignment_direction);
        }
        SingleRouteSnapshot(value)
            .into_ts()
            .map_err(|error| JsError::new(&error.to_string()).into())
    }

    pub fn configure(&mut self, config: Ts<HighDensityValue>) -> Result<(), JsValue> {
        let v: Value = read_value(config)?;
        let mut borrowed = self.borrow_engine();
        let e = &mut *borrowed;
        macro_rules! number {
            ($field:ident,$key:literal) => {
                if let Some(value) = v[$key].as_f64() {
                    e.$field = value;
                }
            };
        }
        number!(via_diameter, "viaDiameter");
        number!(trace_thickness, "traceThickness");
        number!(obstacle_margin, "obstacleMargin");
        number!(cell_step, "cellStep");
        number!(min_cell_size, "minCellSize");
        number!(greedy_multiplier, "GREEDY_MULTIPLER");
        number!(via_penalty_factor, "VIA_PENALTY_FACTOR");
        number!(cell_size_factor, "CELL_SIZE_FACTOR");
        number!(nearby_segment_clearance, "NEARBY_SEGMENT_CLEARANCE");
        number!(grid_min_x_index, "gridMinXIndex");
        number!(grid_min_y_index, "gridMinYIndex");
        number!(grid_width, "gridWidth");
        number!(grid_height, "gridHeight");
        if let Some(value) = v["MAX_ITERATIONS"].as_u64() {
            e.max_iterations = value as usize;
        }
        e.progress = v["progress"].as_f64().unwrap_or(f64::NAN);
        if let Some(f) = &mut e.future_cost {
            macro_rules! future {
                ($field:ident,$key:literal) => {
                    if let Some(value) = v[$key].as_f64() {
                        f.$field = value;
                    }
                };
            }
            future!(
                future_connection_prox_trace_penalty_factor,
                "FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR"
            );
            future!(
                future_connection_prox_via_penalty_factor,
                "FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR"
            );
            future!(
                future_connection_proximity_vd,
                "FUTURE_CONNECTION_PROXIMITY_VD"
            );
            future!(
                misaligned_dist_penalty_factor,
                "MISALIGNED_DIST_PENALTY_FACTOR"
            );
            future!(via_penalty_factor_2, "VIA_PENALTY_FACTOR_2");
            future!(
                future_connection_via_trace_clearance,
                "FUTURE_CONNECTION_VIA_TRACE_CLEARANCE"
            );
            if let Some(value) = v["FLIP_TRACE_ALIGNMENT_DIRECTION"].as_bool() {
                f.flip_trace_alignment_direction = value;
            }
        }
        Ok(())
    }

    #[wasm_bindgen(js_name = step)]
    pub fn step(&mut self, iterations: f64) -> Result<(), JsValue> {
        let iterations = unsigned_count(iterations)?;
        let mut e = self.borrow_engine();
        e.iterations = iterations;
        e.step_inner();
        Ok(())
    }

    #[wasm_bindgen(js_name = handleSimpleCases)]
    pub fn handle_simple_cases(&mut self) {
        self.borrow_engine().handle_simple_cases();
    }

    #[wasm_bindgen(js_name = buildObstacleIndexes)]
    pub fn build_obstacle_indexes(&mut self, routes: Ts<HighDensityRoutes>) -> Result<(), JsValue> {
        let routes = routes
            .to_rust()
            .map_err(|error| JsError::new(&error.to_string()))?;
        let mut e = self.borrow_engine();
        e.obstacle_routes = serde_json::from_value(json!(routes.0))
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        e.build_obstacle_indexes();
        Ok(())
    }

    #[wasm_bindgen(js_name = viaPenaltyDistance)]
    pub fn via_penalty_distance(&mut self) -> f64 {
        numeric_result(self.borrow_engine().via_penalty_distance())
    }

    #[wasm_bindgen(js_name = isNodeTooCloseToObstacle)]
    pub fn is_node_too_close_to_obstacle(
        &mut self,
        node: Ts<SingleRouteNode>,
        margin: Option<f64>,
        is_via: bool,
        query: Ts<OptionalSingleRouteQuery>,
    ) -> Result<bool, JsValue> {
        let node = read_node(node)?;
        let query = read_query(query)?;
        Ok(self.borrow_engine().is_node_too_close_to_obstacle(
            &node,
            margin
                .filter(|value| value.is_finite())
                .map(|value| if value == 0.0 { 0.0 } else { value }),
            is_via,
            query.as_ref(),
        ))
    }

    #[wasm_bindgen(js_name = isNodeTooCloseToEdge)]
    pub fn is_node_too_close_to_edge(
        &mut self,
        node: Ts<SingleRouteNode>,
        is_via: bool,
    ) -> Result<bool, JsValue> {
        let node = read_node(node)?;
        Ok(self
            .borrow_engine()
            .is_node_too_close_to_edge(&node, is_via))
    }

    #[wasm_bindgen(js_name = doesPathToParentIntersectObstacle)]
    pub fn does_path_to_parent_intersect_obstacle(
        &mut self,
        node: Ts<SingleRouteNode>,
        query: Ts<OptionalSingleRouteQuery>,
    ) -> Result<bool, JsValue> {
        let node = read_node(node)?;
        let query = read_query(query)?;
        Ok(self
            .borrow_engine()
            .does_path_to_parent_intersect_obstacle(&node, query.as_ref()))
    }

    #[wasm_bindgen(js_name = queryBounds)]
    pub fn query_bounds(
        &mut self,
        node: Ts<SingleRouteNode>,
    ) -> Result<Ts<OptionalSingleRouteQueryBounds>, JsValue> {
        let n = read_node(node)?;
        let e = self.borrow_engine();
        let bounds = n.parent.as_ref().and_then(|p| {
            if e.obstacle_segment_index_by_layer
                .contains_key(&(n.z as i64))
            {
                let proximity = e.trace_thickness + e.obstacle_margin;
                let clearance = if n.z == p.z && !e.obstacle_segments.is_empty() {
                    e.nearby_segment_clearance
                } else {
                    0.0
                };
                Some([
                    (n.x - proximity).min(p.x - clearance),
                    (n.y - proximity).min(p.y - clearance),
                    (n.x + proximity).max(p.x + clearance),
                    (n.y + proximity).max(p.y + clearance),
                ])
            } else {
                None
            }
        });
        OptionalSingleRouteQueryBounds(bounds)
            .into_ts()
            .map_err(|error| JsError::new(&error.to_string()).into())
    }

    #[wasm_bindgen(js_name = searchObstacleSegments)]
    pub fn search_obstacle_segments(
        &mut self,
        bounds: Ts<SingleRouteQueryBounds>,
    ) -> Result<Ts<SingleRouteIndices>, JsValue> {
        let bounds = bounds
            .to_rust()
            .map_err(|error| JsError::new(&error.to_string()))?
            .0;
        let e = self.borrow_engine();
        let index = e.obstacle_segment_index.as_ref();
        SingleRouteIndices(
            index
                .expect("Obstacle index required")
                .search(bounds[0], bounds[1], bounds[2], bounds[3]),
        )
        .into_ts()
        .map_err(|error| JsError::new(&error.to_string()).into())
    }

    #[wasm_bindgen(js_name = searchObstacleVias)]
    pub fn search_obstacle_vias(
        &mut self,
        bounds: Ts<SingleRouteQueryBounds>,
    ) -> Result<Ts<SingleRouteIndices>, JsValue> {
        let bounds = bounds
            .to_rust()
            .map_err(|error| JsError::new(&error.to_string()))?
            .0;
        let e = self.borrow_engine();
        let index = e.obstacle_via_index.as_ref();
        SingleRouteIndices(
            index
                .expect("Obstacle index required")
                .search(bounds[0], bounds[1], bounds[2], bounds[3]),
        )
        .into_ts()
        .map_err(|error| JsError::new(&error.to_string()).into())
    }

    #[wasm_bindgen(js_name = searchObstacleSegmentsOnLayer)]
    pub fn search_obstacle_segments_on_layer(
        &mut self,
        layer: f64,
        bounds: Ts<SingleRouteQueryBounds>,
    ) -> Result<Ts<SingleRouteIndices>, JsValue> {
        let bounds = bounds
            .to_rust()
            .map_err(|error| JsError::new(&error.to_string()))?
            .0;
        let e = self.borrow_engine();
        if !(-9_223_372_036_854_775_808.0..9_223_372_036_854_775_808.0).contains(&layer)
            || layer.fract() != 0.0
        {
            return Err(JsError::new("Expected an integer obstacle layer").into());
        }
        let index = e.obstacle_segment_index_by_layer.get(&(layer as i64));
        SingleRouteIndices(
            index
                .expect("Obstacle index required")
                .search(bounds[0], bounds[1], bounds[2], bounds[3]),
        )
        .into_ts()
        .map_err(|error| JsError::new(&error.to_string()).into())
    }

    #[wasm_bindgen(js_name = computeG)]
    pub fn compute_g(&mut self, node: Ts<SingleRouteNode>) -> Result<f64, JsValue> {
        let node = read_node(node)?;
        Ok(numeric_result(self.borrow_engine().compute_g(&node)))
    }

    #[wasm_bindgen(js_name = computeH)]
    pub fn compute_h(&mut self, node: Ts<SingleRouteNode>) -> Result<f64, JsValue> {
        let node = read_node(node)?;
        Ok(numeric_result(self.borrow_engine().compute_h(&node)))
    }

    #[wasm_bindgen(js_name = diminishCloseToGoal)]
    pub fn diminish_close_to_goal(&mut self, node: Ts<SingleRouteNode>) -> Result<f64, JsValue> {
        let node = read_node(node)?;
        Ok(numeric_result(
            self.borrow_engine().diminish_close_to_goal(&node),
        ))
    }

    #[wasm_bindgen(js_name = computeF)]
    pub fn compute_f(&mut self, g: f64, h: f64) -> f64 {
        // Preserve JSON input normalization for nonfinite values and negative zero.
        let g = if g == 0.0 { 0.0 } else { numeric_result(g) };
        let h = if h == 0.0 { 0.0 } else { numeric_result(h) };
        numeric_result(self.borrow_engine().compute_f(g, h))
    }

    #[wasm_bindgen(js_name = setNodeCosts)]
    pub fn set_node_costs(
        &mut self,
        node: Ts<SingleRouteNode>,
    ) -> Result<Ts<SingleRouteNodeCosts>, JsValue> {
        let mut node = (*read_node(node)?).clone();
        self.borrow_engine().set_node_costs(&mut node);
        SingleRouteNodeCosts {
            g: node.g.is_finite().then_some(node.g),
            h: node.h.is_finite().then_some(node.h),
            f: node.f.is_finite().then_some(node.f),
        }
        .into_ts()
        .map_err(|error| JsError::new(&error.to_string()).into())
    }

    #[wasm_bindgen(js_name = getNodeKey)]
    pub fn get_node_key(&mut self, node: Ts<SingleRouteNode>) -> Result<f64, JsValue> {
        let node = read_node(node)?;
        Ok(self.borrow_engine().get_node_key(&node) as f64)
    }

    #[wasm_bindgen(js_name = getNeighbors)]
    pub fn get_neighbors(
        &mut self,
        node: Ts<SingleRouteNode>,
    ) -> Result<Ts<SingleRouteNodes>, JsValue> {
        let node = read_node(node)?;
        SingleRouteNodes(
            self.borrow_engine()
                .get_neighbors(node)
                .iter()
                .map(|node| node_value(node))
                .collect(),
        )
        .into_ts()
        .map_err(|error| JsError::new(&error.to_string()).into())
    }

    #[wasm_bindgen(js_name = getNodePath)]
    pub fn get_node_path(
        &mut self,
        node: Ts<SingleRouteNode>,
    ) -> Result<Ts<SingleRouteNodes>, JsValue> {
        let node = read_node(node)?;
        SingleRouteNodes(
            self.borrow_engine()
                .get_node_path(node)
                .iter()
                .map(|node| node_value(node))
                .collect(),
        )
        .into_ts()
        .map_err(|error| JsError::new(&error.to_string()).into())
    }

    #[wasm_bindgen(js_name = getViasInNodePath)]
    pub fn get_vias_in_node_path(
        &mut self,
        node: Ts<SingleRouteNode>,
    ) -> Result<Ts<SingleRouteVias>, JsValue> {
        let node = read_node(node)?;
        SingleRouteVias(json!(
            self.borrow_engine().get_vias_in_node_path(&node).as_ref()
        ))
        .into_ts()
        .map_err(|error| JsError::new(&error.to_string()).into())
    }

    #[wasm_bindgen(js_name = setSolvedPath)]
    pub fn set_solved_path(&mut self, node: Ts<SingleRouteNode>) -> Result<(), JsValue> {
        let node = read_node(node)?;
        self.borrow_engine().set_solved_path(node);
        Ok(())
    }

    #[wasm_bindgen(js_name = computeProgress)]
    pub fn compute_progress(&mut self, goal_dist: Option<f64>, is_on_layer: Option<bool>) -> f64 {
        let goal_dist = goal_dist
            .filter(|value| value.is_finite())
            .map(|value| if value == 0.0 { 0.0 } else { value });
        numeric_result(
            self.borrow_engine()
                .compute_progress(goal_dist, is_on_layer),
        )
    }

    #[wasm_bindgen(js_name = closestFuturePointIndex)]
    pub fn closest_future_point_index(
        &mut self,
        node: Ts<SingleRouteNode>,
    ) -> Result<Option<usize>, JsValue> {
        let node = read_node(node)?;
        let e = self.borrow_engine();
        let closest = e.get_closest_future_connection_point(&node);
        Ok(closest.and_then(|point| {
            e.future_cost
                .as_ref()
                .unwrap()
                .future_connection_points
                .iter()
                .position(|p| *p == point)
        }))
    }

    #[wasm_bindgen(js_name = getFutureConnectionSegments)]
    pub fn get_future_connection_segments(
        &mut self,
    ) -> Result<Ts<SingleRouteFutureSegments>, JsValue> {
        SingleRouteFutureSegments(self.borrow_engine().get_future_connection_segments().iter().map(|s| json!({"connectionName": s.connection_name, "start": s.start, "end": s.end})).collect())
            .into_ts()
            .map_err(|error| JsError::new(&error.to_string()).into())
    }

    #[wasm_bindgen(js_name = isViaTooCloseToFutureConnectionTrace)]
    pub fn is_via_too_close_to_future_connection_trace(
        &mut self,
        node: Ts<SingleRouteNode>,
    ) -> Result<bool, JsValue> {
        let node = read_node(node)?;
        Ok(self
            .borrow_engine()
            .is_via_too_close_to_future_connection_trace(&node))
    }

    #[wasm_bindgen(js_name = getFutureConnectionPenalty)]
    pub fn get_future_connection_penalty(
        &mut self,
        node: Ts<SingleRouteNode>,
        is_via: bool,
    ) -> Result<f64, JsValue> {
        let node = read_node(node)?;
        Ok(numeric_result(
            self.borrow_engine()
                .get_future_connection_penalty(&node, is_via),
        ))
    }

    #[wasm_bindgen(js_name = queuePeek)]
    pub fn queue_peek(&mut self) -> Result<Ts<OptionalSingleRouteNode>, JsValue> {
        OptionalSingleRouteNode(
            self.borrow_engine()
                .candidates
                .peek()
                .map(|node| node_value(&node)),
        )
        .into_ts()
        .map_err(|error| JsError::new(&error.to_string()).into())
    }

    #[wasm_bindgen(js_name = queueDequeue)]
    pub fn queue_dequeue(&mut self) -> Result<Ts<OptionalSingleRouteNode>, JsValue> {
        OptionalSingleRouteNode(
            self.borrow_engine()
                .candidates
                .dequeue()
                .map(|node| node_value(&node)),
        )
        .into_ts()
        .map_err(|error| JsError::new(&error.to_string()).into())
    }

    #[wasm_bindgen(js_name = queueEnqueue)]
    pub fn queue_enqueue(&mut self, node: Ts<SingleRouteNode>) -> Result<(), JsValue> {
        let node = read_node(node)?;
        self.borrow_engine().candidates.enqueue(node);
        Ok(())
    }

    #[wasm_bindgen(js_name = queueHeapifyUp)]
    pub fn queue_heapify_up(&mut self) {
        self.borrow_engine().candidates.heapify_up();
    }

    #[wasm_bindgen(js_name = queueHeapifyDown)]
    pub fn queue_heapify_down(&mut self) {
        self.borrow_engine().candidates.heapify_down();
    }

    #[wasm_bindgen(js_name = queueTop)]
    pub fn queue_top(&mut self, n: f64) -> Result<Ts<SingleRouteNodes>, JsValue> {
        let n = unsigned_count(n)?;
        SingleRouteNodes(
            self.borrow_engine()
                .candidates
                .get_top_n(n)
                .iter()
                .map(|node| node_value(node))
                .collect(),
        )
        .into_ts()
        .map_err(|error| JsError::new(&error.to_string()).into())
    }

    #[wasm_bindgen(js_name = visualize)]
    pub fn visualize(&mut self) -> Result<Ts<HighDensityGraphics>, JsValue> {
        HighDensityGraphics(self.borrow_engine().visualize())
            .into_ts()
            .map_err(|error| JsError::new(&error.to_string()).into())
    }
}
