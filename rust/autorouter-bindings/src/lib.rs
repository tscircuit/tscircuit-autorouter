
#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
#[global_allocator]
static ALLOCATOR: module_allocator::ModuleAllocator = module_allocator::ModuleAllocator::new();



mod object_hash;
mod ported;
mod bindings;

use std::{cell::RefCell, rc::Rc};
use high_density_a01::high_density_solver_a01::HighDensitySolverA01;
use high_density_a01::high_density_solver_a03::HighDensitySolverA03;
use serde::Serialize;
use serde_json::{json, Value};
use wasm_bindgen::prelude::*;

enum Engine {
    A01(HighDensitySolverA01),
    A03(HighDensitySolverA03),
}

#[wasm_bindgen]
pub struct AutoroutingDrcEngine {
    engine: autorouting_drc::autorouting_drc_engine::AutoroutingDrcEngine,
}

#[wasm_bindgen]
impl AutoroutingDrcEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(srj: JsValue, conn_map: JsValue, options: JsValue) -> Result<Self, JsValue> {
        let srj: Value = serde_wasm_bindgen::from_value(srj)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let conn_map = if conn_map.is_null() || conn_map.is_undefined() { None } else {
            Some(serde_wasm_bindgen::from_value(conn_map)
                .map_err(|error| JsValue::from_str(&error.to_string()))?)
        };
        let options: Value = serde_wasm_bindgen::from_value(options)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let math = autorouting_drc::autorouting_drc_engine::DrcMath {
            hypot: js_sys::Math::hypot,
            sin: js_sys::Math::sin,
            cos: js_sys::Math::cos,
        };
        let engine = autorouting_drc::autorouting_drc_engine::AutoroutingDrcEngine::new_with_math(srj, conn_map, options, math)
            .map_err(|error| JsValue::from_str(&error))?;
        Ok(Self { engine })
    }

    #[wasm_bindgen(js_name = forkForRepair)]
    pub fn fork_for_repair(&self) -> AutoroutingDrcEngine {
        AutoroutingDrcEngine { engine: self.engine.fork_compiled() }
    }

    pub fn evaluate(&mut self, traces: JsValue, include_via_pad_errors: bool) -> Result<JsValue, JsValue> {
        let traces: Value = serde_wasm_bindgen::from_value(traces)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let result = if include_via_pad_errors { self.engine.evaluate(&traces) }
            else { self.engine.evaluate_legacy(&traces) };
        to_js(&result)
    }

    #[wasm_bindgen(js_name = evaluateJson)]
    pub fn evaluate_json(&mut self, traces: &str, include_via_pad_errors: bool) -> Result<JsValue, JsValue> {
        let traces: Value = serde_json::from_str(traces)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let result = if include_via_pad_errors { self.engine.evaluate(&traces) }
            else { self.engine.evaluate_legacy(&traces) };
        to_js(&result)
    }

    pub fn stats(&self) -> Result<JsValue, JsValue> {
        self.engine.last_run_stats.serialize(&serde_wasm_bindgen::Serializer::json_compatible())
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    #[wasm_bindgen(js_name = setConnectivity)]
    pub fn set_connectivity(&mut self, conn_map: JsValue) -> Result<(), JsValue> {
        self.engine.conn_map = if conn_map.is_null() || conn_map.is_undefined() { None } else {
            Some(serde_wasm_bindgen::from_value(conn_map)
                .map_err(|error| JsValue::from_str(&error.to_string()))?)
        };
        Ok(())
    }
}

fn to_js(value: &Value) -> Result<JsValue, JsValue> {
    value.serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

#[wasm_bindgen]
pub struct HighDensityCandidateSolver {
    engine: Rc<RefCell<Engine>>,
}

#[wasm_bindgen]
impl HighDensityCandidateSolver {
    #[wasm_bindgen(constructor)]
    pub fn new(variant: &str, props: JsValue, initial_penalty_fn: Option<js_sys::Function>) -> Result<Self, JsValue> {
        let props: Value = serde_wasm_bindgen::from_value(props)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let penalty = initial_penalty_fn.map(|callback| {
            Box::new(move |input: &Value| -> f64 {
                let input = to_js(input).unwrap_or_else(|error| wasm_bindgen::throw_val(error));
                let result = callback.call1(&JsValue::UNDEFINED, &input)
                    .unwrap_or_else(|error| wasm_bindgen::throw_val(error));
                result.as_f64().unwrap_or_else(|| wasm_bindgen::throw_str("initialPenaltyFn must return a number"))
            }) as Box<dyn Fn(&Value) -> f64>
        });
        let engine = match variant {
            "a01" => {
                let mut engine = HighDensitySolverA01::new(props);
                engine.initial_penalty_fn = penalty;
                Engine::A01(engine)
            }
            "a03" => {
                let mut engine = HighDensitySolverA03::new(props);
                engine.hypot = Some(js_sys::Math::hypot);
                engine.initial_penalty_fn = penalty;
                Engine::A03(engine)
            }
            _ => return Err(JsValue::from_str("Expected high-density engine a01 or a03")),
        };
        Ok(Self { engine: Rc::new(RefCell::new(engine)) })
    }

    pub fn setup(&mut self, max_iterations: usize) -> Result<JsValue, JsValue> {
        match &mut *self.engine.borrow_mut() {
            Engine::A01(engine) => {
                engine.max_iterations = max_iterations;
                engine.setup();
                to_js(&json!({ "maxIterations": engine.max_iterations, "solved": engine.solved, "failed": engine.failed, "error": engine.error }))
            }
            Engine::A03(engine) => {
                engine.max_iterations = max_iterations;
                engine.setup();
                to_js(&json!({ "maxIterations": engine.max_iterations, "solved": engine.solved, "failed": engine.failed, "error": engine.error }))
            }
        }
    }

    // The TS BaseSolver owns the outer iteration lifecycle. Return the segment
    // count and two status bits together to avoid serializing state each step.
    #[wasm_bindgen(js_name = shareForPortfolio)]
    pub fn share_for_portfolio(&self) -> u32 {
        bindings::portfolio_single_intra_node_solver::share_high_density(self.engine.clone())
    }

    pub fn step(&mut self, iterations: usize, max_iterations: usize) -> f64 {
        match &mut *self.engine.borrow_mut() {
            Engine::A01(engine) => {
                engine.iterations = iterations;
                engine.max_iterations = max_iterations;
                engine.step();
                (engine.solved_segment_count() as f64) * 4.0 + u8::from(engine.solved) as f64 + 2.0 * u8::from(engine.failed) as f64
            }
            Engine::A03(engine) => {
                engine.iterations = iterations;
                engine.max_iterations = max_iterations;
                engine.step();
                (engine.solved_segment_count() as f64) * 4.0 + u8::from(engine.solved) as f64 + 2.0 * u8::from(engine.failed) as f64
            }
        }
    }

    pub fn error(&self) -> Option<String> {
        match &*self.engine.borrow() {
            Engine::A01(engine) => engine.error.clone(),
            Engine::A03(engine) => engine.error.clone(),
        }
    }

    #[wasm_bindgen(js_name = getOutput)]
    pub fn get_output(&self) -> Result<JsValue, JsValue> {
        match &*self.engine.borrow() {
            Engine::A01(engine) => to_js(&engine.get_output()),
            Engine::A03(engine) => to_js(&engine.get_output()),
        }
    }

    pub fn visualize(&self) -> Result<JsValue, JsValue> {
        match &*self.engine.borrow() {
            Engine::A01(engine) => to_js(&engine.visualize()),
            Engine::A03(engine) => to_js(&engine.visualize()),
        }
    }
}

pub(crate) struct GeneralState {
    pending: Option<(Rc<Value>, Value)>,
    engine: Option<intra_node_routing::intra_node_solver::IntraNodeRouteSolver>,
    cached_routes: Option<Vec<intra_node_routing::types::Route>>,
    cached_status: Option<(bool, bool, Option<String>)>,
    output_revision: usize,
    diagnostic_revision: usize,
}

impl GeneralState {
    fn initialized(engine: intra_node_routing::intra_node_solver::IntraNodeRouteSolver) -> Self {
        Self { pending: None, engine: Some(engine), cached_routes: None, cached_status: None, output_revision: 0, diagnostic_revision: 0 }
    }

    pub(crate) fn ensure_initialized(&mut self) -> &mut intra_node_routing::intra_node_solver::IntraNodeRouteSolver {
        if self.engine.is_none() {
            let (props, hyper_parameters) = self.pending.take().expect("Uninitialized General router requires pending props");
            let mut props = props.as_ref().clone();
            props["hyperParameters"] = hyper_parameters;
            let mut engine = intra_node_routing::intra_node_solver::IntraNodeRouteSolver::new(props);
            engine.pow = js_sys::Math::pow;
            engine.exp = js_sys::Math::exp;
            if let Some(routes) = self.cached_routes.take() { engine.solved_routes = routes; }
            if let Some((solved, failed, error)) = self.cached_status.take() {
                engine.solved = solved; engine.failed = failed; engine.error = error;
            }
            self.engine = Some(engine);
        }
        self.engine.as_mut().unwrap()
    }

    pub(crate) fn step_inner(&mut self, iterations: usize) {
        let previous_count = self.routes().len();
        let engine = self.ensure_initialized();
        engine.iterations = iterations;
        engine.step_inner();
        if engine.solved_routes.len() != previous_count { self.output_revision += 1; }
        self.diagnostic_revision += 1;
    }

    pub(crate) fn set_cached_output(&mut self, routes: Vec<intra_node_routing::types::Route>, solved: bool, failed: bool, error: Option<String>) {
        if let Some(engine) = &mut self.engine {
            engine.solved_routes = routes; engine.solved = solved; engine.failed = failed; engine.error = error;
        } else {
            self.cached_routes = Some(routes);
            self.cached_status = Some((solved, failed, error));
        }
    }

    pub(crate) fn routes(&self) -> &[intra_node_routing::types::Route] {
        if let Some(engine) = &self.engine { &engine.solved_routes }
        else { self.cached_routes.as_deref().unwrap_or(&[]) }
    }

    fn error(&self) -> Option<String> {
        if let Some(engine) = &self.engine { engine.error.clone() }
        else { self.cached_status.as_ref().and_then(|(_, _, error)| error.clone()) }
    }
}

#[wasm_bindgen]
pub struct IntraNodeRouteSolver {
    engine: Rc<RefCell<GeneralState>>,
}

#[wasm_bindgen]
pub struct IntraNodeRouteContext {
    props: Rc<Value>,
}

#[wasm_bindgen]
impl IntraNodeRouteContext {
    #[wasm_bindgen(constructor)]
    pub fn new(props: JsValue) -> Result<Self, JsValue> {
        let props: Value = serde_wasm_bindgen::from_value(props)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        if !props.is_object() {
            return Err(JsValue::from_str("General router context must be an object"));
        }
        Ok(Self { props: Rc::new(props) })
    }

    pub fn create(&self, hyper_parameters: JsValue) -> Result<IntraNodeRouteSolver, JsValue> {
        let mut props = self.props.as_ref().clone();
        props["hyperParameters"] = serde_wasm_bindgen::from_value(hyper_parameters)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let mut engine = intra_node_routing::intra_node_solver::IntraNodeRouteSolver::new(props);
        engine.pow = js_sys::Math::pow;
        engine.exp = js_sys::Math::exp;
        Ok(IntraNodeRouteSolver { engine: Rc::new(RefCell::new(GeneralState::initialized(engine))) })
    }

    #[wasm_bindgen(js_name = createLazy)]
    pub fn create_lazy(&self, hyper_parameters: JsValue) -> Result<IntraNodeRouteSolver, JsValue> {
        let hyper_parameters = serde_wasm_bindgen::from_value(hyper_parameters)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        Ok(IntraNodeRouteSolver { engine: Rc::new(RefCell::new(GeneralState {
            pending: Some((self.props.clone(), hyper_parameters)), engine: None,
            cached_routes: None, cached_status: None, output_revision: 0, diagnostic_revision: 0,
        })) })
    }

}

#[wasm_bindgen]
impl IntraNodeRouteSolver {
    #[wasm_bindgen(constructor)]
    pub fn new(props: JsValue) -> Result<Self, JsValue> {
        let props: Value = serde_wasm_bindgen::from_value(props)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let mut engine = intra_node_routing::intra_node_solver::IntraNodeRouteSolver::new(props);
        engine.pow = js_sys::Math::pow;
        engine.exp = js_sys::Math::exp;
        Ok(Self { engine: Rc::new(RefCell::new(GeneralState::initialized(engine))) })
    }

    #[wasm_bindgen(js_name = shareForPortfolio)]
    pub fn share_for_portfolio(&self) -> u32 {
        bindings::portfolio_single_intra_node_solver::share_general(self.engine.clone())
    }

    pub fn step(&mut self, iterations: usize) -> f64 {
        let mut state = self.engine.borrow_mut();
        state.step_inner(iterations);
        let engine = state.ensure_initialized();
        engine.solved_routes.len() as f64 * 4.0
            + u8::from(engine.solved) as f64 + 2.0 * u8::from(engine.failed) as f64
    }

    #[wasm_bindgen(js_name = computeProgress)]
    pub fn compute_progress(&self) -> f64 {
        self.engine.borrow_mut().ensure_initialized().compute_progress()
    }

    #[wasm_bindgen(js_name = getDiagnosticRevision)]
    pub fn get_diagnostic_revision(&self) -> usize { self.engine.borrow().diagnostic_revision }

    #[wasm_bindgen(js_name = getDiagnostics)]
    pub fn get_diagnostics(&self) -> Result<JsValue, JsValue> {
        let state = self.engine.borrow();
        let Some(engine) = &state.engine else { return Ok(JsValue::NULL); };
        to_js(&serde_json::json!({"unsolvedConnections":engine.unsolved_connections,
            "rerouteAttemptsByConnection":engine.reroute_attempts_by_connection.iter().collect::<Vec<_>>(),
            "activeChildId":engine.active_sub_solver.as_ref().map(|child|child.diagnostic_id),
            "failedChildIds":engine.failed_sub_solvers.iter().map(|child|child.diagnostic_id).collect::<Vec<_>>()}))
    }

    #[wasm_bindgen(js_name = getChild)]
    pub fn get_child(&self, id: usize) -> bindings::single_high_density_route_solver::SingleHighDensityRouteSolver {
        bindings::single_high_density_route_solver::SingleHighDensityRouteSolver::child(self.engine.clone(), id)
    }

    #[wasm_bindgen(js_name = getOutputRevision)]
    pub fn get_output_revision(&self) -> usize {
        self.engine.borrow().output_revision
    }

    #[wasm_bindgen(js_name = getRouteCount)]
    pub fn get_route_count(&self) -> usize {
        self.engine.borrow().routes().len()
    }

    pub fn error(&self) -> Option<String> {
        self.engine.borrow().error()
    }

    #[wasm_bindgen(js_name = getOutput)]
    pub fn get_output(&self) -> Result<JsValue, JsValue> {
        to_js(&serde_json::to_value(&self.engine.borrow().routes()).map_err(|error| JsValue::from_str(&error.to_string()))?)
    }

    pub fn visualize(&self, transparentize: js_sys::Function) -> Result<JsValue, JsValue> {
        to_js(&self.engine.borrow_mut().ensure_initialized().visualize_with_transparentize(&|color, amount| {
            transparentize.call2(&JsValue::UNDEFINED, &JsValue::from_str(color), &JsValue::from_f64(amount))
                .unwrap_or_else(|error| wasm_bindgen::throw_val(error))
                .as_string().unwrap_or_else(|| wasm_bindgen::throw_str("Expected transparency color string"))
        }))
    }
}

#[wasm_bindgen]
pub struct BroadRepulsionEngine {
    engine: repair::solver_helpers::BroadRepulsionEngine,
}

#[wasm_bindgen]
impl BroadRepulsionEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(srj_json: &str, connectivity_json: &str) -> Result<Self, JsValue> {
        let srj: Value = serde_json::from_str(srj_json)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let connectivity: Option<Value> = serde_json::from_str(connectivity_json)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let math = repair::solver_helpers::RepairMath {
            hypot: js_sys::Math::hypot,
            sin: js_sys::Math::sin,
            cos: js_sys::Math::cos,
            round: js_sys::Math::round,
        };
        Ok(Self { engine: repair::solver_helpers::BroadRepulsionEngine::new(srj, connectivity, math) })
    }

    #[wasm_bindgen(js_name = setConnectivity)]
    pub fn set_connectivity(&mut self, connectivity_json: &str) -> Result<(), JsValue> {
        let connectivity: Option<Value> = serde_json::from_str(connectivity_json)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        self.engine.set_connectivity(connectivity);
        Ok(())
    }

    pub fn run(&self, routes_json: &str, effort: f64, pass_multiplier: f64,
        allow_same_net_via_pairs: bool, run_final_cleanup: bool) -> Result<String, JsValue> {
        let routes: Value = serde_json::from_str(routes_json)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let result = self.engine.run(routes, effort, pass_multiplier, allow_same_net_via_pairs, run_final_cleanup);
        serde_json::to_string(&result).map_err(|error| JsValue::from_str(&error.to_string()))
    }
}

#[wasm_bindgen]
pub struct TargetedRepairEngine {
    engine: repair::solver_helpers::BroadRepulsionEngine,
    pad_context: repair::find_pad_clearance_via_position::PadClearanceContext,
    connectivity: Option<repair::net_utils::RepairConnectivityMap>,
}

fn repair_math() -> repair::solver_helpers::RepairMath {
    repair::solver_helpers::RepairMath {
        hypot: js_sys::Math::hypot,
        sin: js_sys::Math::sin,
        cos: js_sys::Math::cos,
        round: js_sys::Math::round,
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepairViaInput {
    route_index: usize,
    root_connection_name: String,
    point_indexes: Vec<usize>,
    z_layers: Vec<f64>,
    x: f64,
    y: f64,
    radius: f64,
    movable: bool,
    can_canonicalize: bool,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepairSegmentInput {
    root_connection_name: String,
    start: repair::internal_types::Point,
    end: repair::internal_types::Point,
    z: f64,
    radius: f64,
}

#[wasm_bindgen]
impl TargetedRepairEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(srj_json: &str, connectivity_json: &str) -> Result<Self, JsValue> {
        let srj: Value = serde_json::from_str(srj_json)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let connectivity_value: Option<Value> = serde_json::from_str(connectivity_json)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let connectivity: Option<repair::net_utils::RepairConnectivityMap> = serde_json::from_str(connectivity_json)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let pad_context = repair::find_pad_clearance_via_position::PadClearanceContext::new(&srj, &repair_math(), connectivity.as_ref());
        let engine = repair::solver_helpers::BroadRepulsionEngine::new(srj, connectivity_value, repair_math());
        Ok(Self { engine, pad_context, connectivity })
    }

    #[wasm_bindgen(js_name = setConnectivity)]
    pub fn set_connectivity(&mut self, connectivity_json: &str) -> Result<(), JsValue> {
        let connectivity_value: Option<Value> = serde_json::from_str(connectivity_json)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        self.connectivity = serde_json::from_str(connectivity_json)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        self.pad_context.set_connectivity(self.connectivity.as_ref());
        self.engine.set_connectivity(connectivity_value);
        Ok(())
    }

    #[wasm_bindgen(js_name = applyForces)]
    pub fn apply_forces(&self, routes_json: &str, errors_json: &str, trace_map_json: &str,
        scale: f64, canonical_pairs: bool, same_net: bool, shared_site: bool, owner_target: bool) -> Result<String, JsValue> {
        let routes = serde_json::from_str(routes_json).map_err(|error| JsValue::from_str(&error.to_string()))?;
        let errors = serde_json::from_str(errors_json).map_err(|error| JsValue::from_str(&error.to_string()))?;
        let trace_map = serde_json::from_str(trace_map_json).map_err(|error| JsValue::from_str(&error.to_string()))?;
        let result = self.engine.apply_error_forces(routes, errors, trace_map, scale, canonical_pairs, same_net, shared_site, owner_target);
        serde_json::to_string(&result).map_err(|error| JsValue::from_str(&error.to_string()))
    }

    pub fn pad(&self, route_json: &str, preferred_json: &str, radius: f64, z_layers_json: &str) -> Result<String, JsValue> {
        let route: Value = serde_json::from_str(route_json).map_err(|error| JsValue::from_str(&error.to_string()))?;
        let preferred = serde_json::from_str(preferred_json).map_err(|error| JsValue::from_str(&error.to_string()))?;
        let z_layers: Vec<f64> = serde_json::from_str(z_layers_json).map_err(|error| JsValue::from_str(&error.to_string()))?;
        let route = repair::internal_types::MutableRoute::from_value(&route);
        let result = self.pad_context.find_with_identity(
            &route, preferred, radius, &z_layers, self.connectivity.as_ref(), &repair_math());
        serde_json::to_string(&json!({"point":result.point,"isPreferred":result.is_preferred})).map_err(|error| JsValue::from_str(&error.to_string()))
    }

    pub fn trace(via_json: &str, segments_json: &str, clearance: f64, connectivity_json: &str) -> Result<String, JsValue> {
        use repair::internal_types::{ViaNode, Segment, RoutePoint};
        use std::{cell::RefCell, rc::Rc};
        let via: RepairViaInput = serde_json::from_str(via_json).map_err(|error| JsValue::from_str(&error.to_string()))?;
        let inputs: Vec<RepairSegmentInput> = serde_json::from_str(segments_json).map_err(|error| JsValue::from_str(&error.to_string()))?;
        let connectivity: Option<repair::net_utils::RepairConnectivityMap> = serde_json::from_str(connectivity_json)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let via = ViaNode { route_index: via.route_index, root_connection_name: via.root_connection_name,
            point_indexes: via.point_indexes, z_layers: via.z_layers, x: via.x, y: via.y,
            radius: via.radius, movable: via.movable, can_canonicalize: via.can_canonicalize };
        let segments: Vec<Segment> = inputs.into_iter().map(|input| Segment {
            route_index: 0, root_connection_name: input.root_connection_name,
            start_index: 0, end_index: 1,
            start: Rc::new(RefCell::new(RoutePoint {
                metadata_identity: repair::internal_types::next_identity(),
                x: input.start.x,
                y: input.start.y,
                z: input.z, metadata: Rc::new(Value::Null),
            })),
            end: Rc::new(RefCell::new(RoutePoint {
                metadata_identity: repair::internal_types::next_identity(),
                x: input.end.x,
                y: input.end.y,
                z: input.z, metadata: Rc::new(Value::Null),
            })), z: input.z, radius: input.radius,
        }).collect();
        let result = repair::find_trace_clearance_via_positions::find_trace_clearance_via_positions_with_identity(
            &via, &segments, clearance, connectivity.as_ref(), &repair_math());
        serde_json::to_string(&json!({"points":result.points,"viaIdentityIndices":result.via_identity_indices})).map_err(|error| JsValue::from_str(&error.to_string()))
    }
}

#[wasm_bindgen]
pub struct GlobalDrcBranchPortfolioSolver {
    pending_reference_error: std::rc::Rc<std::cell::RefCell<Option<JsValue>>>,
    solver: repair::global_drc_branch_portfolio_solver::GlobalDrcBranchPortfolioSolver,
    evaluator: std::rc::Rc<std::cell::RefCell<repair::pipeline9_drc_evaluator::Pipeline9DrcEvaluator>>,
}

#[wasm_bindgen]
impl GlobalDrcBranchPortfolioSolver {
    #[wasm_bindgen(constructor)]
    pub fn new(params_json: &str, descriptor_json: &str, reference: js_sys::Function, prepared_engine: Option<AutoroutingDrcEngine>) -> Result<Self, JsValue> {
        use std::{cell::RefCell, rc::Rc};
        let mut params: Value = serde_json::from_str(params_json).map_err(|error| JsValue::from_str(&error.to_string()))?;
        let mut descriptor: Value = serde_json::from_str(descriptor_json).map_err(|error| JsValue::from_str(&error.to_string()))?;
        let route_values = params["hdRoutes"].take().as_array().ok_or_else(|| JsValue::from_str("Repair portfolio routes required"))?.clone();
        let routes = repair::types::Routes::new(route_values.into_iter().map(repair::internal_types::MutableRoute::from_owned_value).collect());
        let conn_map = descriptor.get("connMap").filter(|v| !v.is_null()).cloned();
        let engine = Rc::new(repair::solver_helpers::BroadRepulsionEngine::new(params["srj"].clone(), conn_map, repair_math()));
        let prepared = prepared_engine.map(|engine| (engine.engine, descriptor["preparedBaseline"].take()));
        let mut evaluator = repair::pipeline9_drc_evaluator::Pipeline9DrcEvaluator::new_with_prepared(descriptor,
            autorouting_drc::autorouting_drc_engine::DrcMath { hypot: js_sys::Math::hypot, sin: js_sys::Math::sin, cos: js_sys::Math::cos }, prepared)
            .map_err(|error| JsValue::from_str(&error))?;
        let pending_reference_error = Rc::new(RefCell::new(None));
        let callback_error = pending_reference_error.clone();
        evaluator.set_reference_callback(Box::new(move |routes| {
            let json = serde_json::to_string(routes).map_err(|error| error.to_string())?;
            let result = reference.call1(&JsValue::UNDEFINED, &JsValue::from_str(&json))
                .map_err(|error| {
                    *callback_error.borrow_mut() = Some(error);
                    "Reference DRC callback failed".to_owned()
                })?;
            let result = result.as_string().ok_or_else(|| "Reference DRC must return JSON".to_owned())?;
            serde_json::from_str(&result).map_err(|error| format!("Invalid reference DRC result: {error}"))
        }));
        evaluator.set_clock(js_sys::Date::now);
        let evaluator = Rc::new(RefCell::new(evaluator));
        let shared: repair::types::Evaluator = evaluator.clone();
        params["hasCustomDrcEvaluator"] = Value::Bool(true);
        let solver = repair::global_drc_branch_portfolio_solver::GlobalDrcBranchPortfolioSolver::new(params, routes, engine, shared.clone(), None, Some(shared))
            .map_err(|error| pending_reference_error.borrow_mut().take().unwrap_or_else(|| JsValue::from_str(&error)))?;
        Ok(Self { solver, evaluator, pending_reference_error })
    }

    pub fn step(&mut self) -> Result<String, JsValue> {
        let result = self.solver.step();
        result.map_err(|error| self.pending_reference_error.borrow_mut().take().unwrap_or_else(|| JsValue::from_str(&error)))?;
        self.state()
    }

    pub fn state(&self) -> Result<String, JsValue> {
        let evaluator = self.evaluator.borrow();
        let mut stats = self.solver.stats.clone();
        stats["indexedDrcEvaluationCount"] = json!(evaluator.indexed_drc_evaluation_count);
        stats["indexedDrcCacheHitCount"] = json!(evaluator.indexed_drc_cache_hit_count);
        stats["indexedDrcEvaluationTimeMs"] = json!(evaluator.indexed_drc_evaluation_time_ms);
        stats["indexedDrcCandidateCacheSize"] = json!(evaluator.cache_len());
        serde_json::to_string(&json!({
            "solved":self.solver.solved,"failed":self.solver.failed,"error":self.solver.error,
            "iterations":self.solver.iterations,"maxIterations":100000,"progress":self.solver.progress,"stats":stats,
        })).map_err(|error| JsValue::from_str(&error.to_string()))
    }

    #[wasm_bindgen(js_name = getOutput)]
    pub fn get_output(&self) -> Result<String, JsValue> {
        let routes: Vec<_> = self.solver.get_output().iter().map(repair::internal_types::MutableRoute::to_value).collect();
        serde_json::to_string(&routes).map_err(|error| JsValue::from_str(&error.to_string()))
    }

    #[wasm_bindgen(js_name = debugState)]
    pub fn debug_state(&self) -> Result<String, JsValue> {
        serde_json::to_string(&self.solver.debug_state()).map_err(|error| JsValue::from_str(&error.to_string()))
    }

    #[wasm_bindgen(js_name = evaluateRoutes)]
    pub fn evaluate_routes(&self, routes_json: &str) -> Result<String, JsValue> {
        let routes: Vec<Value> = serde_json::from_str(routes_json).map_err(|error| JsValue::from_str(&error.to_string()))?;
        let result = self.evaluator.borrow_mut().evaluate_values(&routes);
        let result = result.map_err(|error| self.pending_reference_error.borrow_mut().take().unwrap_or_else(|| JsValue::from_str(&error)))?;
        serde_json::to_string(&result).map_err(|error| JsValue::from_str(&error.to_string()))
    }
}

#[wasm_bindgen]
impl GlobalDrcBranchPortfolioSolver {
    pub fn relax(srj_json: &str, routes_json: &str, connectivity_json: &str, kind: &str) -> Result<String, JsValue> {
        let srj: Value = serde_json::from_str(srj_json).map_err(|error| JsValue::from_str(&error.to_string()))?;
        let values: Vec<Value> = serde_json::from_str(routes_json).map_err(|error| JsValue::from_str(&error.to_string()))?;
        let routes = repair::types::Routes::new(values.into_iter().map(repair::internal_types::MutableRoute::from_owned_value).collect());
        let conn: Option<repair::net_utils::RepairConnectivityMap> = serde_json::from_str(connectivity_json).map_err(|error| JsValue::from_str(&error.to_string()))?;
        let result = match kind {
            "trace" => repair::trace_to_pad_clearance_relaxation::apply_trace_to_pad_clearance_relaxation(&srj, &routes, conn.as_ref(), repair_math()),
            "via" => repair::via_to_pad_clearance_relaxation::apply_via_to_pad_clearance_relaxation(&srj, &routes, conn.as_ref(), repair_math()),
            _ => return Err(JsValue::from_str("Unknown clearance relaxation kind")),
        };
        let output: Vec<_> = result.iter().map(repair::internal_types::MutableRoute::to_value).collect();
        serde_json::to_string(&json!({"changed":!repair::types::Routes::ptr_eq(&routes,&result),"routes":output})).map_err(|error| JsValue::from_str(&error.to_string()))
    }
}

pub use bindings::global_drc_force_improve_solver::GlobalDrcForceImproveSolver;


pub use bindings::trace_simplification_dispatcher::TraceSimplificationDispatcher;
