use crate::bindings::high_density::specialized_base_solver::BaseSolverState;
use crate::bindings::trace_simplification::types::*;
use serde_json::{Map, Value, json};
use std::rc::Rc;

#[derive(Clone)]
pub struct SingleSimplifiedPathParams {
    pub input_route: RouteRef,
    pub other_hd_routes: Rc<Vec<RouteRef>>,
    pub obstacles: Rc<Vec<ObstacleRef>>,
    pub conn_map: Rc<ConnectivityMap>,
    pub connectivity: Rc<
        std::cell::RefCell<
            crate::bindings::trace_simplification::connectivity_context::ConnectivityContext,
        >,
    >,
    pub color_map: ColorMapRef,
    pub outline: Option<Rc<Vec<Point2>>>,
    pub min_board_edge_clearance: f64,
    pub use_trace_width_aware_clearance: bool,
    pub math: Math,
}

pub struct SingleSimplifiedPathSolver {
    pub base: BaseSolverState,
    pub new_route: Vec<PointRef>,
    pub new_vias: Vec<PointRef>,
    pub new_route_array_identity: u64,
    pub new_vias_array_identity: u64,
    pub head_index: usize,
    pub tail_index: usize,
    pub params: SingleSimplifiedPathParams,
}
impl SingleSimplifiedPathSolver {
    pub fn new(params: SingleSimplifiedPathParams) -> Self {
        let new_route = params
            .input_route
            .borrow()
            .route
            .first()
            .cloned()
            .into_iter()
            .collect();
        Self {
            base: BaseSolverState::default(),
            new_route,
            new_vias: Vec::new(),
            new_route_array_identity: next_identity(),
            new_vias_array_identity: next_identity(),
            head_index: 0,
            tail_index: 0,
            params,
        }
    }
    pub fn get_solver_name(&self) -> &'static str {
        "SingleSimplifiedPathSolver"
    }
    pub fn is_valid_path(&self, _points: &[PointRef]) -> Result<bool, String> {
        Err("Not implemented".into())
    }
    pub fn _step(&mut self) -> Result<(), String> {
        Err("Not implemented".into())
    }
    pub fn simplified_route(&self) -> RouteRef {
        let route = self.params.input_route.borrow();
        let mut meta = Map::new();
        meta.insert("connectionName".into(), json!(route.connection_name));
        for key in ["rootConnectionName", "startPcbPortId", "endPcbPortId"] {
            if let Some(value) = route.metadata.get(key) {
                meta.insert(key.into(), value.clone());
            }
        }
        meta.insert("traceThickness".into(), json!(route.trace_thickness));
        meta.insert("viaDiameter".into(), json!(route.via_diameter));
        meta.insert("route".into(), json!([]));
        meta.insert("vias".into(), json!([]));
        if let Some(jumpers) = route.jumpers_value() {
            meta.insert("jumpers".into(), jumpers);
        }
        let output = fresh_route(
            Value::Object(meta),
            self.new_route.clone(),
            self.new_vias.clone(),
        );
        {
            let mut result = output.borrow_mut();
            result.route_array_identity = self.new_route_array_identity;
            result.vias_array_identity = self.new_vias_array_identity;
            result.source_metadata_identity = Some(route.identity);
            result.jumpers = route.jumpers.clone();
            result.jumpers_identity = route.jumpers_identity;
        }
        output
    }
}
