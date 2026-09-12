use serde_json::{Value, json};
use crate::ported::solvers::hyper_parameter_supervisor_solver::{Candidate, CandidateFactory, HyperParameterDef, HyperParameterSupervisorSolver};

pub const ORDERING_SHUFFLE_SEEDS: [usize; 6] = [0, 1, 2, 3, 4, 5];

pub struct PortfolioSingleIntraNodeSolver {
    pub supervisor: HyperParameterSupervisorSolver,
    pub node_with_port_points: Value,
    pub effort: f64,
    pub adaptive_search_expanded: bool,
    pub iterations: usize,
    pub max_iterations: f64,
    pub progress: f64,
    pub stats: Value,
}

pub fn get_combination_defs() -> Vec<Vec<&'static str>> {
    vec![vec!["throughObstacle"], vec!["singleLayerNoDifferentRootIntersections"],
        vec!["multiHeadPolyLine"], vec!["majorCombinations", "orderings6", "cellSizeFactor"],
        vec!["noVias"], vec!["orderings50"], vec!["flipTraceAlignmentDirection", "orderings6"],
        vec!["closedFormSingleTrace"], vec!["highDensityA01"], vec!["highDensityA03"]]
}

pub fn get_hyper_parameter_defs() -> Vec<HyperParameterDef> {
    vec![
        HyperParameterDef { name: "singleLayerNoDifferentRootIntersections", possible_values: vec![json!({"SINGLE_LAYER_NO_DIFFERENT_ROOT_INTERSECTIONS":true})] },
        HyperParameterDef { name: "majorCombinations", possible_values: vec![
            json!({"FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR":2,"FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR":1,"FUTURE_CONNECTION_PROXIMITY_VD":10,"MISALIGNED_DIST_PENALTY_FACTOR":5}),
            json!({"FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR":1,"FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR":0.5,"FUTURE_CONNECTION_PROXIMITY_VD":5,"MISALIGNED_DIST_PENALTY_FACTOR":2}),
            json!({"FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR":10,"FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR":1,"FUTURE_CONNECTION_PROXIMITY_VD":5,"MISALIGNED_DIST_PENALTY_FACTOR":10,"VIA_PENALTY_FACTOR_2":1})] },
        HyperParameterDef { name: "orderings6", possible_values: ORDERING_SHUFFLE_SEEDS.iter().map(|seed| json!({"SHUFFLE_SEED":seed})).collect() },
        HyperParameterDef { name: "cellSizeFactor", possible_values: vec![json!({"CELL_SIZE_FACTOR":0.5}),json!({"CELL_SIZE_FACTOR":1})] },
        HyperParameterDef { name: "flipTraceAlignmentDirection", possible_values: vec![json!({"FLIP_TRACE_ALIGNMENT_DIRECTION":true})] },
        HyperParameterDef { name: "noVias", possible_values: vec![json!({"CELL_SIZE_FACTOR":2,"VIA_PENALTY_FACTOR_2":10})] },
        HyperParameterDef { name: "orderings50", possible_values: (0..20).map(|i| json!({"SHUFFLE_SEED":100+i})).collect() },
        HyperParameterDef { name: "throughObstacle", possible_values: vec![json!({"THROUGH_OBSTACLE":true})] },
        HyperParameterDef { name: "closedFormSingleTrace", possible_values: vec![json!({"CLOSED_FORM_SINGLE_TRANSITION":true})] },
        HyperParameterDef { name: "multiHeadPolyLine", possible_values: vec![
            json!({"MULTI_HEAD_POLYLINE_SOLVER":true,"SEGMENTS_PER_POLYLINE":6,"BOUNDARY_PADDING":0.05}),
            json!({"MULTI_HEAD_POLYLINE_SOLVER":true,"SEGMENTS_PER_POLYLINE":6,"BOUNDARY_PADDING":-0.05,"ITERATION_PENALTY":10000,"MINIMUM_FINAL_ACCEPTANCE_GAP":0.001})] },
        HyperParameterDef { name: "highDensityA01", possible_values: vec![json!({"HIGH_DENSITY_A01":true,"SHUFFLE_SEED":ORDERING_SHUFFLE_SEEDS[0]})] },
        HyperParameterDef { name: "highDensityA03", possible_values: vec![json!({"HIGH_DENSITY_A03":true})] },
    ]
}

fn progress_or_zero(progress: f64) -> f64 {
    if progress == 0.0 || progress.is_nan() { 0.0 } else { progress }
}

fn js_max(left: f64, right: f64) -> f64 {
    if left.is_nan() || right.is_nan() { f64::NAN } else { left.max(right) }
}

impl PortfolioSingleIntraNodeSolver {
    pub fn new(node_with_port_points: Value, effort: f64) -> Self {
        let mut supervisor = HyperParameterSupervisorSolver::new();
        supervisor.greedy_multiplier = 5.0;
        supervisor.min_substeps = 100;
        Self { supervisor, node_with_port_points, effort, adaptive_search_expanded: false,
            iterations: 0, max_iterations: 20_000_000.0 * effort, progress: 0.0, stats: json!({}) }
    }

    pub fn get_node_segment_count(&self) -> usize {
        if let Some(pairs) = self.node_with_port_points["portPointsInPairs"].as_array() { return pairs.len().max(1); }
        let mut names = std::collections::HashSet::new();
        for point in self.node_with_port_points["portPoints"].as_array().expect("Node portPoints required") {
            names.insert(point["connectionName"].as_str().expect("Connection name required"));
        }
        names.len().max(1)
    }

    pub fn get_candidate_progress(solver: &dyn Candidate, node_segment_count: usize) -> f64 {
        let state = solver.state();
        if let Some(count) = state.solved_segment_count { return (count as f64 / node_segment_count as f64).min(1.0); }
        progress_or_zero(state.progress).min(1.0).max(0.0)
    }

    pub fn get_total_candidate_work(&self) -> f64 {
        self.supervisor.supervised_solvers.as_deref().unwrap_or(&[]).iter()
            .fold(0.0, |total, record| total + record.solver.state().iterations as f64)
    }

    pub fn get_dynamic_expansion_work_budget(&self) -> f64 {
        self.supervisor.supervised_solvers.as_deref().unwrap_or(&[]).iter()
            .fold(1.0, |total, record| js_max(total, record.solver.state().max_iterations))
    }

    pub fn refresh_dynamic_iteration_limit(&mut self) {
        let remaining = self.supervisor.supervised_solvers.as_deref().unwrap_or(&[]).iter().fold(0.0, |total, record| {
            let state = record.solver.state();
            if state.solved || state.failed { return total; }
            let iterations = js_max(0.0, state.max_iterations - state.iterations as f64 + 1.0);
            total + (iterations / self.supervisor.min_substeps as f64).ceil()
        });
        self.max_iterations = js_max(self.iterations as f64 + 1.0, self.iterations as f64 + remaining);
        self.stats["dynamicSupervisorIterationLimit"] = json!(self.max_iterations);
    }

    pub fn initialize_solvers(&mut self, factory: &mut dyn CandidateFactory) -> Result<(), String> {
        self.supervisor.initialize_solvers(&get_hyper_parameter_defs(), Some(&get_combination_defs()), factory, Self::compute_g)?;
        for record in self.supervisor.supervised_solvers.as_mut().unwrap() { record.solver.setup()?; }
        self.stats["dynamicExpansionWorkBudget"] = json!(self.get_dynamic_expansion_work_budget());
        self.refresh_dynamic_iteration_limit();
        Ok(())
    }

    pub fn add_supervised_candidate(&mut self, hyper_parameters: Value, factory: &mut dyn CandidateFactory) -> Result<usize, String> {
        let mut solver = factory.generate(&hyper_parameters)?;
        solver.setup()?;
        let g = Self::compute_g(solver.as_ref(), &hyper_parameters);
        Ok(self.supervisor.add_candidate(hyper_parameters, solver, g))
    }

    pub fn expand_adaptive_search(&mut self, factory: &mut dyn CandidateFactory) -> Result<(), String> {
        if self.adaptive_search_expanded { return Ok(()); }
        self.adaptive_search_expanded = true;
        for seed in &ORDERING_SHUFFLE_SEEDS[1..] {
            self.add_supervised_candidate(json!({"HIGH_DENSITY_A01":true,"SHUFFLE_SEED":seed}), factory)?;
        }
        self.refresh_dynamic_iteration_limit();
        self.stats["adaptiveSearchExpanded"] = json!(true);
        self.stats["adaptiveSearchExpandedAtIteration"] = json!(self.iterations);
        self.stats["candidateWorkAtExpansion"] = json!(self.get_total_candidate_work());
        let count = self.get_node_segment_count();
        let best = self.supervisor.supervised_solvers.as_deref().unwrap_or(&[]).iter()
            .fold(0.0, |best, record| js_max(best, Self::get_candidate_progress(record.solver.as_ref(), count)));
        self.stats["bestProgressAtExpansion"] = json!(best);
        Ok(())
    }

    pub fn should_expand_portfolio(&mut self) -> bool {
        if self.adaptive_search_expanded { return false; }
        let budget = self.get_dynamic_expansion_work_budget();
        self.stats["dynamicExpansionWorkBudget"] = json!(budget);
        self.get_total_candidate_work() >= budget
    }

    pub fn step_inner(&mut self, factory: &mut dyn CandidateFactory) -> Result<(), String> {
        if self.supervisor.supervised_solvers.is_none() { self.initialize_solvers(factory)?; }
        if !self.adaptive_search_expanded && self.supervisor.get_supervised_solver_with_best_fitness().is_none() {
            self.expand_adaptive_search(factory)?;
        }
        let expanded = self.adaptive_search_expanded;
        let count = if expanded { self.get_node_segment_count() } else { 1 };
        self.supervisor.step_initialized(Self::compute_g, |solver| {
            if expanded { 1.0 - Self::get_candidate_progress(solver, count) }
            else { 1.0 - progress_or_zero(solver.state().progress) }
        })?;
        if !self.supervisor.solved && !self.supervisor.failed && self.should_expand_portfolio() { self.expand_adaptive_search(factory)?; }
        Ok(())
    }

    pub fn step(&mut self, factory: &mut dyn CandidateFactory) -> Result<(), String> {
        if self.supervisor.solved || self.supervisor.failed { return Ok(()); }
        self.iterations += 1;
        if let Err(error) = self.step_inner(factory) {
            self.supervisor.error = Some(format!("PortfolioSingleIntraNodeSolver error: {error}"));
            self.supervisor.failed = true;
            return Err(error);
        }
        if !self.supervisor.solved && self.iterations as f64 > self.max_iterations {
            let limit = autorouting_drc::math_utils::js_number_to_string(self.max_iterations);
            self.supervisor.error = Some(format!("PortfolioSingleIntraNodeSolver ran out of iterations (MAX_ITERATIONS={limit})"));
            self.supervisor.failed = true;
        }
        Ok(())
    }

    pub fn compute_g(solver: &dyn Candidate, hyper_parameters: &Value) -> f64 {
        let iterations = solver.state().iterations as f64;
        if solver.is_specialized() { return iterations / 1_000_000.0; }
        if hyper_parameters["MULTI_HEAD_POLYLINE_SOLVER"].as_bool() == Some(true) {
            return 1000.0 + (hyper_parameters["ITERATION_PENALTY"].as_f64().unwrap_or(0.0) + iterations) / 10_000.0
                + 10_000.0 * (hyper_parameters["SEGMENTS_PER_POLYLINE"].as_f64().expect("Polyline segment count required") - 3.0);
        }
        iterations / 10_000.0
    }
}
