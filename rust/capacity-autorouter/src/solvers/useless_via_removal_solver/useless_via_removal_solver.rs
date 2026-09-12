use super::can_endpoint_connect_on_layer::TerminalLayers;
use super::single_route_useless_via_removal_solver::{
    SingleRouteUselessViaRemovalSolver, SingleRouteUselessViaRemovalSolverParams,
};
use crate::bindings::high_density::specialized_base_solver::{BaseSolverState, SpecializedSolver};
use crate::bindings::trace_simplification::high_density_route_spatial_index::HighDensityRouteSpatialIndex;
use crate::bindings::trace_simplification::types::{
    ConnectivityMap, Math, ObstacleRef, Point2, RouteRef,
};
use crate::data_structures::obstacle_tree::ObstacleSpatialHashIndex;
use serde_json::{Value, json};
use std::cell::RefCell;
use std::collections::VecDeque;
use std::rc::Rc;

pub struct UselessViaRemovalSolverInput {
    pub unsimplified_hd_routes: Vec<RouteRef>,
    pub other_hd_routes: Vec<RouteRef>,
    pub obstacles: Vec<ObstacleRef>,
    pub layer_count: f64,
    pub conn_map: Rc<ConnectivityMap>,
    pub outline: Option<Vec<Point2>>,
    pub terminal_layers: Option<Rc<TerminalLayers>>,
    pub options: Value,
    pub math: Math,
}

pub struct UselessViaRemovalSolver {
    pub identity: u64,
    pub unsimplified_routes_array_identity: u64,
    pub optimized_routes_array_identity: u64,
    pub unprocessed_routes_array_identity: u64,
    pub base: BaseSolverState,
    pub stats: Value,
    pub input: UselessViaRemovalSolverInput,
    pub unsimplified_hd_routes: Vec<RouteRef>,
    pub optimized_hd_routes: Vec<RouteRef>,
    pub unprocessed_routes: VecDeque<RouteRef>,
    pub active_sub_solver: Option<Rc<RefCell<SingleRouteUselessViaRemovalSolver>>>,
    pub obstacle_shi: Rc<RefCell<ObstacleSpatialHashIndex>>,
    pub hd_route_shi: Rc<RefCell<HighDensityRouteSpatialIndex>>,
}

impl UselessViaRemovalSolver {
    pub fn new(mut input: UselessViaRemovalSolverInput) -> Self {
        input.obstacles = crate::utils::create_objects_with_z_layers::normalize_obstacles(
            input.obstacles,
            input.layer_count,
        );
        let obstacle_shi = Rc::new(RefCell::new(ObstacleSpatialHashIndex::new_flatbush(
            input.obstacles.clone(),
        )));
        let hd_route_shi = Rc::new(RefCell::new(HighDensityRouteSpatialIndex::new(
            input
                .unsimplified_hd_routes
                .iter()
                .chain(input.other_hd_routes.iter())
                .cloned()
                .collect(),
            1.0,
        )));
        Self {
            identity: crate::bindings::trace_simplification::types::next_identity(),
            unsimplified_routes_array_identity:
                crate::bindings::trace_simplification::types::next_identity(),
            optimized_routes_array_identity:
                crate::bindings::trace_simplification::types::next_identity(),
            unprocessed_routes_array_identity:
                crate::bindings::trace_simplification::types::next_identity(),
            base: BaseSolverState {
                max_iterations: 1e6,
                ..Default::default()
            },
            stats: json!({}),
            unsimplified_hd_routes: input.unsimplified_hd_routes.clone(),
            unprocessed_routes: input.unsimplified_hd_routes.iter().cloned().collect(),
            optimized_hd_routes: Vec::new(),
            active_sub_solver: None,
            obstacle_shi,
            hd_route_shi,
            input,
        }
    }

    pub fn get_optimized_hd_routes(&self) -> &[RouteRef] {
        &self.optimized_hd_routes
    }
}

impl SpecializedSolver for UselessViaRemovalSolver {
    fn base(&self) -> &BaseSolverState {
        &self.base
    }
    fn base_mut(&mut self) -> &mut BaseSolverState {
        &mut self.base
    }
    fn get_solver_name(&self) -> &'static str {
        "UselessViaRemovalSolver"
    }

    fn _step(&mut self) -> Result<(), String> {
        if let Some(child_ref) = self.active_sub_solver.clone() {
            let mut child = child_ref.borrow_mut();
            child.step()?;
            if child.base.solved {
                let optimized = child.get_optimized_hd_route();
                self.hd_route_shi
                    .borrow_mut()
                    .remove_route(&optimized.borrow().connection_name);
                self.hd_route_shi.borrow_mut().add_route(optimized.clone());
                self.optimized_hd_routes.push(optimized);
                self.active_sub_solver = None;
            } else if child.base.failed
                || child
                    .base
                    .error
                    .as_ref()
                    .is_some_and(|error| !error.is_empty())
            {
                self.base.error = child.base.error.clone();
                self.base.failed = true;
            }
            return Ok(());
        }
        let Some(route) = self.unprocessed_routes.pop_front() else {
            self.base.solved = true;
            return Ok(());
        };
        self.active_sub_solver = Some(Rc::new(RefCell::new(
            SingleRouteUselessViaRemovalSolver::new(SingleRouteUselessViaRemovalSolverParams {
                obstacle_shi: self.obstacle_shi.clone(),
                hd_route_shi: self.hd_route_shi.clone(),
                unsimplified_route: route,
                conn_map: self.input.conn_map.clone(),
                outline: self.input.outline.clone(),
                terminal_layers: self.input.terminal_layers.clone(),
                options: self.input.options.clone(),
                math: self.input.math,
            }),
        )));
        Ok(())
    }
}

impl UselessViaRemovalSolver {
    pub fn snapshot(
        &self,
        codec: &mut crate::bindings::trace_simplification::graph_codec::GraphCodec,
    ) -> Value {
        let mut fields = serde_json::to_value(&self.base).unwrap();
        fields["identity"] = json!(self.identity);
        fields["stats"] = codec.raw(self.stats.clone());
        fields["unsimplifiedHdRoutes"] = codec.route_array(
            self.unsimplified_routes_array_identity,
            &self.unsimplified_hd_routes,
        );
        fields["optimizedHdRoutes"] = codec.route_array(
            self.optimized_routes_array_identity,
            &self.optimized_hd_routes,
        );
        fields["unprocessedRoutes"] = codec.route_array(
            self.unprocessed_routes_array_identity,
            &self.unprocessed_routes.iter().cloned().collect::<Vec<_>>(),
        );
        fields["activeSubSolver"] = if let Some(child) = &self.active_sub_solver {
            let child = child.borrow();
            let snapshot = child.snapshot(codec);
            codec.object(child.identity, snapshot)
        } else {
            Value::Null
        };
        fields
    }

    pub fn restore(
        &mut self,
        fields: &Value,
        codec: &mut crate::bindings::trace_simplification::graph_codec::GraphCodec,
    ) -> Result<(), String> {
        let mut base = serde_json::to_value(&self.base).unwrap();
        for key in [
            "MAX_ITERATIONS",
            "solved",
            "failed",
            "iterations",
            "progress",
            "error",
        ] {
            if let Some(value) = fields.get(key) {
                base[key] = value.clone();
            }
        }
        self.base = serde_json::from_value(base).map_err(|error| error.to_string())?;
        if let Some(value) = fields.get("stats") {
            self.stats = codec.read_raw(value);
        }
        if let Some(value) = fields.get("terminalLayerIndicesByPcbPortId") {
            self.input.terminal_layers = if value.is_null() {
                None
            } else {
                Some(codec.read_terminal_layers(value)?)
            };
        }
        if let Some(value) = fields.get("unsimplifiedHdRoutes") {
            self.unsimplified_hd_routes = codec.read_routes(value)?;
            if let Some(id) = value["$array"].as_u64() {
                self.unsimplified_routes_array_identity = id;
            }
        }
        if let Some(value) = fields.get("optimizedHdRoutes") {
            self.optimized_hd_routes = codec.read_routes(value)?;
            if let Some(id) = value["$array"].as_u64() {
                self.optimized_routes_array_identity = id;
            }
        }
        if let Some(value) = fields.get("unprocessedRoutes") {
            self.unprocessed_routes = codec.read_routes(value)?.into_iter().collect();
            if let Some(id) = value["$array"].as_u64() {
                self.unprocessed_routes_array_identity = id;
            }
        }
        if let Some(value) = fields.get("activeSubSolver") {
            if value.is_null() {
                self.active_sub_solver = None;
            } else {
                let child_fields = value.get("fields").unwrap_or(value);
                if self.active_sub_solver.is_none() {
                    let route = codec.read_route(&child_fields["unsimplifiedRoute"])?;
                    self.active_sub_solver = Some(Rc::new(RefCell::new(
                        SingleRouteUselessViaRemovalSolver::new(
                            SingleRouteUselessViaRemovalSolverParams {
                                obstacle_shi: self.obstacle_shi.clone(),
                                hd_route_shi: self.hd_route_shi.clone(),
                                unsimplified_route: route,
                                conn_map: self.input.conn_map.clone(),
                                outline: self.input.outline.clone(),
                                terminal_layers: self.input.terminal_layers.clone(),
                                options: self.input.options.clone(),
                                math: self.input.math,
                            },
                        ),
                    )));
                }
                let mut child = self.active_sub_solver.as_ref().unwrap().borrow_mut();
                if let Some(id) = child_fields["identity"].as_u64() {
                    child.identity = id;
                }
                child.restore(child_fields, codec)?;
            }
        }
        Ok(())
    }

    pub fn invoke(
        &mut self,
        method: &str,
        _args: &Value,
        codec: &mut crate::bindings::trace_simplification::graph_codec::GraphCodec,
    ) -> Result<Value, String> {
        match method {
            "getOptimizedHdRoutes" => Ok(codec.route_array(
                self.optimized_routes_array_identity,
                &self.optimized_hd_routes,
            )),
            _ => Err(format!("Unknown UselessViaRemovalSolver method: {method}")),
        }
    }
}
