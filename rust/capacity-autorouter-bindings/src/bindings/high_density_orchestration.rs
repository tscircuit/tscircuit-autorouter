use capacity_autorouter::solvers::hyper_high_density_solver::grow_shrink_high_density_intra_node_solver::grow_shrink_high_density_intra_node_solver as growth_solver;
use capacity_autorouter::solvers::high_density_solver::high_density_solver;
use std::{cell::RefCell, collections::HashMap, rc::{Rc, Weak}};
use serde_json::{json, Value};
use wasm_bindgen::prelude::*;
use tsify::{Ts, Tsify};
use crate::bindings::high_density_wire::*;
use capacity_autorouter::bindings::high_density::specialized_base_solver::BaseSolverState;
use crate::bindings::portfolio_single_intra_node_solver::{PortfolioCore, take_shared_portfolio, allocate_orchestration_handle, take_shared_general};
use capacity_autorouter::solvers::hyper_high_density_solver::grow_shrink_high_density_intra_node_solver::grow_shrink_high_density_intra_node_solver::{GrowthPortfolio, GrowthPortfolioState};
use capacity_autorouter::solvers::high_density_solver::high_density_solver::{HighDensityNodeSolver};

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_name = String)]
    fn exception_string(value: &JsValue) -> String;
}

thread_local! {
    static LAST_EXCEPTION: RefCell<Option<JsValue>> = const { RefCell::new(None) };
    static SHARED_EXTERNAL: RefCell<HashMap<u32, (js_sys::Function, String)>> = RefCell::new(HashMap::new());
    static SHARED_GENERAL: RefCell<HashMap<u32, Rc<RefCell<GeneralChildCore>>>> = RefCell::new(HashMap::new());
    static CACHE_COUNTS: RefCell<(f64, f64)> = const { RefCell::new((0.0, 0.0)) };
    static SHARED_GROWTH: RefCell<HashMap<u32, Rc<RefCell<GrowthCore>>>> = RefCell::new(HashMap::new());
}

pub(crate) fn set_cache_counts(hits: f64, misses: f64) {
    CACHE_COUNTS.with(|counts| *counts.borrow_mut() = (hits, misses));
}

pub(crate) fn cache_stats() -> (f64, f64) {
    CACHE_COUNTS.with(|counts| *counts.borrow())
}

fn error_text(error: JsValue) -> String {
    let text = exception_string(&error);
    LAST_EXCEPTION.with(|stored| *stored.borrow_mut() = Some(error));
    text
}

fn return_error(error: String) -> JsValue {
    LAST_EXCEPTION
        .with(|stored| stored.borrow_mut().take())
        .unwrap_or_else(|| JsValue::from_str(&error))
}

#[derive(Clone)]
struct PortfolioChild {
    id: u32,
    engine: Rc<RefCell<PortfolioCore>>,
    node: Value,
    visualize: js_sys::Function,
}

impl GrowthPortfolio for PortfolioChild {
    fn id(&self) -> u32 {
        self.id
    }
    fn step(&mut self) -> Result<(), String> {
        self.engine.borrow_mut().step().map_err(error_text)
    }
    fn state(&self) -> GrowthPortfolioState {
        let state = self.engine.borrow().state();
        GrowthPortfolioState {
            iterations: state.iterations,
            max_iterations: state.max_iterations,
            solved: state.solved,
            failed: state.failed,
            progress: state.progress,
            error: state.error,
        }
    }
    fn set_max_iterations(&mut self, iterations: f64) {
        self.engine.borrow_mut().set_max_iterations(iterations);
    }
    fn solved_routes(&self) -> Result<Vec<Value>, String> {
        Ok(self.engine.borrow().output_routes.clone())
    }
    fn reject_solution(&mut self, error: &str) {
        self.engine.borrow_mut().reject_solution(error);
    }
    fn visualize(&self) -> Result<Value, String> {
        let value = self
            .visualize
            .call1(&JsValue::UNDEFINED, &JsValue::from_f64(self.id as f64))
            .map_err(error_text)?;
        callback_value(value)
    }
}

impl HighDensityNodeSolver for PortfolioChild {
    fn id(&self) -> u32 {
        self.id
    }
    fn state(&self) -> BaseSolverState {
        self.engine.borrow().state()
    }
    fn step(
        &mut self,
        _observe_parent: Option<&mut dyn FnMut(bool) -> Result<(), String>>,
    ) -> Result<(), String> {
        self.engine.borrow_mut().step().map_err(error_text)
    }
    fn solved_routes(&self) -> Result<Vec<Value>, String> {
        Ok(self.engine.borrow().output_routes.clone())
    }
    fn route_count(&self) -> Result<usize, String> {
        Ok(self.engine.borrow().output_routes.len())
    }
    fn node_with_port_points(&self) -> &Value {
        &self.node
    }
    fn solver_type_name(&self) -> String {
        self.engine.borrow().resolved_solver_type.clone()
    }
    fn growth_attempts(&self) -> Option<f64> {
        None
    }
    fn visualize(&self, _: &dyn Fn(&str, f64) -> String) -> Result<Value, String> {
        let value = self
            .visualize
            .call1(&JsValue::UNDEFINED, &JsValue::from_f64(self.id as f64))
            .map_err(error_text)?;
        callback_mapped_value(value).map_err(error_text)
    }
}

#[derive(Clone)]
struct ExternalChild {
    id: u32,
    callback: js_sys::Function,
    solver_type: String,
    node: Value,
    state: BaseSolverState,
    growth_attempts: Option<f64>,
}

impl ExternalChild {
    fn call(&self, method: &str) -> Result<Value, String> {
        let result = self
            .callback
            .call1(&JsValue::UNDEFINED, &JsValue::from_str(method))
            .map_err(error_text)?;
        callback_mapped_value(result).map_err(error_text)
    }
}

impl HighDensityNodeSolver for ExternalChild {
    fn id(&self) -> u32 {
        self.id
    }
    fn state(&self) -> BaseSolverState {
        self.state.clone()
    }
    fn step(
        &mut self,
        _observe_parent: Option<&mut dyn FnMut(bool) -> Result<(), String>>,
    ) -> Result<(), String> {
        let state = self.call("step")?;
        self.solver_type = state["solverType"]
            .as_str()
            .ok_or("External child solverType required")?
            .to_owned();
        self.growth_attempts = state["growthAttempts"].as_f64();
        self.state = serde_json::from_value(state).map_err(|error| error.to_string())?;
        self.node = self.call("node")?;
        Ok(())
    }
    fn solved_routes(&self) -> Result<Vec<Value>, String> {
        serde_json::from_value(self.call("routes")?).map_err(|error| error.to_string())
    }
    fn node_with_port_points(&self) -> &Value {
        &self.node
    }
    fn solver_type_name(&self) -> String {
        self.solver_type.clone()
    }
    fn growth_attempts(&self) -> Option<f64> {
        self.growth_attempts
    }
    fn visualize(&self, _: &dyn Fn(&str, f64) -> String) -> Result<Value, String> {
        self.call("visualize")
    }
}

struct GeneralChildCore {
    engine: Rc<RefCell<crate::GeneralState>>,
    state: BaseSolverState,
    solver_type: String,
    node: Value,
}

struct GeneralChild {
    id: u32,
    engine: Rc<RefCell<GeneralChildCore>>,
    node: Value,
    visualize: js_sys::Function,
}

impl HighDensityNodeSolver for GeneralChild {
    fn id(&self) -> u32 {
        self.id
    }
    fn state(&self) -> BaseSolverState {
        self.engine.borrow().state.clone()
    }
    fn step(
        &mut self,
        _observe_parent: Option<&mut dyn FnMut(bool) -> Result<(), String>>,
    ) -> Result<(), String> {
        let mut core = self.engine.borrow_mut();
        if core.state.solved || core.state.failed {
            return Ok(());
        }
        core.state.iterations += 1;
        let status = {
            let mut raw = core.engine.borrow_mut();
            raw.step_inner(core.state.iterations);
            let solver = raw.ensure_initialized();
            (
                solver.solved,
                solver.failed,
                solver.error.clone(),
                solver.solved_routes.len() as f64 / solver.total_connections as f64,
            )
        };
        core.state.solved = status.0;
        core.state.failed = status.1;
        core.state.error = status.2;
        core.state.progress = status.3;
        if !core.state.solved && core.state.iterations as f64 > core.state.max_iterations {
            core.state.failed = true;
            core.state.error = Some(format!(
                "IntraNodeRouteSolver ran out of iterations (MAX_ITERATIONS={})",
                capacity_autorouter::utils::js_number::js_number_to_string(
                    core.state.max_iterations
                )
            ));
        }
        Ok(())
    }
    fn solved_routes(&self) -> Result<Vec<Value>, String> {
        let core = self.engine.borrow();
        core.engine
            .borrow()
            .routes()
            .iter()
            .map(|route| serde_json::to_value(route).map_err(|error| error.to_string()))
            .collect()
    }
    fn route_count(&self) -> Result<usize, String> {
        let core = self.engine.borrow();
        Ok(core.engine.borrow().routes().len())
    }
    fn node_with_port_points(&self) -> &Value {
        &self.node
    }
    fn solver_type_name(&self) -> String {
        self.engine.borrow().solver_type.clone()
    }
    fn growth_attempts(&self) -> Option<f64> {
        None
    }
    fn visualize(&self, _: &dyn Fn(&str, f64) -> String) -> Result<Value, String> {
        let output = self
            .visualize
            .call1(&JsValue::UNDEFINED, &JsValue::from_f64(self.id as f64))
            .map_err(error_text)?;
        callback_mapped_value(output).map_err(error_text)
    }
}

struct GrowthCore {
    solver: growth_solver::GrowShrinkHighDensityIntraNodeSolver,
    factory: js_sys::Function,
    validator: Option<js_sys::Function>,
    visualize: js_sys::Function,
    portfolios: HashMap<u32, Rc<RefCell<PortfolioCore>>>,
}

impl GrowthCore {
    fn state(&self) -> BaseSolverState {
        let solver = &self.solver;
        BaseSolverState {
            max_iterations: solver.max_iterations,
            solved: solver.solved,
            failed: solver.failed,
            iterations: solver.iterations,
            progress: solver.progress,
            error: solver.error.clone(),
        }
    }

    fn step(
        &mut self,
        inner: Option<(usize, f64)>,
        mut observe_parent: Option<&mut dyn FnMut(bool) -> Result<(), String>>,
    ) -> Result<(), String> {
        let factory_callback = &self.factory;
        let visualize = &self.visualize;
        let portfolios = &mut self.portfolios;
        let mut factory = |params: Value| -> Result<Box<dyn GrowthPortfolio>, String> {
            let node = params["nodeWithPortPoints"].clone();
            let node_value = callback_output(&node)?;
            let value = factory_callback
                .call1(&JsValue::UNDEFINED, &node_value)
                .map_err(error_text)?;
            let id = value.as_f64().ok_or("Growth factory handle required")? as u32;
            let engine = take_shared_portfolio(id)?;
            portfolios.insert(id, engine.clone());
            Ok(Box::new(PortfolioChild {
                id,
                engine,
                node,
                visualize: visualize.clone(),
            }))
        };
        let custom_validator =
            self.solver.constructor_params["hasCustomValidator"].as_bool() == Some(true);
        let mut validator =
            |routes: &[Value], snapshot: &Value| -> Result<(bool, Option<Value>), String> {
                let routes = callback_output(&json!(routes))?;
                let state = callback_output(snapshot)?;
                if custom_validator && let Some(observe) = observe_parent.as_mut() {
                    observe(true)?;
                }
                let result =
                    self.validator
                        .as_ref()
                        .unwrap()
                        .call2(&JsValue::UNDEFINED, &routes, &state);
                let exit_result = if custom_validator {
                    if let Some(observe) = observe_parent.as_mut() {
                        observe(false)
                    } else {
                        Ok(())
                    }
                } else {
                    Ok(())
                };
                let result = result.map_err(error_text)?;
                exit_result?;
                let result = callback_value(result)?;
                let accepted = result["accepted"]
                    .as_bool()
                    .ok_or("Growth validator accepted required")?;
                Ok((accepted, result.get("state").cloned()))
            };
        let validation: Option<&mut growth_solver::RouteValidator<'_>> =
            if custom_validator && self.validator.is_some() {
                Some(&mut validator)
            } else {
                None
            };
        if let Some((iterations, maximum)) = inner {
            self.solver.iterations = iterations;
            self.solver.max_iterations = maximum;
            self.solver.step_inner(&mut factory, validation)
        } else {
            self.solver.step(&mut factory, validation)
        }
    }

    fn snapshot(&self) -> Value {
        let s = &self.solver;
        json!({"MAX_ITERATIONS":s.max_iterations,"iterations":s.iterations,"solved":s.solved,"failed":s.failed,
            "progress":s.progress,"error":s.error,"nodeWithPortPoints":s.node_with_port_points,"scaleFactor":s.scale_factor,
            "growthAttempts":s.growth_attempts,"maxGrowthAttempts":s.max_growth_attempts,"stats":s.stats,
            "activeId":s.active_sub_solver.as_ref().map(|child| child.id()),"winnerId":s.winning_solver.as_ref().map(|child| child.id()),
            "failedIds":s.failed_solvers.iter().map(|child| child.id()).collect::<Vec<_>>()})
    }
}

struct GrowthChild {
    id: u32,
    engine: Rc<RefCell<GrowthCore>>,
    node: Value,
}

impl HighDensityNodeSolver for GrowthChild {
    fn id(&self) -> u32 {
        self.id
    }
    fn state(&self) -> BaseSolverState {
        self.engine.borrow().state()
    }
    fn step(
        &mut self,
        observe_parent: Option<&mut dyn FnMut(bool) -> Result<(), String>>,
    ) -> Result<(), String> {
        self.engine.borrow_mut().step(None, observe_parent)
    }
    fn solved_routes(&self) -> Result<Vec<Value>, String> {
        Ok(self.engine.borrow().solver.solved_routes.clone())
    }
    fn route_count(&self) -> Result<usize, String> {
        Ok(self.engine.borrow().solver.solved_routes.len())
    }
    fn node_with_port_points(&self) -> &Value {
        &self.node
    }
    fn solver_type_name(&self) -> String {
        let core = self.engine.borrow();
        if let Some(winner) = &core.solver.winning_solver {
            return core
                .portfolios
                .get(&winner.id())
                .expect("Winning portfolio exists")
                .borrow()
                .resolved_solver_type
                .clone();
        }
        "GrowShrinkHighDensityIntraNodeSolver".into()
    }
    fn growth_attempts(&self) -> Option<f64> {
        Some(self.engine.borrow().solver.growth_attempts)
    }
    fn visualize(&self, _: &dyn Fn(&str, f64) -> String) -> Result<Value, String> {
        self.engine.borrow().solver.visualize()
    }
}

#[wasm_bindgen]
pub struct GrowShrinkHighDensityIntraNodeSolver {
    engine: Rc<RefCell<GrowthCore>>,
}

#[wasm_bindgen]
impl GrowShrinkHighDensityIntraNodeSolver {
    #[wasm_bindgen(constructor)]
    pub fn new(
        params: Ts<HighDensityValue>,
        #[wasm_bindgen(unchecked_param_type = "(node: HighDensityNode) => number")]
        factory: js_sys::Function,
        #[wasm_bindgen(
            unchecked_param_type = "((routes: HighDensityRoutes, state: GrowthSnapshot) => { accepted: boolean; state: Record<string, unknown> }) | undefined"
        )]
        validator: Option<js_sys::Function>,
        #[wasm_bindgen(unchecked_param_type = "(id: number) => HighDensityGraphics")]
        visualize: js_sys::Function,
    ) -> Result<Self, JsValue> {
        Ok(Self {
            engine: Rc::new(RefCell::new(GrowthCore {
                solver: growth_solver::GrowShrinkHighDensityIntraNodeSolver::new(read_value(
                    params,
                )?),
                factory,
                validator,
                visualize,
                portfolios: HashMap::new(),
            })),
        })
    }

    #[wasm_bindgen(js_name = stepInner)]
    pub fn step_inner(&self, iterations: usize, maximum: f64) -> Result<(), JsValue> {
        self.engine
            .borrow_mut()
            .step(Some((iterations, maximum)), None)
            .map_err(return_error)
    }

    pub fn solve(&self) -> Result<(), JsValue> {
        let mut core = self.engine.borrow_mut();
        while !core.solver.solved && !core.solver.failed {
            core.step(None, None).map_err(return_error)?;
        }
        Ok(())
    }

    #[wasm_bindgen(js_name = snapshot)]
    pub fn snapshot(&self) -> Result<Ts<GrowthSnapshot>, JsValue> {
        GrowthSnapshot(self.engine.borrow().snapshot())
            .into_ts()
            .map_err(|error| JsError::new(&error.to_string()).into())
    }

    #[wasm_bindgen(js_name = routes)]
    pub fn routes(&self) -> Result<Ts<HighDensityRoutes>, JsValue> {
        HighDensityRoutes(self.engine.borrow().solver.solved_routes.clone())
            .into_ts()
            .map_err(|error| JsError::new(&error.to_string()).into())
    }

    #[wasm_bindgen(js_name = visualize)]
    pub fn visualize(&self) -> Result<Ts<HighDensityGraphics>, JsValue> {
        let value = self
            .engine
            .borrow()
            .solver
            .visualize()
            .map_err(return_error)?;
        HighDensityGraphics(value)
            .into_ts()
            .map_err(|error| JsError::new(&error.to_string()).into())
    }

    #[wasm_bindgen(js_name = restore)]
    pub fn restore(&self, patch: Ts<HighDensityValue>) -> Result<(), JsValue> {
        let patch = read_value(patch)?;
        let mut core = self.engine.borrow_mut();
        for key in ["activeId", "winnerId", "failedIds"] {
            if let Some(value) = patch.get(key) {
                let ids: Vec<u32> = if key == "failedIds" {
                    serde_json::from_value(value.clone())
                        .map_err(|error| JsValue::from_str(&error.to_string()))?
                } else if value.is_null() {
                    Vec::new()
                } else {
                    vec![
                        value
                            .as_u64()
                            .ok_or_else(|| JsValue::from_str("Child ID required"))?
                            as u32,
                    ]
                };
                let mut children: Vec<Box<dyn GrowthPortfolio>> = Vec::new();
                for id in ids {
                    let engine = if let Some(engine) = core.portfolios.get(&id) {
                        engine.clone()
                    } else {
                        let engine = take_shared_portfolio(id).map_err(return_error)?;
                        core.portfolios.insert(id, engine.clone());
                        engine
                    };
                    let node = engine.borrow().solver.node_with_port_points.clone();
                    children.push(Box::new(PortfolioChild {
                        id,
                        engine,
                        node,
                        visualize: core.visualize.clone(),
                    }));
                }
                match key {
                    "activeId" => core.solver.active_sub_solver = children.pop(),
                    "winnerId" => core.solver.winning_solver = children.pop(),
                    _ => core.solver.failed_solvers = children,
                }
            }
        }
        let s = &mut core.solver;
        macro_rules! field {
            ($key:literal,$name:ident) => {
                if let Some(value) = patch.get($key) {
                    s.$name = serde_json::from_value(value.clone())
                        .map_err(|error| JsValue::from_str(&error.to_string()))?;
                }
            };
        }
        field!("MAX_ITERATIONS", max_iterations);
        field!("iterations", iterations);
        field!("solved", solved);
        field!("failed", failed);
        field!("error", error);
        field!("constructorParams", constructor_params);
        field!("nodeWithPortPoints", node_with_port_points);
        field!("scaleFactor", scale_factor);
        field!("growthAttempts", growth_attempts);
        field!("maxGrowthAttempts", max_growth_attempts);
        field!("stats", stats);
        field!("solvedRoutes", solved_routes);
        if let Some(value) = patch.get("progress") {
            s.progress = value.as_f64().unwrap_or(f64::NAN);
        }
        Ok(())
    }

    #[wasm_bindgen(js_name = shareForOrchestration)]
    pub fn share_for_orchestration(&self) -> u32 {
        let id = allocate_orchestration_handle();
        SHARED_GROWTH.with(|registry| registry.borrow_mut().insert(id, self.engine.clone()));
        id
    }
}

enum BoardChildReference {
    External(ExternalChild),
    General(Rc<RefCell<GeneralChildCore>>, Value),
    Portfolio(Weak<RefCell<PortfolioCore>>, Value),
    Growth(Weak<RefCell<GrowthCore>>, Value),
}

#[wasm_bindgen]
pub struct HighDensitySolver {
    children: HashMap<u32, BoardChildReference>,
    solver: high_density_solver::HighDensitySolver,
    factory: js_sys::Function,
    visualize: js_sys::Function,
    transparentize: js_sys::Function,
    completed: Option<js_sys::Function>,
}

#[wasm_bindgen]
impl HighDensitySolver {
    #[wasm_bindgen(constructor)]
    pub fn new(
        params: Ts<HighDensityMappedValue>,
        #[wasm_bindgen(unchecked_param_type = "(growth: boolean) => number")]
        factory: js_sys::Function,
        #[wasm_bindgen(unchecked_param_type = "(id: number) => unknown")]
        visualize: js_sys::Function,
        #[wasm_bindgen(unchecked_param_type = "(color: string, amount: number) => string")]
        transparentize: js_sys::Function,
        #[wasm_bindgen(
            unchecked_param_type = "((id: number, failed: boolean, state: HighDensityState | undefined, totalRoutes: number) => void) | undefined"
        )]
        completed: Option<js_sys::Function>,
        #[wasm_bindgen(
            unchecked_param_type = "((snapshot: HighDensityBoardSnapshot | null) => void) | undefined"
        )]
        observe_parent: Option<js_sys::Function>,
    ) -> Result<Self, JsValue> {
        let mut solver = high_density_solver::HighDensitySolver::new(read_mapped_value(params)?)
            .map_err(return_error)?;
        if let Some(callback) = observe_parent {
            solver.observe_parent = Some(Box::new(
                move |snapshot: Option<Value>| -> Result<(), String> {
                    let value = if let Some(snapshot) = snapshot {
                        callback_output(&snapshot)?
                    } else {
                        JsValue::NULL
                    };
                    callback
                        .call1(&JsValue::UNDEFINED, &value)
                        .map_err(error_text)?;
                    Ok(())
                },
            ));
        }
        Ok(Self {
            children: HashMap::new(),
            solver,
            factory,
            visualize,
            transparentize,
            completed,
        })
    }

    #[wasm_bindgen(js_name = shareExternal)]
    pub fn share_external(
        #[wasm_bindgen(unchecked_param_type = "(method: string) => unknown")]
        callback: js_sys::Function,
        solver_type: &str,
    ) -> u32 {
        let id = allocate_orchestration_handle();
        SHARED_EXTERNAL.with(|registry| {
            registry
                .borrow_mut()
                .insert(id, (callback, solver_type.to_owned()))
        });
        id
    }

    #[wasm_bindgen(js_name = attachTerminalPcbPortIds)]
    pub fn attach_terminal_pcb_port_ids(
        node: Ts<HighDensityMappedValue>,
        routes: Ts<HighDensityMappedValue>,
    ) -> Result<Ts<HighDensityRoutes>, JsValue> {
        let node = read_mapped_value(node)?;
        let routes = serde_json::from_value(read_mapped_value(routes)?)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let routes =
            high_density_solver::HighDensitySolver::attach_terminal_pcb_port_ids(&node, routes)
                .map_err(return_error)?;
        HighDensityRoutes(routes)
            .into_ts()
            .map_err(|error| JsError::new(&error.to_string()).into())
    }

    #[wasm_bindgen(js_name = shareGeneral)]
    pub fn share_general(
        handle: u32,
        state: Ts<HighDensityMappedValue>,
        node: Ts<HighDensityMappedValue>,
        solver_type: &str,
    ) -> Result<u32, JsValue> {
        let state = serde_json::from_value(read_mapped_value(state)?)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let node = read_mapped_value(node)?;
        let engine = take_shared_general(handle).map_err(return_error)?;
        let id = allocate_orchestration_handle();
        SHARED_GENERAL.with(|registry| {
            registry.borrow_mut().insert(
                id,
                Rc::new(RefCell::new(GeneralChildCore {
                    engine,
                    state,
                    node,
                    solver_type: solver_type.to_owned(),
                })),
            )
        });
        Ok(id)
    }

    #[wasm_bindgen(js_name = metadata)]
    pub fn metadata(&self) -> Result<Ts<HighDensityRecord>, JsValue> {
        HighDensityRecord(json!(self.solver.node_solve_metadata_by_id))
            .into_ts()
            .map_err(|error| JsError::new(&error.to_string()).into())
    }

    #[wasm_bindgen(js_name = childState)]
    pub fn child_state(&self, id: u32) -> Result<Ts<HighDensityState>, JsValue> {
        let state = match self.children.get(&id) {
            Some(BoardChildReference::External(child)) => {
                serde_json::from_value(child.call("state").map_err(return_error)?)
                    .map_err(|error| JsValue::from_str(&error.to_string()))?
            }
            Some(BoardChildReference::General(engine, _)) => engine.borrow().state.clone(),
            Some(BoardChildReference::Portfolio(engine, _)) => engine
                .upgrade()
                .ok_or_else(|| JsValue::from_str("Released Portfolio child"))?
                .borrow()
                .state(),
            Some(BoardChildReference::Growth(engine, _)) => engine
                .upgrade()
                .ok_or_else(|| JsValue::from_str("Released Growth child"))?
                .borrow()
                .state(),
            None => return Err(JsValue::from_str("Unknown board child")),
        };
        HighDensityState(json!(state))
            .into_ts()
            .map_err(|error| JsError::new(&error.to_string()).into())
    }

    #[wasm_bindgen(js_name = setCacheCounts)]
    pub fn set_cache_counts(hits: f64, misses: f64) {
        set_cache_counts(hits, misses);
    }

    #[wasm_bindgen(js_name = stepInner)]
    pub fn step_inner(&mut self, iterations: usize, maximum: f64) -> Result<u8, JsValue> {
        let previous_child = self
            .solver
            .active_sub_solver
            .as_ref()
            .map(|child| child.id());
        self.solver.base.iterations = iterations;
        self.solver.base.max_iterations = maximum;
        self.run(false)?;
        let current_child = self
            .solver
            .active_sub_solver
            .as_ref()
            .map(|child| child.id());
        Ok(u8::from(self.solver.base.solved)
            + 2 * u8::from(self.solver.base.failed)
            + 4 * u8::from(previous_child != current_child))
    }

    pub fn solve(&mut self) -> Result<(), JsValue> {
        self.run(true)
    }

    #[wasm_bindgen(js_name = snapshot)]
    pub fn snapshot(&self) -> Result<Ts<HighDensityBoardSnapshot>, JsValue> {
        HighDensityBoardSnapshot(self.solver.snapshot().map_err(return_error)?)
            .into_ts()
            .map_err(|error| JsError::new(&error.to_string()).into())
    }

    #[wasm_bindgen(js_name = state)]
    pub fn state(&self) -> Result<Ts<HighDensityBoardState>, JsValue> {
        let mut state = serde_json::to_value(&self.solver.base)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        state["stats"] = self.solver.stats.clone();

        state["unsolvedNodeCount"] = json!(self.solver.unsolved_node_port_points.len());
        state["activeId"] = self
            .solver
            .active_sub_solver
            .as_ref()
            .map(|solver| json!(solver.id()))
            .unwrap_or(Value::Null);
        state["failedIds"] = json!(
            self.solver
                .failed_solvers
                .iter()
                .map(|solver| solver.id())
                .collect::<Vec<_>>()
        );
        HighDensityBoardState(state)
            .into_ts()
            .map_err(|error| JsError::new(&error.to_string()).into())
    }

    #[wasm_bindgen(js_name = routes)]
    pub fn routes(&self) -> Result<Ts<HighDensityRoutes>, JsValue> {
        HighDensityRoutes(self.solver.routes.clone())
            .into_ts()
            .map_err(|error| JsError::new(&error.to_string()).into())
    }

    #[wasm_bindgen(js_name = visualize)]
    pub fn visualize(&self) -> Result<Ts<HighDensityGraphics>, JsValue> {
        let transparentize = |color: &str, amount: f64| -> String {
            self.transparentize
                .call2(
                    &JsValue::UNDEFINED,
                    &JsValue::from_str(color),
                    &JsValue::from_f64(amount),
                )
                .expect("Visualization color callback failed")
                .as_string()
                .expect("Visualization color required")
        };
        let graphics = self
            .solver
            .visualize(&transparentize)
            .map_err(return_error)?;
        HighDensityGraphics(graphics)
            .into_ts()
            .map_err(|error| JsError::new(&error.to_string()).into())
    }

    #[wasm_bindgen(js_name = restore)]
    pub fn restore(&mut self, patch: Ts<HighDensityMappedValue>) -> Result<(), JsValue> {
        let patch = read_mapped_value(patch)?;
        if let Some(value) = patch.get("activeId") {
            self.solver.active_sub_solver = if value.is_null() {
                None
            } else {
                Some(
                    self.resolve_child(
                        value
                            .as_u64()
                            .ok_or_else(|| JsValue::from_str("activeId must be a handle"))?
                            as u32,
                    )?,
                )
            };
        }
        if let Some(value) = patch.get("failedIds") {
            let ids: Vec<u32> = serde_json::from_value(value.clone())
                .map_err(|error| JsValue::from_str(&error.to_string()))?;
            let mut failed = Vec::new();
            for id in ids {
                failed.push(self.resolve_child(id)?);
            }
            self.solver.failed_solvers = failed;
        }
        let s = &mut self.solver;
        macro_rules! field {
            ($key:literal,$name:ident) => {
                if let Some(value) = patch.get($key) {
                    s.$name = serde_json::from_value(value.clone())
                        .map_err(|error| JsValue::from_str(&error.to_string()))?;
                }
            };
        }
        macro_rules! base {
            ($key:literal,$name:ident) => {
                if let Some(value) = patch.get($key) {
                    s.base.$name = serde_json::from_value(value.clone())
                        .map_err(|error| JsValue::from_str(&error.to_string()))?;
                }
            };
        }
        base!("MAX_ITERATIONS", max_iterations);
        base!("iterations", iterations);
        base!("solved", solved);
        base!("failed", failed);
        base!("error", error);
        if let Some(value) = patch.get("progress") {
            s.base.progress = value.as_f64().unwrap_or(f64::NAN);
        }
        field!("unsolvedNodePortPoints", unsolved_node_port_points);
        field!("routes", routes);
        field!("colorMap", color_map);
        field!("obstacles", obstacles);
        field!("connMap", conn_map);
        field!("nodePfById", node_pf_by_id);
        field!("nodeSolveMetadataById", node_solve_metadata_by_id);
        field!("stats", stats);
        field!("viaDiameter", via_diameter);
        field!("traceWidth", trace_width);
        field!("obstacleMargin", obstacle_margin);
        field!("effort", effort);
        field!("layerCount", layer_count);
        field!("captureSearchDebug", capture_search_debug);
        field!(
            "useGrowShrinkHighDensityIntraNodeSolver",
            use_grow_shrink_high_density_intra_node_solver
        );
        field!("preserveTerminalPcbPortIds", preserve_terminal_pcb_port_ids);
        field!(
            "growShrinkMaxInnerIterationsPerGrowthAttempt",
            grow_shrink_max_inner_iterations_per_growth_attempt
        );
        field!(
            "growShrinkFallbackToInvalidGeometryOnFailure",
            grow_shrink_fallback_to_invalid_geometry_on_failure
        );
        Ok(())
    }
}

impl HighDensitySolver {
    fn resolve_child(&mut self, id: u32) -> Result<Box<dyn HighDensityNodeSolver>, JsValue> {
        if !self.children.contains_key(&id) {
            if let Some((callback, solver_type)) =
                SHARED_EXTERNAL.with(|registry| registry.borrow_mut().remove(&id))
            {
                let mut child = ExternalChild {
                    id,
                    callback,
                    solver_type,
                    node: Value::Null,
                    state: BaseSolverState::default(),
                    growth_attempts: None,
                };
                let state = child.call("state").map_err(return_error)?;
                child.solver_type = state["solverType"]
                    .as_str()
                    .ok_or_else(|| JsValue::from_str("External child solverType required"))?
                    .to_owned();
                child.growth_attempts = state["growthAttempts"].as_f64();
                child.state = serde_json::from_value(state)
                    .map_err(|error| JsValue::from_str(&error.to_string()))?;
                child.node = child.call("node").map_err(return_error)?;
                self.children
                    .insert(id, BoardChildReference::External(child.clone()));
                return Ok(Box::new(child));
            }
            if let Some(engine) = SHARED_GENERAL.with(|registry| registry.borrow_mut().remove(&id))
            {
                let node = engine.borrow().node.clone();
                self.children.insert(
                    id,
                    BoardChildReference::General(engine.clone(), node.clone()),
                );
                return Ok(Box::new(GeneralChild {
                    id,
                    engine,
                    node,
                    visualize: self.visualize.clone(),
                }));
            }
            if let Some(engine) = SHARED_GROWTH.with(|registry| registry.borrow_mut().remove(&id)) {
                let node = engine.borrow().solver.node_with_port_points.clone();
                self.children.insert(
                    id,
                    BoardChildReference::Growth(Rc::downgrade(&engine), node.clone()),
                );
                return Ok(Box::new(GrowthChild { id, engine, node }));
            }
            let engine = take_shared_portfolio(id).map_err(return_error)?;
            let node = engine.borrow().solver.node_with_port_points.clone();
            self.children.insert(
                id,
                BoardChildReference::Portfolio(Rc::downgrade(&engine), node.clone()),
            );
            return Ok(Box::new(PortfolioChild {
                id,
                engine,
                node,
                visualize: self.visualize.clone(),
            }));
        }
        match self.children.get(&id).unwrap() {
            BoardChildReference::External(child) => {
                let mut child = child.clone();
                child.state = serde_json::from_value(child.call("state").map_err(return_error)?)
                    .map_err(|error| JsValue::from_str(&error.to_string()))?;
                child.node = child.call("node").map_err(return_error)?;
                Ok(Box::new(child))
            }
            BoardChildReference::General(engine, node) => Ok(Box::new(GeneralChild {
                id,
                engine: engine.clone(),
                node: node.clone(),
                visualize: self.visualize.clone(),
            })),
            BoardChildReference::Portfolio(engine, node) => Ok(Box::new(PortfolioChild {
                id,
                engine: engine
                    .upgrade()
                    .ok_or_else(|| JsValue::from_str("Portfolio handle was released"))?,
                node: node.clone(),
                visualize: self.visualize.clone(),
            })),
            BoardChildReference::Growth(engine, node) => Ok(Box::new(GrowthChild {
                id,
                engine: engine
                    .upgrade()
                    .ok_or_else(|| JsValue::from_str("Growth handle was released"))?,
                node: node.clone(),
            })),
        }
    }

    fn run(&mut self, solve: bool) -> Result<(), JsValue> {
        let callback = &self.factory;
        let visualize = &self.visualize;
        let children = RefCell::new(&mut self.children);
        let mut factory = |_node: Value,
                           settings: &high_density_solver::HighDensitySolver|
         -> Result<Box<dyn HighDensityNodeSolver>, String> {
            let growth = settings.use_grow_shrink_high_density_intra_node_solver;
            let value = callback
                .call1(&JsValue::UNDEFINED, &JsValue::from_bool(growth))
                .map_err(error_text)?;
            let id = value
                .as_f64()
                .ok_or("HighDensity factory handle required")? as u32;
            if growth {
                let engine = SHARED_GROWTH
                    .with(|registry| registry.borrow_mut().remove(&id))
                    .ok_or("Unknown Growth handle")?;
                let node = engine.borrow().solver.node_with_port_points.clone();
                children.borrow_mut().insert(
                    id,
                    BoardChildReference::Growth(Rc::downgrade(&engine), node.clone()),
                );
                Ok(Box::new(GrowthChild { id, engine, node }))
            } else {
                let engine = take_shared_portfolio(id)?;
                let node = engine.borrow().solver.node_with_port_points.clone();
                children.borrow_mut().insert(
                    id,
                    BoardChildReference::Portfolio(Rc::downgrade(&engine), node.clone()),
                );
                Ok(Box::new(PortfolioChild {
                    id,
                    engine,
                    node,
                    visualize: visualize.clone(),
                }))
            }
        };
        loop {
            if solve && (self.solver.base.solved || self.solver.base.failed) {
                break;
            }
            let previous = self
                .solver
                .active_sub_solver
                .as_ref()
                .map(|child| child.id());
            let result = if solve {
                self.solver.step(&mut factory, &mut cache_stats)
            } else {
                self.solver._step(&mut factory, &mut cache_stats)
            };
            result.map_err(return_error)?;
            if let Some(id) = previous
                && self
                    .solver
                    .active_sub_solver
                    .as_ref()
                    .map(|child| child.id())
                    != Some(id)
                && let Some(callback) = &self.completed
            {
                let failed = self
                    .solver
                    .failed_solvers
                    .iter()
                    .any(|child| child.id() == id);
                let state = if let Some(BoardChildReference::General(engine, _)) =
                    children.borrow().get(&id)
                {
                    callback_output(&json!(engine.borrow().state)).map_err(return_error)?
                } else {
                    JsValue::UNDEFINED
                };
                callback.call4(
                    &JsValue::UNDEFINED,
                    &JsValue::from_f64(id as f64),
                    &JsValue::from_bool(failed),
                    &state,
                    &JsValue::from_f64(self.solver.routes.len() as f64),
                )?;
            }
            if !solve {
                break;
            }
        }
        Ok(())
    }
}
