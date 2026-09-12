use capacity_autorouter::solvers::hyper_high_density_solver::portfolio_single_intra_node_solver as portfolio_solver;
use std::{cell::RefCell, collections::HashMap, rc::Rc};
use serde_json::Value;
use serde::{Serialize, Serializer};
use tsify::{Ts, Tsify};
use crate::bindings::high_density_wire::*;
use wasm_bindgen::prelude::*;
use capacity_autorouter::solvers::hyper_parameter_supervisor_solver::{Candidate, CandidateFactory, CandidateState};

use crate::Engine;

type General = crate::GeneralState;

enum SharedEngine {
    PendingGeneral,
    HighDensity(Rc<RefCell<Engine>>),
    General(Rc<RefCell<General>>),
    Specialized(Rc<RefCell<capacity_autorouter::bindings::high_density::specialized_solver::SpecializedEngine>>),
}

thread_local! {
    static SHARED_ENGINES: RefCell<(u32, HashMap<u32, SharedEngine>)> = RefCell::new((0, HashMap::new()));
}

fn share(engine: SharedEngine) -> u32 {
    SHARED_ENGINES.with(|registry| {
        let mut registry = registry.borrow_mut();
        let id = registry.0;
        registry.0 = registry.0.checked_add(1).expect("Native engine handle overflow");
        registry.1.insert(id, engine);
        id
    })
}

pub(crate) fn share_high_density(engine: Rc<RefCell<Engine>>) -> u32 {
    share(SharedEngine::HighDensity(engine))
}

pub(crate) fn share_general(engine: Rc<RefCell<General>>) -> u32 {
    share(SharedEngine::General(engine))
}

pub(crate) fn take_shared_general(id: u32) -> Result<Rc<RefCell<General>>, String> {
    SHARED_ENGINES.with(|registry| {
        let mut registry = registry.borrow_mut();
        if !matches!(registry.1.get(&id), Some(SharedEngine::General(_))) {
            return Err(format!("Unknown shared general engine handle: {id}"));
        }
        match registry.1.remove(&id) {
            Some(SharedEngine::General(engine)) => Ok(engine),
            _ => unreachable!("Shared general handle was checked under the same borrow"),
        }
    })
}

pub(crate) fn share_specialized(engine: Rc<RefCell<capacity_autorouter::bindings::high_density::specialized_solver::SpecializedEngine>>) -> u32 {
    share(SharedEngine::Specialized(engine))
}

#[derive(Clone)]
struct Hooks {
    factory: js_sys::Function,
    external: js_sys::Function,
    cache: js_sys::Function,
    error: Rc<RefCell<Option<JsValue>>>,
}

impl Hooks {
    fn parse_call(&self, result: Result<JsValue, JsValue>) -> Result<Value, String> {
        let result = result.map_err(|error| {
            *self.error.borrow_mut() = Some(error);
            "High-density portfolio callback failed".to_owned()
        })?;
        callback_value(result)
    }

    fn external_state(&self, id: usize, action: &str, count: usize) -> Result<CandidateState, String> {
        let result = self.external.call3(&JsValue::UNDEFINED, &JsValue::from_f64(id as f64), &JsValue::from_str(action), &JsValue::from_f64(count as f64));
        read_state(&self.parse_call(result)?)
    }

    fn cache_action(&self, id: usize, action: &str, state: &CandidateState) -> Result<Value, String> {
        let state = callback_output(&serde_json::to_value(state).map_err(|error| error.to_string())?)?;
        let result = self.parse_call(self.cache.call3(&JsValue::UNDEFINED, &JsValue::from_f64(id as f64), &JsValue::from_str(action), &state))?;
        if let (Some(hits), Some(misses)) = (result["cacheHits"].as_f64(), result["cacheMisses"].as_f64()) {
            crate::bindings::high_density_orchestration::set_cache_counts(hits, misses);
        }
        Ok(result)
    }
}

fn read_state(value: &Value) -> Result<CandidateState, String> {
    Ok(CandidateState {
        iterations: value["iterations"].as_u64().ok_or("Candidate iterations required")? as usize,
        max_iterations: value["maxIterations"].as_f64().ok_or("Candidate maxIterations required")?,
        solved: value["solved"].as_bool().ok_or("Candidate solved required")?,
        failed: value["failed"].as_bool().ok_or("Candidate failed required")?,
        progress: value["progress"].as_f64().unwrap_or(f64::NAN),
        error: value["error"].as_str().map(str::to_owned),
        solved_segment_count: value["solvedSegmentCount"].as_u64().map(|count| count as usize),
    })
}

struct PortfolioCandidate {
    id: usize,
    engine: SharedEngine,
    state: CandidateState,
    hooks: Hooks,
    has_cache: bool,
    cache_checked: bool,
    kind: String,
    total_connections: usize,
}

impl PortfolioCandidate {
    fn step_general(&mut self) -> Result<(), String> {
        if self.has_cache && !self.cache_checked {
            self.cache_checked = true;
            let result = self.hooks.cache_action(self.id, "lookup", &self.state)?;
            if result["hit"] == true {
                self.state = read_state(&result["state"])?;
                let routes = result["routes"].as_array().ok_or("Cached General routes required")?;
                if let SharedEngine::General(engine) = &self.engine {
                    let routes = serde_json::from_value(Value::Array(routes.clone())).map_err(|error| error.to_string())?;
                    engine.borrow_mut().set_cached_output(routes, self.state.solved, self.state.failed, self.state.error.clone());
                }
                self.state.progress = routes.len() as f64 / self.total_connections as f64;
                return Ok(());
            }
        }
        if matches!(&self.engine, SharedEngine::PendingGeneral) {
            let result = self.hooks.external.call3(&JsValue::UNDEFINED, &JsValue::from_f64(self.id as f64),
                &JsValue::from_str("attach-general"), &JsValue::from_f64(0.0));
            let descriptor = self.hooks.parse_call(result)?;
            let handle = descriptor["handle"].as_u64().ok_or("Attached General handle required")? as u32;
            let engine = SHARED_ENGINES.with(|registry| registry.borrow_mut().1.remove(&handle))
                .ok_or("Attached General handle not found")?;
            if !matches!(&engine, SharedEngine::General(_)) { return Err("Attached General handle has wrong engine kind".into()); }
            self.engine = engine;
        }
        let SharedEngine::General(engine) = &self.engine else { return Err("General candidate requires a General engine".into()); };
        {
            let mut state = engine.borrow_mut();
            state.step_inner(self.state.iterations);
            let engine = state.ensure_initialized();
            self.state.solved = engine.solved;
            self.state.failed = engine.failed;
            self.state.error = engine.error.clone();
            self.state.progress = engine.solved_routes.len() as f64 / engine.total_connections as f64;
        }
        if self.has_cache && (self.state.solved || self.state.failed) {
            self.hooks.cache_action(self.id, "save", &self.state)?;
        }
        if !self.state.solved && self.state.iterations as f64 > self.state.max_iterations {
            self.state.failed = true;
            self.state.error = Some(format!("CachedIntraNodeRouteSolver ran out of iterations (MAX_ITERATIONS={})", capacity_autorouter::utils::js_number::js_number_to_string(self.state.max_iterations)));
        }
        Ok(())
    }
}

impl Candidate for PortfolioCandidate {
    fn state(&self) -> &CandidateState { &self.state }

    fn set_state(&mut self, state: CandidateState) -> Result<(), String> {
        let SharedEngine::Specialized(engine) = &self.engine else {
            return Err("Mutable candidate state requires a specialized engine".into());
        };
        let mut engine = engine.borrow_mut();
        let base = engine.solver_mut().base_mut();
        base.iterations = state.iterations;
        base.max_iterations = state.max_iterations;
        base.solved = state.solved;
        base.failed = state.failed;
        base.error = state.error.clone();
        base.progress = state.progress;
        self.state = state;
        Ok(())
    }

    fn is_specialized(&self) -> bool { matches!(self.kind.as_str(), "a01" | "a03") }

    fn setup(&mut self) -> Result<(), String> {
        if let SharedEngine::HighDensity(engine) = &self.engine {
            match &mut *engine.borrow_mut() {
                Engine::A01(engine) => {
                    engine.max_iterations = self.state.max_iterations as usize;
                    engine.setup();
                    self.state.max_iterations = engine.max_iterations as f64;
                    self.state.solved = engine.solved;
                    self.state.failed = engine.failed;
                    self.state.error = engine.error.clone();
                    self.state.solved_segment_count = Some(engine.solved_segment_count());
                }
                Engine::A03(engine) => {
                    engine.max_iterations = self.state.max_iterations as usize;
                    engine.setup();
                    self.state.max_iterations = engine.max_iterations as f64;
                    self.state.solved = engine.solved;
                    self.state.failed = engine.failed;
                    self.state.error = engine.error.clone();
                    self.state.solved_segment_count = Some(engine.solved_segment_count());
                }
            }
        }
        Ok(())
    }

    fn step(&mut self) -> Result<(), String> {
        if self.state.solved || self.state.failed { return Ok(()); }
        self.state.iterations += 1;
        match &self.engine {
            SharedEngine::PendingGeneral | SharedEngine::General(_) => {
                self.step_general()?;
            }
            SharedEngine::Specialized(engine) => {
                let mut engine = engine.borrow_mut();
                let solver = engine.solver_mut();
                solver.base_mut().iterations = self.state.iterations - 1;
                solver.base_mut().max_iterations = self.state.max_iterations;
                let result = solver.step();
                let state = solver.base();
                self.state.iterations = state.iterations;
                self.state.max_iterations = state.max_iterations;
                self.state.solved = state.solved;
                self.state.failed = state.failed;
                self.state.error = state.error.clone();
                self.state.progress = state.progress;
                result?;
            }
            SharedEngine::HighDensity(engine) => {
                match &mut *engine.borrow_mut() {
                    Engine::A01(engine) => {
                        engine.iterations = self.state.iterations;
                        engine.max_iterations = self.state.max_iterations as usize;
                        engine.step();
                        self.state.solved = engine.solved;
                        self.state.failed = engine.failed;
                        self.state.error = engine.error.clone();
                        self.state.solved_segment_count = Some(engine.solved_segment_count());
                    }
                    Engine::A03(engine) => {
                        engine.iterations = self.state.iterations;
                        engine.max_iterations = self.state.max_iterations as usize;
                        engine.step();
                        self.state.solved = engine.solved;
                        self.state.failed = engine.failed;
                        self.state.error = engine.error.clone();
                        self.state.solved_segment_count = Some(engine.solved_segment_count());
                    }
                }
                if !self.state.solved && self.state.iterations as f64 >= self.state.max_iterations {
                    self.state.failed = true;
                    self.state.error = Some(format!("{} ran out of iterations", if self.kind == "a01" { "HighDensitySolverA01" } else { "HighDensitySolverA03" }));
                }
            }
        }
        Ok(())
    }
}

struct SnapshotCandidate {
    state: CandidateState,
    specialized: bool,
}

impl Candidate for SnapshotCandidate {
    fn state(&self) -> &CandidateState { &self.state }
    fn is_specialized(&self) -> bool { self.specialized }
    fn step(&mut self) -> Result<(), String> { Err("Snapshot candidate cannot step".to_owned()) }
}

struct ExternalCandidate {
    id: usize,
    state: CandidateState,
    hooks: Hooks,
}

impl Candidate for ExternalCandidate {
    fn state(&self) -> &CandidateState { &self.state }

    fn setup(&mut self) -> Result<(), String> {
        self.state = self.hooks.external_state(self.id, "setup", 0)?;
        Ok(())
    }

    fn step(&mut self) -> Result<(), String> {
        self.state = self.hooks.external_state(self.id, "step", 1)?;
        Ok(())
    }
    fn step_many(&mut self, count: usize) -> Result<(), String> {
        self.state = self.hooks.external_state(self.id, "step", count)?;
        Ok(())
    }

}

struct Factory { hooks: Hooks }

impl CandidateFactory for Factory {
    fn generate(&mut self, hyper_parameters: &Value) -> Result<Box<dyn Candidate>, String> {
        let parameters = callback_output(hyper_parameters)?;
        let descriptor = self.hooks.parse_call(self.hooks.factory.call1(&JsValue::UNDEFINED, &parameters))?;
        let id = descriptor["id"].as_u64().ok_or("Candidate id required")? as usize;
        let state = read_state(&descriptor["state"])?;
        let kind = descriptor["kind"].as_str().ok_or("Candidate kind required")?;
        if kind == "external" {
            return Ok(Box::new(ExternalCandidate { id, state, hooks: self.hooks.clone() }));
        }
        let engine = if kind == "general" && descriptor.get("handle").is_none_or(Value::is_null) {
            SharedEngine::PendingGeneral
        } else {
            let handle = descriptor["handle"].as_u64().ok_or("Native candidate handle required")? as u32;
            let engine = SHARED_ENGINES.with(|registry| registry.borrow_mut().1.remove(&handle)).ok_or("Native candidate handle not found")?;
            match (&engine, kind) {
                (SharedEngine::General(_), "general") | (SharedEngine::HighDensity(_), "a01" | "a03")
                | (SharedEngine::Specialized(_), "specialized") => {}
                _ => return Err("Native candidate handle has wrong engine kind".into()),
            }
            engine
        };
        let total_connections = if kind == "general" {
            descriptor["totalConnections"].as_u64().ok_or("General candidate totalConnections required")? as usize
        } else { 0 };
        Ok(Box::new(PortfolioCandidate { id, engine, state, hooks: self.hooks.clone(), total_connections,
            has_cache: descriptor["hasCache"].as_bool().unwrap_or(false), cache_checked: false, kind: kind.to_owned() }))
    }
}

fn serialize_json_number<S: Serializer>(value: &f64, serializer: S) -> Result<S::Ok, S::Error> {
    if value.is_finite() { serializer.serialize_f64(*value) }
    else { serializer.serialize_none() }
}

#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct CandidateStateSnapshot {
    iterations: usize,
    #[serde(serialize_with = "serialize_json_number")]
    max_iterations: f64,
    solved: bool,
    failed: bool,
    #[serde(serialize_with = "serialize_json_number")]
    #[tsify(type = "number | null")]
    progress: f64,
    error: Option<String>,
    solved_segment_count: Option<usize>,
}

#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct CandidateSnapshot {
    id: usize,
    #[tsify(type = "Record<string, unknown>")]
    hyper_parameters: Value,
    #[serde(serialize_with = "serialize_json_number")]
    g: f64,
    #[serde(serialize_with = "serialize_json_number")]
    h: f64,
    #[serde(serialize_with = "serialize_json_number")]
    f: f64,
    state: CandidateStateSnapshot,
}

#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotStats {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(type = "unknown")]
    dynamic_expansion_work_budget: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(type = "unknown")]
    dynamic_supervisor_iteration_limit: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(type = "unknown")]
    adaptive_search_expanded: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(type = "unknown")]
    adaptive_search_expanded_at_iteration: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(type = "unknown")]
    candidate_work_at_expansion: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(type = "unknown")]
    best_progress_at_expansion: Option<Value>,
}

#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioSnapshot {
    iterations: usize,
    #[serde(serialize_with = "serialize_json_number")]
    #[tsify(type = "number | null")]
    progress: f64,
    solved: bool,
    failed: bool,
    error: Option<String>,
    #[serde(rename = "MAX_ITERATIONS", serialize_with = "serialize_json_number")]
    max_iterations: f64,
    stats: SnapshotStats,
    adaptive_search_expanded: bool,
    active_id: Option<usize>,
    winner_id: Option<usize>,
    order: Vec<usize>,
    candidates: Vec<CandidateSnapshot>,
}

pub(crate) struct PortfolioCore {
    pub(crate) solver: portfolio_solver::PortfolioSingleIntraNodeSolver,
    factory: Factory,
    terminal: Option<js_sys::Function>,
    pub(crate) output_routes: Vec<Value>,
    pub(crate) resolved_solver_type: String,
    output_completed: bool,
}

thread_local! {
    static ORCHESTRATION_HANDLE: std::cell::Cell<u32> = const { std::cell::Cell::new(0) };
    static SHARED_PORTFOLIOS: RefCell<HashMap<u32, Rc<RefCell<PortfolioCore>>>> = RefCell::new(HashMap::new());
}

pub(crate) fn allocate_orchestration_handle() -> u32 {
    ORCHESTRATION_HANDLE.with(|counter| {
        let id = counter.get();
        counter.set(id.checked_add(1).expect("Orchestration handle overflow"));
        id
    })
}

pub(crate) fn take_shared_portfolio(id: u32) -> Result<Rc<RefCell<PortfolioCore>>, String> {
    let engine = SHARED_PORTFOLIOS.with(|registry| registry.borrow_mut().remove(&id))
        .ok_or_else(|| format!("Unknown shared portfolio handle: {id}"))?;
    if engine.borrow().terminal.is_none() {
        return Err("Orchestrated portfolio requires a terminal output callback".into());
    }
    Ok(engine)
}

impl PortfolioCore {
    pub(crate) fn state(&self) -> capacity_autorouter::bindings::high_density::specialized_base_solver::BaseSolverState {
        capacity_autorouter::bindings::high_density::specialized_base_solver::BaseSolverState {
            iterations: self.solver.iterations, max_iterations: self.solver.max_iterations,
            solved: self.solver.supervisor.solved, failed: self.solver.supervisor.failed,
            progress: self.solver.progress, error: self.solver.supervisor.error.clone(),
        }
    }

    pub(crate) fn step_inner(&mut self, iterations: usize) -> Result<(), JsValue> {
        self.solver.iterations = iterations;
        self.solver.step_inner(&mut self.factory)
            .map_err(|error| self.factory.hooks.error.borrow_mut().take().unwrap_or_else(|| JsValue::from_str(&error)))?;
        self.complete_terminal()
    }

    fn complete_terminal(&mut self) -> Result<(), JsValue> {
        if (self.solver.supervisor.solved || self.solver.supervisor.failed) && !self.output_completed {
            if let Some(terminal) = &self.terminal {
                self.output_completed = true;
                let snapshot = self.snapshot()?;
                let result = terminal.call1(&JsValue::UNDEFINED, &snapshot.js_value())?;
                let mut result = callback_value(result).map_err(|error| JsValue::from_str(&error))?;
                self.output_routes = if self.solver.supervisor.solved {
                    let routes = result.get_mut("routes").and_then(Value::as_array_mut)
                        .ok_or_else(|| JsValue::from_str("Portfolio terminal routes required"))?;
                    std::mem::take(routes)
                } else { Vec::new() };
                self.resolved_solver_type = result["solverType"].as_str().ok_or_else(|| JsValue::from_str("Portfolio terminal solverType required"))?.to_owned();
            }
        }
        Ok(())
    }

    pub(crate) fn step(&mut self) -> Result<(), JsValue> {
        if self.solver.supervisor.solved || self.solver.supervisor.failed { return Ok(()); }
        let iterations = self.solver.iterations + 1;
        if let Err(error) = self.step_inner(iterations) {
            let text = error.as_string().unwrap_or_else(|| format!("{error:?}"));
            self.solver.supervisor.error = Some(format!("portfolio_solver::PortfolioSingleIntraNodeSolver error: {text}"));
            self.solver.supervisor.failed = true;
            // Notify the host of failure without replacing the original JS exception.
            let _cleanup_result = self.complete_terminal();
            return Err(error);
        }
        if !self.solver.supervisor.solved && iterations as f64 > self.solver.max_iterations {
            self.solver.supervisor.failed = true;
            self.solver.supervisor.error = Some(format!("portfolio_solver::PortfolioSingleIntraNodeSolver ran out of iterations (MAX_ITERATIONS={})", capacity_autorouter::utils::js_number::js_number_to_string(self.solver.max_iterations)));
        }
        self.complete_terminal()
    }

    pub(crate) fn reject_solution(&mut self, error: &str) {
        self.solver.supervisor.solved = false;
        self.solver.supervisor.failed = true;
        self.solver.supervisor.error = Some(error.to_owned());
    }

    pub(crate) fn set_max_iterations(&mut self, maximum: f64) {
        self.solver.max_iterations = maximum;
    }

    pub(crate) fn snapshot(&self) -> Result<Ts<PortfolioSnapshot>, JsValue> {
        let supervisor = &self.solver.supervisor;
        let records = supervisor.supervised_solvers.as_deref().unwrap_or(&[]);
        let order: Vec<_> = records.iter().map(|record| record.id).collect();
        let candidates: Vec<_> = records.iter().map(|record| {
            let state = record.solver.state();
            CandidateSnapshot { id: record.id, hyper_parameters: record.hyper_parameters.clone(),
                g: record.g, h: record.h, f: record.f,
                state: CandidateStateSnapshot { iterations: state.iterations, max_iterations: state.max_iterations,
                    solved: state.solved, failed: state.failed, progress: state.progress,
                    error: state.error.clone(), solved_segment_count: state.solved_segment_count } }
        }).collect();
        let stats = &self.solver.stats;
        let snapshot = PortfolioSnapshot { iterations: self.solver.iterations, progress: self.solver.progress, solved: supervisor.solved, failed: supervisor.failed, error: supervisor.error.clone(),
            max_iterations: self.solver.max_iterations,
            stats: SnapshotStats {
                dynamic_expansion_work_budget: stats.get("dynamicExpansionWorkBudget").cloned(),
                dynamic_supervisor_iteration_limit: stats.get("dynamicSupervisorIterationLimit").cloned(),
                adaptive_search_expanded: stats.get("adaptiveSearchExpanded").cloned(),
                adaptive_search_expanded_at_iteration: stats.get("adaptiveSearchExpandedAtIteration").cloned(),
                candidate_work_at_expansion: stats.get("candidateWorkAtExpansion").cloned(),
                best_progress_at_expansion: stats.get("bestProgressAtExpansion").cloned(),
            },
            adaptive_search_expanded: self.solver.adaptive_search_expanded,
            active_id: supervisor.active_sub_solver, winner_id: supervisor.winning_solver, order, candidates };
        snapshot.into_ts()
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }
}

#[wasm_bindgen]
pub struct PortfolioSingleIntraNodeSolver {
    pub(crate) engine: Rc<RefCell<PortfolioCore>>,
}

#[wasm_bindgen]
impl PortfolioSingleIntraNodeSolver {
    #[wasm_bindgen(constructor)]
    pub fn new(node: Ts<HighDensityValue>, effort: f64,
        #[wasm_bindgen(unchecked_param_type = "(hyperParameters: Record<string, unknown>) => Record<string, unknown>")] factory: js_sys::Function,
        #[wasm_bindgen(unchecked_param_type = "(id: number, action: 'setup' | 'step' | 'attach-general', count: number) => CandidateStateSnapshot | { handle: number }")] external: js_sys::Function,
        #[wasm_bindgen(unchecked_param_type = "(id: number, action: 'lookup' | 'save', state: CandidateStateSnapshot) => Record<string, unknown>")] cache: js_sys::Function,
        #[wasm_bindgen(unchecked_param_type = "((state: PortfolioSnapshot) => { routes: unknown[]; solverType: string }) | undefined")] terminal: Option<js_sys::Function>) -> Result<Self, JsValue> {
        let node = read_value(node)?;
        let hooks = Hooks { factory, external, cache, error: Rc::new(RefCell::new(None)) };
        Ok(Self { engine: Rc::new(RefCell::new(PortfolioCore { solver: portfolio_solver::PortfolioSingleIntraNodeSolver::new(node, effort), factory: Factory { hooks }, terminal, output_routes: Vec::new(), resolved_solver_type: "portfolio_solver::PortfolioSingleIntraNodeSolver".into(), output_completed: false })) })
    }

    pub fn step(&mut self, iterations: usize) -> Result<u8, JsValue> {
        let mut core = self.engine.borrow_mut();
        core.step_inner(iterations)?;
        Ok(u8::from(core.solver.supervisor.solved) + 2 * u8::from(core.solver.supervisor.failed))
    }

    pub fn configure(&mut self, greedy_multiplier: f64, min_substeps: f64) {
        let mut core = self.engine.borrow_mut();

        core.solver.supervisor.greedy_multiplier = greedy_multiplier;
        core.solver.supervisor.min_substeps = min_substeps.ceil() as usize;
    }

    #[wasm_bindgen(js_name = setCandidateState)]
    pub fn set_candidate_state(&mut self, id: usize, state: Ts<HighDensityValue>) -> Result<(), JsValue> {
        let mut core = self.engine.borrow_mut();

        let value: Value = read_value(state)?;
        let state = read_state(&value).map_err(|error| JsValue::from_str(&error))?;
        let record = core.solver.supervisor.supervised_solvers.as_mut()
            .and_then(|records| records.iter_mut().find(|record| record.id == id))
            .ok_or_else(|| JsValue::from_str("Unknown candidate"))?;
        record.solver.set_state(state).map_err(|error| JsValue::from_str(&error))
    }

    #[wasm_bindgen(js_name = computeF)]
    pub fn compute_f(g: f64, h: f64, greedy_multiplier: f64) -> f64 {
        g + h * greedy_multiplier
    }

    #[wasm_bindgen(js_name = maxIterations)]
    pub fn max_iterations(&self) -> f64 {
        let core = self.engine.borrow();
        core.solver.max_iterations
    }

    pub fn initialize(&mut self) -> Result<(), JsValue> {
        let mut core = self.engine.borrow_mut();
        let core = &mut *core;
        core.solver.initialize_solvers(&mut core.factory)
            .map_err(|error| core.factory.hooks.error.borrow_mut().take().unwrap_or_else(|| JsValue::from_str(&error)))
    }

    #[wasm_bindgen(js_name = getHyperParameterDefs)]
    pub fn get_hyper_parameter_defs() -> Result<Ts<PortfolioHyperParameterDefinitions>, JsValue> {
        let defs: Vec<_> = capacity_autorouter::solvers::hyper_high_density_solver::portfolio_single_intra_node_solver::get_hyper_parameter_defs().into_iter()
            .map(|def| serde_json::json!({"name":def.name,"possibleValues":def.possible_values})).collect();
        PortfolioHyperParameterDefinitions(defs).into_ts().map_err(|error| JsError::new(&error.to_string()).into())
    }

    #[wasm_bindgen(js_name = getCombinationDefs)]
    pub fn get_combination_defs() -> Result<Ts<PortfolioCombinationDefinitions>, JsValue> {
        PortfolioCombinationDefinitions(serde_json::json!(capacity_autorouter::solvers::hyper_high_density_solver::portfolio_single_intra_node_solver::get_combination_defs())).into_ts().map_err(|error| JsError::new(&error.to_string()).into())
    }

    #[wasm_bindgen(js_name = getHyperParameterCombinations)]
    pub fn get_hyper_parameter_combinations(definitions: Ts<HighDensityValue>) -> Result<Ts<PortfolioHyperParameters>, JsValue> {
        fn combinations(defs: &[Value]) -> Vec<Value> {
            let Some((first, remaining)) = defs.split_first() else { return vec![serde_json::json!({})]; };
            let sub = combinations(remaining);
            let mut output = Vec::new();
            for value in first["possibleValues"].as_array().expect("Hyperparameter values required") {
                for combination in &sub {
                    let mut result = combination.clone();
                    for (key, value) in value.as_object().expect("Hyperparameter object required") { result[key] = value.clone(); }
                    output.push(result);
                }
            }
            output
        }
        let defs: Vec<Value> = serde_json::from_value(read_value(definitions)?).map_err(|error| JsValue::from_str(&error.to_string()))?;
        PortfolioHyperParameters(combinations(&defs)).into_ts().map_err(|error| JsError::new(&error.to_string()).into())
    }

    #[wasm_bindgen(js_name = bestCandidateId)]
    pub fn best_candidate_id(&self) -> Option<usize> {
        let core = self.engine.borrow();

        let index = core.solver.supervisor.get_supervised_solver_with_best_fitness()?;
        Some(core.solver.supervisor.supervised_solvers.as_ref().unwrap()[index].id)
    }

    #[wasm_bindgen(js_name = failureMessage)]
    pub fn failure_message(&mut self) -> String {
        let mut core = self.engine.borrow_mut();
        core.solver.supervisor.get_failure_message()
    }

    #[wasm_bindgen(js_name = computeCandidateG)]
    pub fn compute_candidate_g(state: Ts<HighDensityValue>, hyper_parameters: Ts<HighDensityValue>, specialized: bool) -> Result<f64, JsValue> {
        let state: Value = read_value(state)?;
        let hyper_parameters = read_value(hyper_parameters)?;
        let candidate = SnapshotCandidate { state: read_state(&state).map_err(|error| JsValue::from_str(&error))?, specialized };
        Ok(portfolio_solver::PortfolioSingleIntraNodeSolver::compute_g(&candidate, &hyper_parameters))
    }

    #[wasm_bindgen(js_name = computeCandidateH)]
    pub fn compute_candidate_h(state: Ts<HighDensityValue>, node: Ts<HighDensityValue>, expanded: bool) -> Result<f64, JsValue> {
        let state: Value = read_value(state)?;
        let candidate = SnapshotCandidate { state: read_state(&state).map_err(|error| JsValue::from_str(&error))?, specialized: false };
        if expanded {
            let node = read_value(node)?;
            let solver = portfolio_solver::PortfolioSingleIntraNodeSolver::new(node, 1.0);
            Ok(1.0 - portfolio_solver::PortfolioSingleIntraNodeSolver::get_candidate_progress(&candidate, solver.get_node_segment_count()))
        } else {
            let progress = candidate.state.progress;
            Ok(1.0 - if progress == 0.0 || progress.is_nan() { 0.0 } else { progress })
        }
    }

    #[wasm_bindgen(js_name = computeG)]
    pub fn compute_g(&self, id: usize) -> Result<f64, JsValue> {
        let core = self.engine.borrow();

        let record = core.solver.supervisor.supervised_solvers.as_deref().unwrap_or(&[]).iter().find(|record| record.id == id)
            .ok_or_else(|| JsValue::from_str("Unknown candidate"))?;
        Ok(portfolio_solver::PortfolioSingleIntraNodeSolver::compute_g(record.solver.as_ref(), &record.hyper_parameters))
    }

    #[wasm_bindgen(js_name = computeH)]
    pub fn compute_h(&self, id: usize) -> Result<f64, JsValue> {
        let core = self.engine.borrow();

        let record = core.solver.supervisor.supervised_solvers.as_deref().unwrap_or(&[]).iter().find(|record| record.id == id)
            .ok_or_else(|| JsValue::from_str("Unknown candidate"))?;
        if core.solver.adaptive_search_expanded {
            Ok(1.0 - portfolio_solver::PortfolioSingleIntraNodeSolver::get_candidate_progress(record.solver.as_ref(), core.solver.get_node_segment_count()))
        } else {
            let progress = record.solver.state().progress;
            Ok(1.0 - if progress == 0.0 || progress.is_nan() { 0.0 } else { progress })
        }
    }

    pub fn snapshot(&self) -> Result<Ts<PortfolioSnapshot>, JsValue> {
        self.engine.borrow().snapshot()
    }

    #[wasm_bindgen(js_name = restoreState)]
    pub fn restore_state(&mut self, state: Ts<HighDensityValue>) -> Result<(), JsValue> {
        let state: Value = read_value(state)?;
        let mut core = self.engine.borrow_mut();
        if let Some(value) = state.get("iterations") { core.solver.iterations = value.as_u64().ok_or_else(|| JsValue::from_str("Portfolio iterations required"))? as usize; }
        if let Some(value) = state.get("MAX_ITERATIONS") { core.solver.max_iterations = value.as_f64().unwrap_or(f64::NAN); }
        if let Some(value) = state.get("progress") { core.solver.progress = value.as_f64().unwrap_or(f64::NAN); }
        if let Some(value) = state.get("solved") { core.solver.supervisor.solved = value.as_bool().ok_or_else(|| JsValue::from_str("Portfolio solved must be boolean"))?; }
        if let Some(value) = state.get("failed") { core.solver.supervisor.failed = value.as_bool().ok_or_else(|| JsValue::from_str("Portfolio failed must be boolean"))?; }
        if let Some(value) = state.get("error") { core.solver.supervisor.error = value.as_str().map(str::to_owned); }
        if let Some(value) = state.get("stats") { core.solver.stats = value.clone(); }
        if let Some(value) = state.get("GREEDY_MULTIPLIER") { core.solver.supervisor.greedy_multiplier = value.as_f64().unwrap_or(f64::NAN); }
        if let Some(value) = state.get("MIN_SUBSTEPS") { core.solver.supervisor.min_substeps = value.as_f64().unwrap_or(f64::NAN).ceil() as usize; }
        if let Some(value) = state.get("solvedRoutes") { core.output_routes = value.as_array().ok_or_else(|| JsValue::from_str("Portfolio routes must be an array"))?.clone(); }
        if !core.solver.supervisor.solved && !core.solver.supervisor.failed { core.output_completed = false; }
        Ok(())
    }

    #[wasm_bindgen(js_name = shareForOrchestration)]
    pub fn share_for_orchestration(&self) -> u32 {
        SHARED_PORTFOLIOS.with(|registry| {
            let mut registry = registry.borrow_mut();
            let id = allocate_orchestration_handle();
            registry.insert(id, self.engine.clone());
            id
        })
    }
}

#[derive(Serialize, Tsify)]
#[serde(transparent)]
pub struct PortfolioHyperParameterDefinitions(#[tsify(type = "{ name: string; possibleValues: Record<string, unknown>[] }[]")] Vec<Value>);

#[derive(Serialize, Tsify)]
#[serde(transparent)]
pub struct PortfolioCombinationDefinitions(#[tsify(type = "string[][]")] Value);

#[derive(Serialize, Tsify)]
#[serde(transparent)]
pub struct PortfolioHyperParameters(#[tsify(type = "Record<string, unknown>[]")] Vec<Value>);
