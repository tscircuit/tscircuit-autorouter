use serde::{Deserialize, Serialize};
use std::ops::{Deref, DerefMut};
use tiny_hypergraph::{OutsideInPartialRipTinyHyperGraphSolver, SelectiveReripTinyHyperGraphSolver};
use tiny_hypergraph::{
    TinyHyperGraphProblem, TinyHyperGraphSolver, TinyHyperGraphSolverOptions,
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

/// Owns one solver; generated bindings provide free() for deterministic disposal.
#[wasm_bindgen]
pub struct RustTinyHyperGraphSolver {
    solver: Solver,
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
    Base(TinyHyperGraphSolver),
    OutsideIn(OutsideInPartialRipTinyHyperGraphSolver),
    SelectiveRerip(SelectiveReripTinyHyperGraphSolver),
}

impl Deref for Solver {
    type Target = TinyHyperGraphSolver;

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
impl RustTinyHyperGraphSolver {
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
            SolverVariant::Base => Solver::Base(TinyHyperGraphSolver::new(topology, problem, options)),
            SolverVariant::OutsideIn => Solver::OutsideIn(OutsideInPartialRipTinyHyperGraphSolver::new(topology, problem, options)),
            SolverVariant::SelectiveRerip => Solver::SelectiveRerip(SelectiveReripTinyHyperGraphSolver::new(topology, problem, options)),
        };
        solver.preserve_initial_assignments = configuration.preserve_initial_assignments;
        Ok(Self { solver })
    }

    pub fn step(&mut self) -> Result<JsValue, JsValue> {
        self.step_many(1.0)
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
        if !self.solver.solved && !self.solver.failed && !self.solver.is_setup {
            self.solver.setup();
        }
        for _ in 0..max_steps as u32 {
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
        self.get_status()
    }

    pub fn solve(&mut self) -> Result<JsValue, JsValue> {
        if !self.solver.solved && !self.solver.failed {
            self.solver.solve();
        }
        self.get_status()
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

    #[wasm_bindgen(js_name = getStats)]
    pub fn get_stats(&self) -> Result<JsValue, JsValue> {
        serialize(&self.solver.stats)
    }

    #[wasm_bindgen(js_name = getOutput)]
    pub fn get_output(&self) -> Result<JsValue, JsValue> {
        if !self.solver.solved || self.solver.failed {
            return Err(js_sys::Error::new("Output requires a solved, non-failed solver").into());
        }
        serialize(&self.solver.get_output())
    }

    pub fn visualize(&self) -> Result<JsValue, JsValue> {
        serialize(&self.solver.visualize())
    }
}
