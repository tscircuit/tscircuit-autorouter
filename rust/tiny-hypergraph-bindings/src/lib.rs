#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
#[global_allocator]
static ALLOCATOR: module_allocator::ModuleAllocator = module_allocator::ModuleAllocator::new();

use serde::{Deserialize, Serialize};
use std::ops::{Deref, DerefMut};
use tiny_hypergraph::{OutsideInPartialRipTinyHyperGraphSolver, SelectiveReripTinyHyperGraphSolver};
use tiny_hypergraph::{
    TinyHyperGraphProblem, TinyHyperGraphSolverOptions,
    TinyHyperGraphTopology,
};
use wasm_bindgen::prelude::*;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SolverStatus<'a> {
    solved: bool,
    failed: bool,
    error: Option<&'a str>,
    iterations: usize,
    pending_route_count: usize,
    rip_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RoutingSnapshot<'a> {
    port_assignment: &'a [i32],
    region_segments: &'a [Vec<(i32, i32, i32)>],
    current_route_id: Option<i32>,
    unrouted_routes: &'a [i32],
}

#[derive(Clone, Serialize)]
#[serde(untagged)]
enum StatsPathPart<'a> {
    Key(&'a str),
    Index(usize),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StatsSnapshot<'a> {
    stats: &'a serde_json::Value,
    undefined_paths: Vec<Vec<StatsPathPart<'a>>>,
}

fn collect_undefined_stats<'a>(
    value: &'a serde_json::Value,
    path: &mut Vec<StatsPathPart<'a>>,
    paths: &mut Vec<Vec<StatsPathPart<'a>>>,
) {
    match value {
        serde_json::Value::Null => paths.push(path.clone()),
        serde_json::Value::Array(values) => {
            for (index, value) in values.iter().enumerate() {
                path.push(StatsPathPart::Index(index));
                collect_undefined_stats(value, path, paths);
                path.pop();
            }
        }
        serde_json::Value::Object(values) => {
            for (key, value) in values {
                path.push(StatsPathPart::Key(key));
                collect_undefined_stats(value, path, paths);
                path.pop();
            }
        }
        _ => {}
    }
}

/// Owns one solver; generated bindings provide free() for deterministic disposal.
#[wasm_bindgen]
pub struct TinyHyperGraphSolver {
    solver: Solver,
    step_status: [u32; 3],
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SolverConfiguration {
    #[serde(default)]
    variant: SolverVariant,
    #[serde(default)]
    preserve_initial_assignments: bool,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum SolverVariant {
    #[default]
    Base,
    OutsideIn,
    SelectiveRerip,
}

enum Solver {
    Base(tiny_hypergraph::TinyHyperGraphSolver),
    OutsideIn(OutsideInPartialRipTinyHyperGraphSolver),
    SelectiveRerip(SelectiveReripTinyHyperGraphSolver),
}

impl Deref for Solver {
    type Target = tiny_hypergraph::TinyHyperGraphSolver;

    fn deref(&self) -> &Self::Target {
        match self {
            Self::Base(solver) => solver,
            Self::OutsideIn(solver) => &solver.distance_aware.core,
            Self::SelectiveRerip(solver) => &solver.outside_in.distance_aware.core,
        }
    }
}

impl DerefMut for Solver {
    fn deref_mut(&mut self) -> &mut Self::Target {
        match self {
            Self::Base(solver) => solver,
            Self::OutsideIn(solver) => &mut solver.distance_aware.core,
            Self::SelectiveRerip(solver) => &mut solver.outside_in.distance_aware.core,
        }
    }
}

impl Solver {
    fn setup(&mut self) {
        match self {
            Self::Base(solver) => solver.setup(),
            Self::OutsideIn(solver) => solver.distance_aware.setup(),
            Self::SelectiveRerip(solver) => solver.outside_in.distance_aware.setup(),
        }
    }

    fn step(&mut self) {
        match self {
            Self::Base(solver) => solver.step(),
            Self::OutsideIn(solver) => solver.step(),
            Self::SelectiveRerip(solver) => solver.step(),
        }
    }

    fn try_final_acceptance(&mut self) {
        match self {
            Self::Base(solver) => solver.try_final_acceptance(),
            Self::OutsideIn(solver) => solver.try_final_acceptance(),
            Self::SelectiveRerip(solver) => solver.try_final_acceptance(),
        }
    }

    fn solve(&mut self) {
        match self {
            Self::Base(solver) => solver.solve(),
            Self::OutsideIn(solver) => solver.solve(),
            Self::SelectiveRerip(solver) => solver.solve(),
        }
    }
}

fn serialize(value: &impl Serialize) -> Result<JsValue, JsValue> {
    // Metadata and stats must remain plain objects, not JavaScript Maps.
    let serializer = serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true);
    value.serialize(&serializer).map_err(|error| {
        js_sys::Error::new(&format!("Could not serialize solver data: {error}")).into()
    })
}

#[wasm_bindgen(js_name = loadSerializedHyperGraph)]
pub fn load_serialized_hyper_graph(graph: JsValue) -> Result<JsValue, JsValue> {
    let graph: serde_json::Value = serde_wasm_bindgen::from_value(graph)
        .map_err(|error| js_sys::Error::new(&format!("Invalid serialized graph: {error}")))?;
    let loaded = tiny_hypergraph::compat::load_serialized_hyper_graph(&graph);
    serialize(&loaded)
}

#[wasm_bindgen]
impl TinyHyperGraphSolver {
    #[wasm_bindgen(constructor)]
    pub fn new(topology: JsValue, problem: JsValue, options: JsValue, configuration: JsValue) -> Result<Self, JsValue> {
        let topology: TinyHyperGraphTopology = serde_wasm_bindgen::from_value(topology)
            .map_err(|error| js_sys::Error::new(&format!("Invalid topology: {error}")))?;
        let problem: TinyHyperGraphProblem = serde_wasm_bindgen::from_value(problem)
            .map_err(|error| js_sys::Error::new(&format!("Invalid problem: {error}")))?;
        let options: Option<TinyHyperGraphSolverOptions> = serde_wasm_bindgen::from_value(options)
            .map_err(|error| js_sys::Error::new(&format!("Invalid solver options: {error}")))?;
        let configuration: Option<SolverConfiguration> = serde_wasm_bindgen::from_value(configuration)
            .map_err(|error| js_sys::Error::new(&format!("Invalid solver configuration: {error}")))?;
        let configuration = configuration.unwrap_or_default();
        let mut solver = match configuration.variant {
            SolverVariant::Base => Solver::Base(tiny_hypergraph::TinyHyperGraphSolver::new(topology, problem, options)),
            SolverVariant::OutsideIn => Solver::OutsideIn(OutsideInPartialRipTinyHyperGraphSolver::new(topology, problem, options)),
            SolverVariant::SelectiveRerip => Solver::SelectiveRerip(SelectiveReripTinyHyperGraphSolver::new(topology, problem, options)),
        };
        solver.preserve_initial_assignments = configuration.preserve_initial_assignments;
        let mut result = Self { solver, step_status: [0; 3] };
        result.refresh_step_status();
        Ok(result)
    }

    pub fn step(&mut self) -> Result<JsValue, JsValue> {
        self.step_many(1.0)
    }

    #[wasm_bindgen(js_name = stepCompact)]
    pub fn step_compact(&mut self) -> f64 {
        self.advance_steps(1);
        self.solver.iterations as f64 * 8.0
            + f64::from(self.solver.solved)
            + f64::from(self.solver.failed) * 2.0
            + f64::from(self.solver.error.is_some()) * 4.0
    }

    #[wasm_bindgen(js_name = stepStatusPointer)]
    pub fn step_status_pointer(&self) -> *const u32 {
        self.step_status.as_ptr()
    }

    fn refresh_step_status(&mut self) {
        self.step_status[0] = (self.solver.state.unrouted_routes.len()
            + usize::from(self.solver.state.current_route_id.is_some())) as u32;
        self.step_status[1] = self.solver.state.rip_count as u32;
        self.step_status[2] = self.solver.stats_revision as u32;
    }

    #[wasm_bindgen(js_name = pendingRouteCount)]
    pub fn pending_route_count(&self) -> usize {
        self.solver.state.unrouted_routes.len()
            + usize::from(self.solver.state.current_route_id.is_some())
    }

    #[wasm_bindgen(js_name = ripCount)]
    pub fn rip_count(&self) -> usize {
        self.solver.state.rip_count
    }

    #[wasm_bindgen(js_name = currentError)]
    pub fn current_error(&self) -> Option<String> {
        self.solver.error.clone()
    }

    #[wasm_bindgen(js_name = stepMany)]
    pub fn step_many(&mut self, max_steps: f64) -> Result<JsValue, JsValue> {
        if !max_steps.is_finite()
            || max_steps.fract() != 0.0
            || max_steps <= 0.0
            || max_steps > u32::MAX as f64
        {
            return Err(js_sys::Error::new("maxSteps must be a positive u32 integer").into());
        }
        self.advance_steps(max_steps as u32);
        self.get_status()
    }

    fn advance_steps(&mut self, max_steps: u32) {
        if !self.solver.solved && !self.solver.failed && !self.solver.is_setup {
            self.solver.setup();
        }
        for _ in 0..max_steps {
            if self.solver.solved
                || self.solver.failed
                || self.solver.iterations >= self.solver.options.max_iterations as usize
            {
                break;
            }
            // Core step() is the algorithm body; solve() normally owns this counter.
            self.solver.step();
            self.solver.iterations += 1;
        }
        if !self.solver.solved
            && !self.solver.failed
            && self.solver.iterations >= self.solver.options.max_iterations as usize
        {
            self.solver.try_final_acceptance();
            if !self.solver.solved {
                self.solver.failed = true;
                self.solver.error = Some("Maximum iterations reached".into());
            }
        }
        self.refresh_step_status();
    }

    pub fn solve(&mut self) -> Result<JsValue, JsValue> {
        if !self.solver.solved && !self.solver.failed {
            self.solver.solve();
        }
        self.refresh_step_status();
        self.get_status()
    }

    #[wasm_bindgen(js_name = resetRoutingStateForRerip)]
    pub fn reset_routing_state_for_rerip(&mut self) {
        self.solver.reset_routing_state_for_rerip();
        self.refresh_step_status();
    }

    #[wasm_bindgen(js_name = getStatus)]
    pub fn get_status(&self) -> Result<JsValue, JsValue> {
        serialize(&SolverStatus {
            solved: self.solver.solved,
            failed: self.solver.failed,
            error: self.solver.error.as_deref(),
            iterations: self.solver.iterations,
            pending_route_count: self.solver.state.unrouted_routes.len()
                + usize::from(self.solver.state.current_route_id.is_some()),
            rip_count: self.solver.state.rip_count,
        })
    }

    #[wasm_bindgen(js_name = getRoutingSnapshot)]
    pub fn get_routing_snapshot(&self) -> Result<JsValue, JsValue> {
        serialize(&RoutingSnapshot {
            port_assignment: &self.solver.state.port_assignment,
            region_segments: &self.solver.state.region_segments,
            current_route_id: self.solver.state.current_route_id,
            unrouted_routes: &self.solver.state.unrouted_routes,
        })
    }

    #[wasm_bindgen(js_name = getMaxRegionCost)]
    pub fn get_max_region_cost(&self) -> f64 {
        self.solver.state.region_intersection_caches.iter()
            .fold(0.0_f64, |max, cache| max.max(cache.existing_region_cost))
    }

    #[wasm_bindgen(js_name = getStatsRevision)]
    pub fn get_stats_revision(&self) -> usize {
        self.solver.stats_revision
    }

    #[wasm_bindgen(js_name = getStats)]
    pub fn get_stats(&self) -> Result<JsValue, JsValue> {
        serialize(&self.solver.stats)
    }

    #[wasm_bindgen(js_name = getStatsJson)]
    pub fn get_stats_json(&self) -> Result<String, JsValue> {
        let mut undefined_paths = Vec::new();
        collect_undefined_stats(&self.solver.stats, &mut Vec::new(), &mut undefined_paths);
        serde_json::to_string(&StatsSnapshot { stats: &self.solver.stats, undefined_paths })
            .map_err(|error| js_sys::Error::new(&error.to_string()).into())
    }

    #[wasm_bindgen(js_name = getOutput)]
    pub fn get_output(&self) -> Result<JsValue, JsValue> {
        if !self.solver.solved || self.solver.failed {
            return Err(js_sys::Error::new("Output requires a solved, non-failed solver").into());
        }
        serialize(&self.solver.get_output())
    }

    #[wasm_bindgen(js_name = replaySolution)]
    pub fn replay_solution(&mut self, solution: JsValue) -> Result<JsValue, JsValue> {
        let solution: tiny_hypergraph::TinyHyperGraphSolution = serde_wasm_bindgen::from_value(solution)
            .map_err(|error| js_sys::Error::new(&format!("Invalid solution: {error}")))?;
        let options = tiny_hypergraph::get_tiny_hyper_graph_solver_options(&self.solver.options);
        self.solver = Solver::Base(
            tiny_hypergraph::section_solver::create_solved_solver_from_solution(
                &self.solver.topology, &self.solver.problem, &solution, &options,
            ),
        );
        self.refresh_step_status();
        self.get_status()
    }

    pub fn visualize(&self) -> Result<JsValue, JsValue> {
        serialize(&self.solver.visualize())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DuplicatePortResult<'a> {
    solved: bool,
    failed: bool,
    error: Option<&'a str>,
    report: &'a tiny_hypergraph::DuplicateCongestedPortSolverReport,
    output: Option<&'a serde_json::Value>,
}

fn compare_port_ids(left: &str, right: &str) -> std::cmp::Ordering {
    js_sys::JsString::from(left)
        .locale_compare(right, &js_sys::Array::new(), &js_sys::Object::new())
        .cmp(&0)
}

#[wasm_bindgen(js_name = duplicateCongestedPorts)]
pub fn duplicate_congested_ports(graph: JsValue, options: JsValue) -> Result<JsValue, JsValue> {
    let graph: serde_json::Value = serde_wasm_bindgen::from_value(graph)
        .map_err(|error| js_sys::Error::new(&format!("Invalid serialized graph: {error}")))?;
    let options: tiny_hypergraph::DuplicateCongestedPortSolverOptions = serde_wasm_bindgen::from_value(options)
        .map_err(|error| js_sys::Error::new(&format!("Invalid duplicate-port options: {error}")))?;
    let mut solver = tiny_hypergraph::DuplicateCongestedPortSolver::new(graph, options);
    solver.hypot = js_sys::Math::hypot;
    solver.compare_port_ids = compare_port_ids;
    solver.solve();
    serialize(&DuplicatePortResult {
        solved: solver.solved,
        failed: solver.failed,
        error: solver.error.as_deref(),
        report: &solver.report,
        output: solver.revised_serialized_hyper_graph.as_ref(),
    })
}

#[wasm_bindgen(js_name = orderConnectionIndexesByNetCardinality)]
pub fn order_connection_indexes_by_net_cardinality(net_ids: JsValue) -> Result<JsValue, JsValue> {
    let ids: Vec<String> = serde_wasm_bindgen::from_value(net_ids)
        .map_err(|error| js_sys::Error::new(&format!("Invalid connection net IDs: {error}")))?;
    let indexes: Vec<usize> = (0..ids.len()).collect();
    serialize(&tiny_hypergraph::order_connections_by_net_cardinality(&indexes, |index| &ids[*index]))
}
