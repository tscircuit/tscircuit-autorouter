#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
#[global_allocator]
static ALLOCATOR: module_allocator::ModuleAllocator = module_allocator::ModuleAllocator::new();

use serde::{Deserialize, Serialize};
use tsify::{Ts, Tsify};
mod json_wire;
use json_bindings::{JsonInput, JsonOutput};
use std::ops::{Deref, DerefMut};
use tiny_hypergraph::{
    OutsideInPartialRipTinyHyperGraphSolver, SelectiveReripTinyHyperGraphSolver,
};
use tiny_hypergraph::{TinyHyperGraphProblem, TinyHyperGraphSolverOptions, TinyHyperGraphTopology};
use wasm_bindgen::prelude::*;

#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct SolverStatus {
    solved: bool,
    failed: bool,
    error: Option<String>,
    iterations: usize,
    pending_route_count: usize,
    rip_count: usize,
}

#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct RoutingSnapshot<'a> {
    port_assignment: &'a [i32],
    region_segments: &'a [Vec<(i32, i32, i32)>],
    current_route_id: Option<i32>,
    unrouted_routes: &'a [i32],
}

/// Owns one solver; generated bindings provide free() for deterministic disposal.
#[wasm_bindgen]
pub struct TinyHyperGraphSolver {
    solver: Solver,
    step_status: [u32; 3],
}

#[derive(Default, Deserialize, Tsify)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SolverConfiguration {
    #[serde(default)]
    variant: SolverVariant,
    #[serde(default)]
    preserve_initial_assignments: bool,
}

#[derive(Default, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
enum SolverVariant {
    #[default]
    Base,
    OutsideIn,
    SelectiveRerip,
}

#[cfg_attr(
    not(target_arch = "wasm32"),
    expect(
        clippy::large_enum_variant,
        reason = "Keep solver storage inline without introducing another allocation."
    )
)]
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

#[wasm_bindgen(typescript_custom_section)]
const EXTERNAL_TYPES: &str = r#"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph";
import type { GraphicsObject } from "graphics-debug";
type PortId = number;
type RegionId = number;
type RouteId = number;
type Value = unknown;
"#;

#[derive(Serialize, Deserialize, Tsify)]
#[serde(transparent)]
pub struct SerializedGraph(
    #[tsify(type = "SerializedHyperGraph")]
    #[serde(serialize_with = "json_bindings::serialize_js_value")]
    serde_json::Value,
);

#[derive(Serialize, Tsify)]
#[serde(transparent)]
pub struct Graphics(
    #[tsify(type = "GraphicsObject")]
    #[serde(serialize_with = "json_bindings::serialize_js_value")]
    serde_json::Value,
);

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
pub struct TopologyInput(JsonInput<TinyHyperGraphTopology>);

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
pub struct ProblemInput(JsonInput<TinyHyperGraphProblem>);

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
pub struct OptionsInput(JsonInput<Option<TinyHyperGraphSolverOptions>>);

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
pub struct ConfigurationInput(JsonInput<Option<SolverConfiguration>>);

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
pub struct SolutionInput(JsonInput<tiny_hypergraph::TinyHyperGraphSolution>);

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
pub struct GraphInput(JsonInput<SerializedGraph>);

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
pub struct DuplicateOptionsInput(JsonInput<tiny_hypergraph::DuplicateCongestedPortSolverOptions>);

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
pub struct NetIdsInput(JsonInput<Vec<String>>);

#[derive(Serialize, Tsify)]
#[serde(transparent)]
pub struct LoadedOutput(
    JsonOutput<tiny_hypergraph::compat::load_serialized_hyper_graph::LoadedHyperGraph>,
);

#[derive(Serialize, Tsify)]
#[serde(transparent)]
pub struct GraphOutput(JsonOutput<SerializedGraph>);

#[derive(Serialize, Tsify)]
#[serde(transparent)]
pub struct GraphicsOutput(JsonOutput<Graphics>);

#[derive(Serialize, Tsify)]
#[serde(transparent)]
pub struct RoutingOutput<'a>(JsonOutput<RoutingSnapshot<'a>>);

#[derive(Serialize, Tsify)]
#[serde(transparent)]
pub struct DuplicateOutput(JsonOutput<DuplicatePortResult>);

#[derive(Serialize, Tsify)]
#[serde(transparent)]
pub struct IndexesOutput(JsonOutput<Vec<usize>>);

#[derive(Serialize, Tsify)]
#[serde(transparent)]
pub struct StatsOutput<'a>(
    #[tsify(type = "JsonOutput<Record<string, unknown>>")] JsonOutput<&'a serde_json::Value>,
);

#[wasm_bindgen(js_name = loadSerializedHyperGraph)]
pub fn load_serialized_hyper_graph(graph: Ts<GraphInput>) -> Result<Ts<LoadedOutput>, JsError> {
    let graph = graph.to_rust()?.0.deserialize()?.0;
    let mut loaded = tiny_hypergraph::compat::load_serialized_hyper_graph(&graph);
    let numbers = json_wire::encode_loaded_numbers(&mut loaded);
    Ok(LoadedOutput(JsonOutput {
        value: loaded,
        numbers,
    })
    .into_ts()?)
}

#[wasm_bindgen]
impl TinyHyperGraphSolver {
    #[wasm_bindgen(constructor)]
    pub fn new(
        topology: Ts<TopologyInput>,
        problem: Ts<ProblemInput>,
        options: Ts<OptionsInput>,
        configuration: Ts<ConfigurationInput>,
    ) -> Result<Self, JsError> {
        let topology = topology
            .to_rust()?
            .0
            .deserialize()
            .map_err(|error| JsError::new(&format!("Invalid topology: {error}")))?;
        let problem = problem
            .to_rust()?
            .0
            .deserialize()
            .map_err(|error| JsError::new(&format!("Invalid problem: {error}")))?;
        let options = options
            .to_rust()?
            .0
            .deserialize()
            .map_err(|error| JsError::new(&format!("Invalid solver options: {error}")))?;
        let configuration = configuration
            .to_rust()?
            .0
            .deserialize()
            .map_err(|error| JsError::new(&format!("Invalid solver configuration: {error}")))?;
        let configuration = configuration.unwrap_or_default();
        let mut solver = match configuration.variant {
            SolverVariant::Base => Solver::Base(tiny_hypergraph::TinyHyperGraphSolver::new(
                topology, problem, options,
            )),
            SolverVariant::OutsideIn => Solver::OutsideIn(
                OutsideInPartialRipTinyHyperGraphSolver::new(topology, problem, options),
            ),
            SolverVariant::SelectiveRerip => Solver::SelectiveRerip(
                SelectiveReripTinyHyperGraphSolver::new(topology, problem, options),
            ),
        };
        solver.preserve_initial_assignments = configuration.preserve_initial_assignments;
        let mut result = Self {
            solver,
            step_status: [0; 3],
        };
        result.refresh_step_status();
        Ok(result)
    }

    pub fn step(&mut self) -> Result<Ts<SolverStatus>, JsError> {
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
            + usize::from(self.solver.state.current_route_id.is_some()))
            as u32;
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
    pub fn step_many(&mut self, max_steps: f64) -> Result<Ts<SolverStatus>, JsError> {
        if !max_steps.is_finite()
            || max_steps.fract() != 0.0
            || max_steps <= 0.0
            || max_steps > u32::MAX as f64
        {
            return Err(JsError::new("maxSteps must be a positive u32 integer"));
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

    pub fn solve(&mut self) -> Result<Ts<SolverStatus>, JsError> {
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
    pub fn get_status(&self) -> Result<Ts<SolverStatus>, JsError> {
        Ok(SolverStatus {
            solved: self.solver.solved,
            failed: self.solver.failed,
            error: self.solver.error.clone(),
            iterations: self.solver.iterations,
            pending_route_count: self.solver.state.unrouted_routes.len()
                + usize::from(self.solver.state.current_route_id.is_some()),
            rip_count: self.solver.state.rip_count,
        }
        .into_ts()?)
    }

    #[wasm_bindgen(js_name = getRoutingSnapshot)]
    pub fn get_routing_snapshot(&self) -> Result<Ts<RoutingOutput<'static>>, JsError> {
        let snapshot = RoutingOutput(JsonOutput {
            value: RoutingSnapshot {
                port_assignment: &self.solver.state.port_assignment,
                region_segments: &self.solver.state.region_segments,
                current_route_id: self.solver.state.current_route_id,
                unrouted_routes: &self.solver.state.unrouted_routes,
            },
            numbers: Vec::new(),
        })
        .into_ts()?;
        // Serialization owns the JS snapshot; it retains no Rust references.
        Ok(Ts::new_unchecked(snapshot.into()))
    }

    #[wasm_bindgen(js_name = getMaxRegionCost)]
    pub fn get_max_region_cost(&self) -> f64 {
        self.solver
            .state
            .region_intersection_caches
            .iter()
            .fold(0.0_f64, |max, cache| max.max(cache.existing_region_cost))
    }

    #[wasm_bindgen(js_name = getStatsRevision)]
    pub fn get_stats_revision(&self) -> usize {
        self.solver.stats_revision
    }

    #[wasm_bindgen(js_name = getStats)]
    pub fn get_stats(&self) -> Result<Ts<StatsOutput<'static>>, JsError> {
        // Serialization owns the JS snapshot; it retains no Rust references.
        Ok(Ts::new_unchecked(
            StatsOutput(JsonOutput {
                value: &self.solver.stats,
                numbers: Vec::new(),
            })
            .into_ts()?
            .into(),
        ))
    }

    #[wasm_bindgen(js_name = getOutput)]
    pub fn get_output(&self) -> Result<Ts<GraphOutput>, JsError> {
        if !self.solver.solved || self.solver.failed {
            return Err(JsError::new("Output requires a solved, non-failed solver"));
        }
        Ok(GraphOutput(JsonOutput {
            value: SerializedGraph(self.solver.get_output()),
            numbers: Vec::new(),
        })
        .into_ts()?)
    }

    #[wasm_bindgen(js_name = replaySolution)]
    pub fn replay_solution(
        &mut self,
        solution: Ts<SolutionInput>,
    ) -> Result<Ts<SolverStatus>, JsError> {
        let solution = solution.to_rust()?.0.deserialize()?;
        let options = tiny_hypergraph::get_tiny_hyper_graph_solver_options(&self.solver.options);
        self.solver = Solver::Base(
            tiny_hypergraph::section_solver::create_solved_solver_from_solution(
                &self.solver.topology,
                &self.solver.problem,
                &solution,
                &options,
            ),
        );
        self.refresh_step_status();
        self.get_status()
    }

    pub fn visualize(&self) -> Result<Ts<GraphicsOutput>, JsError> {
        Ok(GraphicsOutput(JsonOutput {
            value: Graphics(self.solver.visualize()),
            numbers: Vec::new(),
        })
        .into_ts()?)
    }
}

#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct DuplicatePortResult {
    solved: bool,
    failed: bool,
    error: Option<String>,
    report: tiny_hypergraph::DuplicateCongestedPortSolverReport,
    #[tsify(type = "SerializedHyperGraph | null")]
    #[serde(serialize_with = "json_bindings::serialize_optional_js_value")]
    output: Option<serde_json::Value>,
}

fn compare_port_ids(left: &str, right: &str) -> std::cmp::Ordering {
    js_sys::JsString::from(left)
        .locale_compare(right, &js_sys::Array::new(), &js_sys::Object::new())
        .cmp(&0)
}

#[wasm_bindgen(js_name = duplicateCongestedPorts)]
pub fn duplicate_congested_ports(
    graph: Ts<GraphInput>,
    options: Ts<DuplicateOptionsInput>,
) -> Result<Ts<DuplicateOutput>, JsError> {
    let graph = graph.to_rust()?.0.deserialize()?.0;
    let options = options.to_rust()?.0.deserialize()?;
    let mut solver = tiny_hypergraph::DuplicateCongestedPortSolver::new(graph, options);
    solver.hypot = js_sys::Math::hypot;
    solver.compare_port_ids = compare_port_ids;
    solver.solve();
    Ok(DuplicateOutput(JsonOutput {
        value: DuplicatePortResult {
            solved: solver.solved,
            failed: solver.failed,
            error: solver.error,
            report: solver.report,
            output: solver.revised_serialized_hyper_graph,
        },
        numbers: Vec::new(),
    })
    .into_ts()?)
}

#[wasm_bindgen(js_name = orderConnectionIndexesByNetCardinality)]
pub fn order_connection_indexes_by_net_cardinality(
    net_ids: Ts<NetIdsInput>,
) -> Result<Ts<IndexesOutput>, JsError> {
    let ids = net_ids.to_rust()?.0.deserialize()?;
    let indexes: Vec<usize> = (0..ids.len()).collect();
    Ok(IndexesOutput(JsonOutput {
        value: tiny_hypergraph::order_connections_by_net_cardinality(&indexes, |index| {
            &ids[*index]
        }),
        numbers: Vec::new(),
    })
    .into_ts()?)
}
