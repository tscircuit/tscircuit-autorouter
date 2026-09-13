#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
#[global_allocator]
static ALLOCATOR: module_allocator::ModuleAllocator = module_allocator::ModuleAllocator::new();

mod bindings;

use bindings::repair_wire::*;
use high_density_a01::high_density_solver_a01::HighDensitySolverA01;
use high_density_a01::high_density_solver_a03::HighDensitySolverA03;
use serde_json::{Value, json};
use std::{cell::RefCell, rc::Rc};
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;

#[expect(
    clippy::large_enum_variant,
    reason = "Keep solver storage inline without introducing another allocation."
)]
enum Engine {
    A01(HighDensitySolverA01),
    A03(HighDensitySolverA03),
}

#[wasm_bindgen]
pub struct AutoroutingDrcEngine {
    engine: high_density_repair03::drc::autorouting_drc_engine::AutoroutingDrcEngine,
}

#[wasm_bindgen]
impl AutoroutingDrcEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(
        srj: Ts<DrcSrj>,
        conn_map: Ts<RepairConnectivity>,
        options: Ts<DrcOptions>,
    ) -> Result<Self, JsValue> {
        let srj = srj
            .to_rust()
            .map(|value| value.0)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let conn_map = conn_map
            .to_rust()
            .map_err(|error| JsValue::from_str(&error.to_string()))?
            .0;
        let options = options
            .to_rust()
            .map(|value| value.0)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let math = high_density_repair03::drc::autorouting_drc_engine::DrcMath {
            hypot: js_sys::Math::hypot,
            sin: js_sys::Math::sin,
            cos: js_sys::Math::cos,
        };
        let engine = high_density_repair03::drc::autorouting_drc_engine::AutoroutingDrcEngine::new_with_math(srj, conn_map, options, math)
            .map_err(|error| JsValue::from_str(&error))?;
        Ok(Self { engine })
    }

    #[wasm_bindgen(js_name = forkForRepair)]
    pub fn fork_for_repair(&self) -> AutoroutingDrcEngine {
        AutoroutingDrcEngine {
            engine: self.engine.fork_compiled(),
        }
    }

    pub fn evaluate(
        &mut self,
        traces: Ts<DrcTraces>,
        include_via_pad_errors: bool,
    ) -> Result<Ts<DrcResult>, JsValue> {
        let traces = traces
            .to_rust()
            .map(|value| value.0)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let result = if include_via_pad_errors {
            self.engine.evaluate(&traces)
        } else {
            self.engine.evaluate_legacy(&traces)
        };
        DrcResult(result)
            .into_ts()
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    pub fn stats(
        &self,
    ) -> Result<
        Ts<high_density_repair03::drc::autorouting_drc_engine::AutoroutingDrcEngineRunStats>,
        JsValue,
    > {
        self.engine
            .last_run_stats
            .into_ts()
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    #[wasm_bindgen(js_name = setConnectivity)]
    pub fn set_connectivity(&mut self, conn_map: Ts<RepairConnectivity>) -> Result<(), JsValue> {
        self.engine.conn_map = conn_map
            .to_rust()
            .map_err(|error| JsValue::from_str(&error.to_string()))?
            .0
            .map(serde_json::from_value)
            .transpose()
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        Ok(())
    }
}

fn to_js(value: &Value) -> Result<JsValue, JsValue> {
    Ok(RepairCallbackValue(value)
        .into_ts()
        .map_err(|error| JsValue::from_str(&error.to_string()))?
        .into())
}

#[wasm_bindgen]
pub struct HighDensityCandidateSolver {
    engine: Rc<RefCell<Engine>>,
}

#[wasm_bindgen]
impl HighDensityCandidateSolver {
    #[wasm_bindgen(constructor)]
    pub fn new(
        variant: &str,
        props: Ts<CandidateProps>,
        initial_penalty_fn: Option<js_sys::Function>,
    ) -> Result<Self, JsValue> {
        let props = props
            .to_rust()
            .map(|value| value.0)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let penalty = initial_penalty_fn.map(|callback| {
            Box::new(move |input: &Value| -> f64 {
                let input = to_js(input).unwrap_or_else(|error| wasm_bindgen::throw_val(error));
                let result = callback
                    .call1(&JsValue::UNDEFINED, &input)
                    .unwrap_or_else(|error| wasm_bindgen::throw_val(error));
                result.as_f64().unwrap_or_else(|| {
                    wasm_bindgen::throw_str("initialPenaltyFn must return a number")
                })
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
        Ok(Self {
            engine: Rc::new(RefCell::new(engine)),
        })
    }

    pub fn setup(&mut self, max_iterations: usize) -> Result<Ts<CandidateSetup>, JsValue> {
        match &mut *self.engine.borrow_mut() {
            Engine::A01(engine) => {
                engine.max_iterations = max_iterations;
                engine.setup();
                CandidateSetup {
                    max_iterations: engine.max_iterations,
                    solved: engine.solved,
                    failed: engine.failed,
                    error: engine.error.clone(),
                }
                .into_ts()
                .map_err(|error| JsValue::from_str(&error.to_string()))
            }
            Engine::A03(engine) => {
                engine.max_iterations = max_iterations;
                engine.setup();
                CandidateSetup {
                    max_iterations: engine.max_iterations,
                    solved: engine.solved,
                    failed: engine.failed,
                    error: engine.error.clone(),
                }
                .into_ts()
                .map_err(|error| JsValue::from_str(&error.to_string()))
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
                (engine.solved_segment_count() as f64) * 4.0
                    + u8::from(engine.solved) as f64
                    + 2.0 * u8::from(engine.failed) as f64
            }
            Engine::A03(engine) => {
                engine.iterations = iterations;
                engine.max_iterations = max_iterations;
                engine.step();
                (engine.solved_segment_count() as f64) * 4.0
                    + u8::from(engine.solved) as f64
                    + 2.0 * u8::from(engine.failed) as f64
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
    pub fn get_output(&self) -> Result<Ts<IntraNodeRoutes>, JsValue> {
        match &*self.engine.borrow() {
            Engine::A01(engine) => IntraNodeRoutes(engine.get_output())
                .into_ts()
                .map_err(|error| JsValue::from_str(&error.to_string())),
            Engine::A03(engine) => IntraNodeRoutes(engine.get_output())
                .into_ts()
                .map_err(|error| JsValue::from_str(&error.to_string())),
        }
    }

    pub fn visualize(&self) -> Result<Ts<SolverGraphics>, JsValue> {
        match &*self.engine.borrow() {
            Engine::A01(engine) => SolverGraphics(engine.visualize())
                .into_ts()
                .map_err(|error| JsValue::from_str(&error.to_string())),
            Engine::A03(engine) => SolverGraphics(engine.visualize())
                .into_ts()
                .map_err(|error| JsValue::from_str(&error.to_string())),
        }
    }
}

pub(crate) struct GeneralState {
    pending: Option<(Rc<Value>, Value)>,
    engine: Option<
        capacity_autorouter::solvers::high_density_solver::intra_node_solver::IntraNodeRouteSolver,
    >,
    cached_routes: Option<Vec<capacity_autorouter::types::high_density_types::Route>>,
    cached_status: Option<(bool, bool, Option<String>)>,
    output_revision: usize,
    diagnostic_revision: usize,
}

impl GeneralState {
    fn initialized(
        engine: capacity_autorouter::solvers::high_density_solver::intra_node_solver::IntraNodeRouteSolver,
    ) -> Self {
        Self {
            pending: None,
            engine: Some(engine),
            cached_routes: None,
            cached_status: None,
            output_revision: 0,
            diagnostic_revision: 0,
        }
    }

    pub(crate) fn ensure_initialized(&mut self) -> &mut capacity_autorouter::solvers::high_density_solver::intra_node_solver::IntraNodeRouteSolver{
        if self.engine.is_none() {
            let (props, hyper_parameters) = self
                .pending
                .take()
                .expect("Uninitialized General router requires pending props");
            let mut props = props.as_ref().clone();
            props["hyperParameters"] = hyper_parameters;
            let mut engine = capacity_autorouter::solvers::high_density_solver::intra_node_solver::IntraNodeRouteSolver::new(props);
            engine.pow = js_sys::Math::pow;
            engine.exp = js_sys::Math::exp;
            if let Some(routes) = self.cached_routes.take() {
                engine.solved_routes = routes;
            }
            if let Some((solved, failed, error)) = self.cached_status.take() {
                engine.solved = solved;
                engine.failed = failed;
                engine.error = error;
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
        if engine.solved_routes.len() != previous_count {
            self.output_revision += 1;
        }
        self.diagnostic_revision += 1;
    }

    pub(crate) fn set_cached_output(
        &mut self,
        routes: Vec<capacity_autorouter::types::high_density_types::Route>,
        solved: bool,
        failed: bool,
        error: Option<String>,
    ) {
        if let Some(engine) = &mut self.engine {
            engine.solved_routes = routes;
            engine.solved = solved;
            engine.failed = failed;
            engine.error = error;
        } else {
            self.cached_routes = Some(routes);
            self.cached_status = Some((solved, failed, error));
        }
    }

    pub(crate) fn routes(&self) -> &[capacity_autorouter::types::high_density_types::Route] {
        if let Some(engine) = &self.engine {
            &engine.solved_routes
        } else {
            self.cached_routes.as_deref().unwrap_or(&[])
        }
    }

    fn error(&self) -> Option<String> {
        if let Some(engine) = &self.engine {
            engine.error.clone()
        } else {
            self.cached_status
                .as_ref()
                .and_then(|(_, _, error)| error.clone())
        }
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
    pub fn new(props: Ts<IntraNodeProps>) -> Result<Self, JsValue> {
        let props = props
            .to_rust()
            .map(|value| value.0)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        if !props.is_object() {
            return Err(JsValue::from_str(
                "General router context must be an object",
            ));
        }
        Ok(Self {
            props: Rc::new(props),
        })
    }

    pub fn create(
        &self,
        hyper_parameters: Ts<IntraNodeHyperParameters>,
    ) -> Result<IntraNodeRouteSolver, JsValue> {
        let mut props = self.props.as_ref().clone();
        props["hyperParameters"] = hyper_parameters
            .to_rust()
            .map(|value| value.0)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let mut engine = capacity_autorouter::solvers::high_density_solver::intra_node_solver::IntraNodeRouteSolver::new(props);
        engine.pow = js_sys::Math::pow;
        engine.exp = js_sys::Math::exp;
        Ok(IntraNodeRouteSolver {
            engine: Rc::new(RefCell::new(GeneralState::initialized(engine))),
        })
    }

    #[wasm_bindgen(js_name = createLazy)]
    pub fn create_lazy(
        &self,
        hyper_parameters: Ts<IntraNodeHyperParameters>,
    ) -> Result<IntraNodeRouteSolver, JsValue> {
        let hyper_parameters = hyper_parameters
            .to_rust()
            .map(|value| value.0)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        Ok(IntraNodeRouteSolver {
            engine: Rc::new(RefCell::new(GeneralState {
                pending: Some((self.props.clone(), hyper_parameters)),
                engine: None,
                cached_routes: None,
                cached_status: None,
                output_revision: 0,
                diagnostic_revision: 0,
            })),
        })
    }
}

#[wasm_bindgen]
impl IntraNodeRouteSolver {
    #[wasm_bindgen(constructor)]
    pub fn new(props: Ts<IntraNodeProps>) -> Result<Self, JsValue> {
        let props = props
            .to_rust()
            .map(|value| value.0)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let mut engine = capacity_autorouter::solvers::high_density_solver::intra_node_solver::IntraNodeRouteSolver::new(props);
        engine.pow = js_sys::Math::pow;
        engine.exp = js_sys::Math::exp;
        Ok(Self {
            engine: Rc::new(RefCell::new(GeneralState::initialized(engine))),
        })
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
            + u8::from(engine.solved) as f64
            + 2.0 * u8::from(engine.failed) as f64
    }

    #[wasm_bindgen(js_name = computeProgress)]
    pub fn compute_progress(&self) -> f64 {
        self.engine
            .borrow_mut()
            .ensure_initialized()
            .compute_progress()
    }

    #[wasm_bindgen(js_name = getDiagnosticRevision)]
    pub fn get_diagnostic_revision(&self) -> usize {
        self.engine.borrow().diagnostic_revision
    }

    #[wasm_bindgen(js_name = getDiagnostics)]
    pub fn get_diagnostics(&self) -> Result<Ts<IntraNodeDiagnostics>, JsValue> {
        let state = self.engine.borrow();
        let Some(engine) = &state.engine else {
            return IntraNodeDiagnostics(Value::Null)
                .into_ts()
                .map_err(|error| JsValue::from_str(&error.to_string()));
        };
        IntraNodeDiagnostics(serde_json::json!({"unsolvedConnections":engine.unsolved_connections,
            "rerouteAttemptsByConnection":engine.reroute_attempts_by_connection.iter().collect::<Vec<_>>(),
            "activeChildId":engine.active_sub_solver.as_ref().map(|child|child.diagnostic_id),
            "failedChildIds":engine.failed_sub_solvers.iter().map(|child|child.diagnostic_id).collect::<Vec<_>>()})).into_ts().map_err(|error| JsValue::from_str(&error.to_string()))
    }

    #[wasm_bindgen(js_name = getChild)]
    pub fn get_child(
        &self,
        id: usize,
    ) -> bindings::single_high_density_route_solver::SingleHighDensityRouteSolver {
        bindings::single_high_density_route_solver::SingleHighDensityRouteSolver::child(
            self.engine.clone(),
            id,
        )
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
    pub fn get_output(&self) -> Result<Ts<IntraNodeRoutes>, JsValue> {
        IntraNodeRoutes(
            serde_json::to_value(self.engine.borrow().routes())
                .map_err(|error| JsValue::from_str(&error.to_string()))?,
        )
        .into_ts()
        .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    pub fn visualize(
        &self,
        transparentize: js_sys::Function,
    ) -> Result<Ts<SolverGraphics>, JsValue> {
        SolverGraphics(
            self.engine
                .borrow_mut()
                .ensure_initialized()
                .visualize_with_transparentize(&|color, amount| {
                    transparentize
                        .call2(
                            &JsValue::UNDEFINED,
                            &JsValue::from_str(color),
                            &JsValue::from_f64(amount),
                        )
                        .unwrap_or_else(|error| wasm_bindgen::throw_val(error))
                        .as_string()
                        .unwrap_or_else(|| {
                            wasm_bindgen::throw_str("Expected transparency color string")
                        })
                }),
        )
        .into_ts()
        .map_err(|error| JsValue::from_str(&error.to_string()))
    }
}

#[wasm_bindgen]
pub struct BroadRepulsionEngine {
    engine: high_density_repair03::solvers::global_drc_force_improve_solver::solver_helpers::BroadRepulsionEngine,
}

#[wasm_bindgen]
impl BroadRepulsionEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(
        srj_input: Ts<RepairSrj>,
        connectivity_input: Ts<RepairConnectivity>,
    ) -> Result<Self, JsValue> {
        let srj = srj_input
            .to_rust()
            .map_err(|error| JsValue::from_str(&error.to_string()))?
            .0;
        let connectivity: Option<Value> = connectivity_input
            .to_rust()
            .map(|input| input.0)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let math = high_density_repair03::solvers::global_drc_force_improve_solver::solver_helpers::RepairMath {
            hypot: js_sys::Math::hypot,
            sin: js_sys::Math::sin,
            cos: js_sys::Math::cos,
            round: js_sys::Math::round,
        };
        Ok(Self { engine: high_density_repair03::solvers::global_drc_force_improve_solver::solver_helpers::BroadRepulsionEngine::new(srj, connectivity, math) })
    }

    #[wasm_bindgen(js_name = setConnectivity)]
    pub fn set_connectivity(
        &mut self,
        connectivity_input: Ts<RepairConnectivity>,
    ) -> Result<(), JsValue> {
        let connectivity: Option<Value> = connectivity_input
            .to_rust()
            .map(|input| input.0)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        self.engine.set_connectivity(connectivity);
        Ok(())
    }

    pub fn run(&self, routes_input: Ts<RepairRoutes>, effort: f64, pass_multiplier: f64,
    allow_same_net_via_pairs: bool, run_final_cleanup: bool) -> Result<Ts<high_density_repair03::solvers::global_drc_force_improve_solver::solver_helpers::BroadRepulsionResult>, JsValue>{
        let routes = Value::Array(
            routes_input
                .to_rust()
                .map_err(|error| JsValue::from_str(&error.to_string()))?
                .0,
        );
        let result = self.engine.run(
            routes,
            effort,
            pass_multiplier,
            allow_same_net_via_pairs,
            run_final_cleanup,
        );
        result
            .into_ts()
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }
}

#[wasm_bindgen]
pub struct TargetedRepairEngine {
    engine: high_density_repair03::solvers::global_drc_force_improve_solver::solver_helpers::BroadRepulsionEngine,
    pad_context: high_density_repair03::solvers::global_drc_force_improve_solver::find_pad_clearance_via_position::PadClearanceContext,
    connectivity: Option<high_density_repair03::solvers::global_drc_force_improve_solver::net_utils::RepairConnectivityMap>,
}

fn repair_math()
-> high_density_repair03::solvers::global_drc_force_improve_solver::solver_helpers::RepairMath {
    high_density_repair03::solvers::global_drc_force_improve_solver::solver_helpers::RepairMath {
        hypot: js_sys::Math::hypot,
        sin: js_sys::Math::sin,
        cos: js_sys::Math::cos,
        round: js_sys::Math::round,
    }
}

#[derive(serde::Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct RepairSegmentInput {
    root_connection_name: String,
    start: high_density_repair03::solvers::global_drc_force_improve_solver::internal_types::Point,
    end: high_density_repair03::solvers::global_drc_force_improve_solver::internal_types::Point,
    z: f64,
    radius: f64,
}

#[derive(serde::Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct RepairForceInput {
    #[tsify(type = "import('high-density-repair03/lib').HighDensityRoute[]")]
    routes: Vec<Value>,
    #[tsify(type = "Record<string, unknown>[]")]
    errors: Vec<Value>,
    #[tsify(type = "Record<string, number>")]
    trace_map: indexmap::IndexMap<String, usize>,
}

#[derive(serde::Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct RepairPadInput {
    #[tsify(type = "import('high-density-repair03/lib').HighDensityRoute")]
    route: Value,
    preferred:
        high_density_repair03::solvers::global_drc_force_improve_solver::internal_types::Point,
    #[tsify(type = "readonly number[]")]
    z_layers: Vec<f64>,
}

#[derive(serde::Deserialize, Tsify)]
pub struct RepairTraceInput {
    via: high_density_repair03::solvers::global_drc_force_improve_solver::internal_types::ViaNode,
    #[tsify(type = "readonly RepairSegmentInput[]")]
    segments: Vec<RepairSegmentInput>,
    connectivity: Option<high_density_repair03::solvers::global_drc_force_improve_solver::net_utils::RepairConnectivityMap>,
}

#[wasm_bindgen]
impl TargetedRepairEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(
        srj_input: Ts<RepairSrj>,
        connectivity_input: Ts<RepairConnectivity>,
    ) -> Result<Self, JsValue> {
        let srj = srj_input
            .to_rust()
            .map_err(|error| JsValue::from_str(&error.to_string()))?
            .0;
        let connectivity_value: Option<Value> =
            connectivity_input
                .to_rust()
                .map(|input| input.0)
                .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let connectivity: Option<high_density_repair03::solvers::global_drc_force_improve_solver::net_utils::RepairConnectivityMap> = connectivity_value.as_ref().map(|value| serde_json::from_value(value.clone())).transpose()
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let pad_context = high_density_repair03::solvers::global_drc_force_improve_solver::find_pad_clearance_via_position::PadClearanceContext::new(&srj, &repair_math(), connectivity.as_ref());
        let engine = high_density_repair03::solvers::global_drc_force_improve_solver::solver_helpers::BroadRepulsionEngine::new(srj, connectivity_value, repair_math());
        Ok(Self {
            engine,
            pad_context,
            connectivity,
        })
    }

    #[wasm_bindgen(js_name = setConnectivity)]
    pub fn set_connectivity(
        &mut self,
        connectivity_input: Ts<RepairConnectivity>,
    ) -> Result<(), JsValue> {
        let connectivity_value: Option<Value> =
            connectivity_input
                .to_rust()
                .map(|input| input.0)
                .map_err(|error| JsValue::from_str(&error.to_string()))?;
        self.connectivity = connectivity_value
            .as_ref()
            .map(|value| serde_json::from_value(value.clone()))
            .transpose()
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        self.pad_context
            .set_connectivity(self.connectivity.as_ref());
        self.engine.set_connectivity(connectivity_value);
        Ok(())
    }

    #[wasm_bindgen(js_name = applyForces)]
    pub fn apply_forces(&self, input: Ts<RepairForceInput>, scale: f64,
    canonical_pairs: bool, same_net: bool, shared_site: bool, owner_target: bool) -> Result<Ts<high_density_repair03::solvers::global_drc_force_improve_solver::solver_helpers::ErrorForceResult>, JsError>{
        let input = input.to_rust()?;
        let result = self.engine.apply_error_forces(
            input.routes,
            input.errors,
            input.trace_map,
            scale,
            canonical_pairs,
            same_net,
            shared_site,
            owner_target,
        );
        Ok(result.into_ts()?)
    }

    pub fn pad(&self, input: Ts<RepairPadInput>, radius: f64) -> Result<Ts<high_density_repair03::solvers::global_drc_force_improve_solver::find_pad_clearance_via_position::PadPlacement>, JsError>{
        let input = input.to_rust()?;
        let route = high_density_repair03::solvers::global_drc_force_improve_solver::internal_types::MutableRoute::from_value(&input.route);
        let result = self.pad_context.find_with_identity(
            &route,
            input.preferred,
            radius,
            &input.z_layers,
            self.connectivity.as_ref(),
            &repair_math(),
        );
        Ok(result.into_ts()?)
    }

    pub fn trace(input: Ts<RepairTraceInput>, clearance: f64) -> Result<Ts<high_density_repair03::solvers::global_drc_force_improve_solver::find_trace_clearance_via_positions::TracePlacements>, JsError>{
        use high_density_repair03::solvers::global_drc_force_improve_solver::internal_types::{
            RoutePoint, Segment,
        };
        use std::{cell::RefCell, rc::Rc};
        let RepairTraceInput {
            via,
            segments: inputs,
            connectivity,
        } = input.to_rust()?;
        let segments: Vec<Segment> = inputs.into_iter().map(|input| Segment {
            route_index: 0, root_connection_name: input.root_connection_name,
            start_index: 0, end_index: 1,
            start: Rc::new(RefCell::new(RoutePoint {
                metadata_identity: high_density_repair03::solvers::global_drc_force_improve_solver::internal_types::next_identity(),
                x: input.start.x,
                y: input.start.y,
                z: input.z, metadata: Rc::new(Value::Null),
            })),
            end: Rc::new(RefCell::new(RoutePoint {
                metadata_identity: high_density_repair03::solvers::global_drc_force_improve_solver::internal_types::next_identity(),
                x: input.end.x,
                y: input.end.y,
                z: input.z, metadata: Rc::new(Value::Null),
            })), z: input.z, radius: input.radius,
        }).collect();
        let result = high_density_repair03::solvers::global_drc_force_improve_solver::find_trace_clearance_via_positions::find_trace_clearance_via_positions_with_identity(
            &via, &segments, clearance, connectivity.as_ref(), &repair_math());
        Ok(result.into_ts()?)
    }
}

#[wasm_bindgen]
pub struct GlobalDrcBranchPortfolioSolver {
    pending_reference_error: std::rc::Rc<std::cell::RefCell<Option<JsValue>>>,
    solver: high_density_repair03::solvers::global_drc_force_improve_solver::global_drc_branch_portfolio_solver::GlobalDrcBranchPortfolioSolver,
    evaluator: std::rc::Rc<std::cell::RefCell<capacity_autorouter::autorouter_pipelines::autorouting_pipeline9_preloaded_trace_graph::pipeline9_drc_evaluator::Pipeline9DrcEvaluator>>,
}

#[wasm_bindgen]
impl GlobalDrcBranchPortfolioSolver {
    #[wasm_bindgen(constructor)]
    pub fn new(
        params_input: Ts<RepairPortfolioInput>,
        descriptor_input: Ts<RepairDescriptor>,
        #[wasm_bindgen(unchecked_param_type = "(routes: RepairRoutes) => RepairEvaluationResult")]
        reference: js_sys::Function,
        prepared_engine: Option<AutoroutingDrcEngine>,
    ) -> Result<Self, JsValue> {
        use std::{cell::RefCell, rc::Rc};
        let mut params: Value = params_input
            .to_rust()
            .map(|input| input.0)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let mut descriptor: Value = descriptor_input
            .to_rust()
            .map(|input| input.0)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let route_values = params["hdRoutes"]
            .take()
            .as_array()
            .ok_or_else(|| JsValue::from_str("Repair portfolio routes required"))?
            .clone();
        let routes = high_density_repair03::solvers::global_drc_force_improve_solver::types::Routes::new(route_values.into_iter().map(high_density_repair03::solvers::global_drc_force_improve_solver::internal_types::MutableRoute::from_owned_value).collect());
        let conn_map = descriptor.get("connMap").filter(|v| !v.is_null()).cloned();
        let engine = Rc::new(high_density_repair03::solvers::global_drc_force_improve_solver::solver_helpers::BroadRepulsionEngine::new(params["srj"].clone(), conn_map, repair_math()));
        let prepared =
            prepared_engine.map(|engine| (engine.engine, descriptor["preparedBaseline"].take()));
        let mut evaluator = capacity_autorouter::autorouter_pipelines::autorouting_pipeline9_preloaded_trace_graph::pipeline9_drc_evaluator::Pipeline9DrcEvaluator::new_with_prepared(descriptor,
            high_density_repair03::drc::autorouting_drc_engine::DrcMath { hypot: js_sys::Math::hypot, sin: js_sys::Math::sin, cos: js_sys::Math::cos }, prepared)
            .map_err(|error| JsValue::from_str(&error))?;
        let pending_reference_error = Rc::new(RefCell::new(None));
        let callback_error = pending_reference_error.clone();
        evaluator.set_reference_callback(Box::new(move |routes| {
            let input = RepairCallbackRoutes(routes)
                .into_ts()
                .map_err(|error| error.to_string())?;
            let result = reference
                .call1(&JsValue::UNDEFINED, &input.js_value())
                .map_err(|error| {
                    *callback_error.borrow_mut() = Some(error);
                    "Reference DRC callback failed".to_owned()
                })?;
            Ts::<RepairEvaluationResult>::new_unchecked(result)
                .to_rust()
                .map(|value| value.0)
                .map_err(|error| format!("Invalid reference DRC result: {error}"))
        }));
        evaluator.set_clock(js_sys::Date::now);
        let evaluator = Rc::new(RefCell::new(evaluator));
        let shared: high_density_repair03::solvers::global_drc_force_improve_solver::types::Evaluator = evaluator.clone();
        params["hasCustomDrcEvaluator"] = Value::Bool(true);
        let solver = high_density_repair03::solvers::global_drc_force_improve_solver::global_drc_branch_portfolio_solver::GlobalDrcBranchPortfolioSolver::new(params, routes, engine, shared.clone(), None, Some(shared))
            .map_err(|error| pending_reference_error.borrow_mut().take().unwrap_or_else(|| JsValue::from_str(&error)))?;
        Ok(Self {
            solver,
            evaluator,
            pending_reference_error,
        })
    }

    pub fn step(&mut self) -> Result<Ts<RepairPortfolioState>, JsValue> {
        let result = self.solver.step();
        result.map_err(|error| {
            self.pending_reference_error
                .borrow_mut()
                .take()
                .unwrap_or_else(|| JsValue::from_str(&error))
        })?;
        self.state()
    }

    pub fn state(&self) -> Result<Ts<RepairPortfolioState>, JsValue> {
        let evaluator = self.evaluator.borrow();
        let mut stats = self.solver.stats.clone();
        stats["indexedDrcEvaluationCount"] = json!(evaluator.indexed_drc_evaluation_count);
        stats["indexedDrcCacheHitCount"] = json!(evaluator.indexed_drc_cache_hit_count);
        stats["indexedDrcEvaluationTimeMs"] = json!(evaluator.indexed_drc_evaluation_time_ms);
        stats["indexedDrcCandidateCacheSize"] = json!(evaluator.cache_len());
        RepairPortfolioState {
            solved: self.solver.solved,
            failed: self.solver.failed,
            error: self.solver.error.clone(),
            iterations: self.solver.iterations,
            max_iterations: 100000,
            progress: self.solver.progress,
            stats,
        }
        .into_ts()
        .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    #[wasm_bindgen(js_name = getOutput)]
    pub fn get_output(&self) -> Result<Ts<RepairRoutes>, JsValue> {
        let routes: Vec<_> = self.solver.get_output().iter().map(high_density_repair03::solvers::global_drc_force_improve_solver::internal_types::MutableRoute::to_value).collect();
        RepairRoutes(routes)
            .into_ts()
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    #[wasm_bindgen(js_name = debugState)]
    pub fn debug_state(&self) -> Result<Ts<RepairDebugState>, JsValue> {
        RepairDebugState(self.solver.debug_state())
            .into_ts()
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    #[wasm_bindgen(js_name = evaluateRoutes)]
    pub fn evaluate_routes(
        &self,
        routes_input: Ts<RepairRoutes>,
    ) -> Result<Ts<RepairSnapshot>, JsValue> {
        let routes: Vec<Value> = routes_input
            .to_rust()
            .map(|input| input.0)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let result = self.evaluator.borrow_mut().evaluate_values(&routes);
        let result = result.map_err(|error| {
            self.pending_reference_error
                .borrow_mut()
                .take()
                .unwrap_or_else(|| JsValue::from_str(&error))
        })?;
        RepairSnapshot(result)
            .into_ts()
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }
}

#[wasm_bindgen]
impl GlobalDrcBranchPortfolioSolver {
    pub fn relax(srj_input: Ts<RepairSrj>, routes_input: Ts<RepairRoutes>, connectivity_input: Ts<RepairConnectivity>, kind: &str) -> Result<Ts<high_density_repair03::solvers::global_drc_force_improve_solver::solver_helpers::BroadRepulsionResult>, JsValue>{
        let srj: Value = srj_input
            .to_rust()
            .map(|input| input.0)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let values: Vec<Value> = routes_input
            .to_rust()
            .map(|input| input.0)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let routes = high_density_repair03::solvers::global_drc_force_improve_solver::types::Routes::new(values.into_iter().map(high_density_repair03::solvers::global_drc_force_improve_solver::internal_types::MutableRoute::from_owned_value).collect());
        let conn_value = connectivity_input
            .to_rust()
            .map_err(|error| JsValue::from_str(&error.to_string()))?
            .0;
        let conn = conn_value
            .map(serde_json::from_value)
            .transpose()
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let result = match kind {
            "trace" => high_density_repair03::solvers::global_drc_force_improve_solver::trace_to_pad_clearance_relaxation::apply_trace_to_pad_clearance_relaxation(&srj, &routes, conn.as_ref(), repair_math()),
            "via" => high_density_repair03::solvers::global_drc_force_improve_solver::via_to_pad_clearance_relaxation::apply_via_to_pad_clearance_relaxation(&srj, &routes, conn.as_ref(), repair_math()),
            _ => return Err(JsValue::from_str("Unknown clearance relaxation kind")),
        };
        let output: Vec<_> = result.iter().map(high_density_repair03::solvers::global_drc_force_improve_solver::internal_types::MutableRoute::to_value).collect();
        high_density_repair03::solvers::global_drc_force_improve_solver::solver_helpers::BroadRepulsionResult { changed: !high_density_repair03::solvers::global_drc_force_improve_solver::types::Routes::ptr_eq(&routes, &result), routes: Value::Array(output) }.into_ts().map_err(|error| JsValue::from_str(&error.to_string()))
    }
}

pub use bindings::global_drc_force_improve_solver::GlobalDrcForceImproveSolver;

pub use bindings::trace_simplification_dispatcher::TraceSimplificationDispatcher;
