use serde::Serialize;
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
    solver: TinyHyperGraphSolver,
}

fn serialize(value: &impl Serialize) -> Result<JsValue, JsValue> {
    // Metadata and stats must remain plain objects, not JavaScript Maps.
    let serializer = serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true);
    value.serialize(&serializer).map_err(|error| {
        js_sys::Error::new(&format!("Could not serialize solver data: {error}")).into()
    })
}

#[wasm_bindgen]
impl RustTinyHyperGraphSolver {
    #[wasm_bindgen(constructor)]
    pub fn new(topology: JsValue, problem: JsValue, options: JsValue) -> Result<Self, JsValue> {
        let topology: TinyHyperGraphTopology = serde_wasm_bindgen::from_value(topology)
            .map_err(|error| js_sys::Error::new(&format!("Invalid topology: {error}")))?;
        let problem: TinyHyperGraphProblem = serde_wasm_bindgen::from_value(problem)
            .map_err(|error| js_sys::Error::new(&format!("Invalid problem: {error}")))?;
        let options: Option<TinyHyperGraphSolverOptions> = serde_wasm_bindgen::from_value(options)
            .map_err(|error| js_sys::Error::new(&format!("Invalid solver options: {error}")))?;
        Ok(Self {
            solver: TinyHyperGraphSolver::new(topology, problem, options),
        })
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
