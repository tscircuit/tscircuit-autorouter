type CreateSectionMask = Box<dyn Fn(TinyHyperGraphSectionMaskContext<'_>) -> Vec<i32>>;

pub use super::section_candidate_families::*;
use super::{
    TinyHyperGraphSectionSolver, TinyHyperGraphSectionSolverOptions, get_active_section_route_ids,
    merge_stats,
};
use crate::compat::{LoadedHyperGraph, load_serialized_hyper_graph};
use crate::core::*;
use crate::graphics::GraphicsObject;
use serde_json::{Value, json};
use std::collections::HashSet;
use std::panic::{AssertUnwindSafe, catch_unwind};
use web_time::Instant;

pub struct AutomaticSectionSearchResult {
    pub port_section_mask: Vec<i32>,
    pub baseline_max_region_cost: f64,
    pub final_max_region_cost: f64,
    pub generated_candidate_count: usize,
    pub candidate_count: usize,
    pub duplicate_candidate_count: usize,
    pub total_ms: f64,
    pub baseline_evaluation_ms: f64,
    pub candidate_eligibility_ms: f64,
    pub candidate_init_ms: f64,
    pub candidate_solve_ms: f64,
    pub candidate_replay_score_ms: f64,
    pub winning_candidate_label: Option<String>,
    pub winning_candidate_family: Option<TinyHyperGraphSectionCandidateFamily>,
}

#[derive(Clone, Default)]
pub struct TinyHyperGraphSectionPipelineSearchConfig {
    pub max_hot_regions: Option<usize>,
    pub candidate_families: Option<Vec<TinyHyperGraphSectionCandidateFamily>>,
}

pub struct TinyHyperGraphSectionMaskContext<'a> {
    pub serialized_hyper_graph: &'a Value,
    pub solved_serialized_hyper_graph: &'a Value,
    pub solved_solver: &'a TinyHyperGraphSolver,
    pub topology: &'a TinyHyperGraphTopology,
    pub problem: &'a TinyHyperGraphProblem,
    pub solution: &'a TinyHyperGraphSolution,
}

pub struct TinyHyperGraphSectionPipelineInput {
    pub serialized_hyper_graph: Value,
    pub min_via_pad_diameter: Option<f64>,
    pub create_section_mask: Option<CreateSectionMask>,
    pub solve_graph_options: Option<TinyHyperGraphSolverOptions>,
    pub section_solver_options: Option<TinyHyperGraphSectionSolverOptions>,
    pub section_search_config: Option<TinyHyperGraphSectionPipelineSearchConfig>,
}

fn max_region_cost(solver: &TinyHyperGraphSolver) -> f64 {
    let mut max: f64 = 0.0;

    for cache in &solver.state.region_intersection_caches {
        max = max.max(cache.existing_region_cost);
    }

    max
}

fn create_mask(
    topology: &TinyHyperGraphTopology,
    candidate: &TinyHyperGraphSectionMaskCandidate,
) -> Vec<i32> {
    let selected: HashSet<i32> = candidate.region_ids.iter().copied().collect();
    topology
        .incident_port_region
        .iter()
        .map(|regions| {
            let selected = match candidate.port_selection_rule {
                TinyHyperGraphSectionPortSelectionRule::TouchesSelectedRegion => {
                    regions.iter().any(|r| selected.contains(r))
                }

                TinyHyperGraphSectionPortSelectionRule::AllIncidentRegionsSelected => {
                    !regions.is_empty() && regions.iter().all(|r| selected.contains(r))
                }
            };
            if selected { 1 } else { 0 }
        })
        .collect()
}

fn with_mask(problem: &TinyHyperGraphProblem, mask: Vec<i32>) -> TinyHyperGraphProblem {
    let mut result = problem.clone();
    result.port_section_mask = mask;
    result.initial_assignments = None;
    result
}

fn find_best_automatic_section_mask(
    solved_solver: &TinyHyperGraphSolver,
    topology: &TinyHyperGraphTopology,
    problem: &TinyHyperGraphProblem,
    solution: &TinyHyperGraphSolution,
    config: Option<&TinyHyperGraphSectionPipelineSearchConfig>,
    options: &TinyHyperGraphSectionSolverOptions,
) -> AutomaticSectionSearchResult {
    let start = Instant::now();
    let baseline_start = Instant::now();
    let baseline = TinyHyperGraphSectionSolver::new(
        topology.clone(),
        problem.clone(),
        solution.clone(),
        Some(options.clone()),
    );
    let cost = max_region_cost(&baseline.baseline_solver);
    let mut result = AutomaticSectionSearchResult {
        port_section_mask: vec![0; topology.port_count],
        baseline_max_region_cost: cost,
        final_max_region_cost: cost,
        generated_candidate_count: 0,
        candidate_count: 0,
        duplicate_candidate_count: 0,
        total_ms: 0.0,
        baseline_evaluation_ms: baseline_start.elapsed().as_secs_f64() * 1000.0,
        candidate_eligibility_ms: 0.0,
        candidate_init_ms: 0.0,
        candidate_solve_ms: 0.0,
        candidate_replay_score_ms: 0.0,
        winning_candidate_label: None,
        winning_candidate_family: None,
    };
    let max_hot = config
        .and_then(|c| c.max_hot_regions)
        .or(options.max_hot_regions)
        .unwrap_or(2);
    let families = config
        .and_then(|c| c.candidate_families.as_deref())
        .unwrap_or(DEFAULT_TINY_HYPERGRAPH_SECTION_CANDIDATE_FAMILIES);
    let mut hot: Vec<(i32, f64)> = solved_solver
        .state
        .region_intersection_caches
        .iter()
        .enumerate()
        .filter(|(_, c)| c.existing_region_cost > 0.0)
        .map(|(i, c)| (i as i32, c.existing_region_cost))
        .collect();
    hot.sort_by(|a, b| b.1.total_cmp(&a.1));
    hot.truncate(max_hot);
    let mut seen = HashSet::new();

    for candidate in create_section_mask_candidates_for_hot_regions(
        topology,
        &hot.iter().map(|r| r.0).collect::<Vec<_>>(),
        families,
    ) {
        let problem = with_mask(problem, create_mask(topology, &candidate));
        result.generated_candidate_count += 1;
        if !seen.insert(problem.port_section_mask.clone()) {
            result.duplicate_candidate_count += 1;
            continue;
        }

        // The source catches invalid section masks, including split route spans.
        let _ = catch_unwind(AssertUnwindSafe(|| {
            let stamp = Instant::now();
            let active = get_active_section_route_ids(topology, &problem, solution);
            result.candidate_eligibility_ms += stamp.elapsed().as_secs_f64() * 1000.0;
            if active.is_empty() {
                return;
            }

            result.candidate_count += 1;
            let stamp = Instant::now();
            let mut solver = TinyHyperGraphSectionSolver::new(
                topology.clone(),
                problem.clone(),
                solution.clone(),
                Some(options.clone()),
            );
            result.candidate_init_ms += stamp.elapsed().as_secs_f64() * 1000.0;
            let stamp = Instant::now();
            solver.solve();
            result.candidate_solve_ms += stamp.elapsed().as_secs_f64() * 1000.0;
            if solver.failed || !solver.solved {
                return;
            }

            let final_cost = solver.stats["finalMaxRegionCost"]
                .as_f64()
                .unwrap_or_else(|| max_region_cost(solver.get_solved_solver()));
            if final_cost < result.final_max_region_cost - 1e-9 {
                let stamp = Instant::now();
                let replay = load_serialized_hyper_graph(&solver.get_output());
                let replayed = TinyHyperGraphSectionSolver::new(
                    replay.topology,
                    replay.problem,
                    replay.solution,
                    Some(options.clone()),
                );
                let replayed_cost = max_region_cost(&replayed.baseline_solver);
                result.candidate_replay_score_ms += stamp.elapsed().as_secs_f64() * 1000.0;
                if replayed_cost < result.final_max_region_cost - 1e-9 {
                    result.final_max_region_cost = replayed_cost;
                    result.port_section_mask = problem.port_section_mask.clone();
                    result.winning_candidate_label = Some(candidate.label.clone());
                    result.winning_candidate_family = Some(candidate.family);
                }
            }
        }));
    }

    result.total_ms = start.elapsed().as_secs_f64() * 1000.0;
    result
}

pub struct TinyHyperGraphSectionPipelineSolver {
    pub input_problem: TinyHyperGraphSectionPipelineInput,
    pub initial_visualization_solver: Option<TinyHyperGraphSolver>,
    pub selected_section_mask: Option<Vec<i32>>,
    pub selected_section_candidate_label: Option<String>,
    pub selected_section_candidate_family: Option<TinyHyperGraphSectionCandidateFamily>,
    pub solve_graph: Option<TinyHyperGraphSolver>,
    pub optimize_section: Option<TinyHyperGraphSectionSolver>,
    pub solved: bool,
    pub failed: bool,
    pub error: Option<String>,
    pub iterations: usize,
    pub max_iterations: usize,
    pub stats: Value,
    pub poly_mode: bool,
    pub poly_topology: Option<crate::poly_types::PolyHyperGraphTopology>,
}

impl TinyHyperGraphSectionPipelineSolver {
    pub fn new(input_problem: TinyHyperGraphSectionPipelineInput) -> Self {
        Self {
            input_problem,
            initial_visualization_solver: None,
            selected_section_mask: None,
            selected_section_candidate_label: None,
            selected_section_candidate_family: None,
            solve_graph: None,
            optimize_section: None,
            solved: false,
            failed: false,
            error: None,
            iterations: 0,
            max_iterations: 200_000,
            stats: json!({}),
            poly_mode: false,
            poly_topology: None,
        }
    }

    pub fn load_hyper_graph(&self, graph: &Value) -> LoadedHyperGraph {
        if self.poly_mode {
            let loaded = crate::poly::load_serialized_hyper_graph_as_poly(graph, None);
            LoadedHyperGraph {
                topology: loaded.topology.base,
                problem: loaded.problem,
                solution: loaded.solution,
            }
        } else {
            load_serialized_hyper_graph(graph)
        }
    }

    pub fn get_solve_graph_options(&self) -> TinyHyperGraphSolverOptions {
        let mut defaults = json!({"RIP_THRESHOLD_RAMP_ATTEMPTS":5});
        if let Some(d) = self.input_problem.min_via_pad_diameter {
            defaults["minViaPadDiameter"] = json!(d);
        }

        if let Some(options) = &self.input_problem.solve_graph_options {
            for (k, v) in serde_json::to_value(options).unwrap().as_object().unwrap() {
                if !v.is_null() {
                    defaults[k] = v.clone();
                }
            }
        }

        serde_json::from_value(defaults).unwrap()
    }

    pub fn get_section_solver_options(&self) -> TinyHyperGraphSectionSolverOptions {
        let mut defaults = json!({"DISTANCE_TO_COST":0.05,"RIP_THRESHOLD_RAMP_ATTEMPTS":16,"RIP_CONGESTION_REGION_COST_FACTOR":0.1,"MAX_ITERATIONS":50_000,"MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT":6});
        if let Some(d) = self.input_problem.min_via_pad_diameter {
            defaults["minViaPadDiameter"] = json!(d);
        }

        if let Some(options) = &self.input_problem.section_solver_options {
            for (k, v) in serde_json::to_value(options).unwrap().as_object().unwrap() {
                if !v.is_null() {
                    defaults[k] = v.clone();
                }
            }
        }

        let mut options: TinyHyperGraphSectionSolverOptions =
            serde_json::from_value(defaults).unwrap();
        options.extra_rips_after_beating_baseline_max_region_cost = self
            .input_problem
            .section_solver_options
            .as_ref()
            .and_then(|o| o.extra_rips_after_beating_baseline_max_region_cost)
            .or(Some(f64::INFINITY));
        options
    }

    pub fn get_section_stage_params(
        &mut self,
    ) -> (
        TinyHyperGraphTopology,
        TinyHyperGraphProblem,
        TinyHyperGraphSolution,
        TinyHyperGraphSectionSolverOptions,
    ) {
        let solved = self
            .solve_graph
            .as_ref()
            .expect("solveGraph solver is unavailable");
        assert!(
            solved.solved,
            "solveGraph did not produce a solved serialized hypergraph"
        );
        let serialized = solved.get_output();
        let options = self.get_section_solver_options();
        let loaded = self.load_hyper_graph(&serialized);
        let mut problem = loaded.problem;
        let mask = if let Some(create) = &self.input_problem.create_section_mask {
            create(TinyHyperGraphSectionMaskContext {
                serialized_hyper_graph: &self.input_problem.serialized_hyper_graph,
                solved_serialized_hyper_graph: &serialized,
                solved_solver: solved,
                topology: &loaded.topology,
                problem: &problem,
                solution: &loaded.solution,
            })
        } else {
            let result = find_best_automatic_section_mask(
                solved,
                &loaded.topology,
                &problem,
                &loaded.solution,
                self.input_problem.section_search_config.as_ref(),
                &options,
            );
            self.selected_section_candidate_label = result.winning_candidate_label.clone();
            self.selected_section_candidate_family = result.winning_candidate_family;
            merge_stats(
                &mut self.stats,
                json!({"sectionSearchGeneratedCandidateCount":result.generated_candidate_count,"sectionSearchCandidateCount":result.candidate_count,"sectionSearchDuplicateCandidateCount":result.duplicate_candidate_count,"sectionSearchBaselineMaxRegionCost":result.baseline_max_region_cost,"sectionSearchFinalMaxRegionCost":result.final_max_region_cost,"sectionSearchDelta":result.baseline_max_region_cost-result.final_max_region_cost,"selectedSectionCandidateLabel":result.winning_candidate_label,"selectedSectionCandidateFamily":result.winning_candidate_family,"sectionSearchMs":result.total_ms,"sectionSearchBaselineEvaluationMs":result.baseline_evaluation_ms,"sectionSearchCandidateEligibilityMs":result.candidate_eligibility_ms,"sectionSearchCandidateInitMs":result.candidate_init_ms,"sectionSearchCandidateSolveMs":result.candidate_solve_ms,"sectionSearchCandidateReplayScoreMs":result.candidate_replay_score_ms}),
            );
            result.port_section_mask
        };
        self.selected_section_mask = Some(mask.clone());
        problem.port_section_mask = mask.clone();
        self.stats["sectionMaskPortCount"] = json!(mask.iter().filter(|v| **v == 1).count());
        (loaded.topology, problem, loaded.solution, options)
    }

    pub fn get_initial_visualization_solver(&mut self) -> &TinyHyperGraphSolver {
        if self.initial_visualization_solver.is_none() {
            let options = self.get_solve_graph_options();
            let solver = if self.poly_mode {
                let loaded = crate::poly::load_serialized_hyper_graph_as_poly(
                    &self.input_problem.serialized_hyper_graph,
                    None,
                );
                crate::poly::PolyHyperGraphSolver::new(
                    loaded.topology,
                    loaded.problem,
                    Some(options),
                )
                .core
            } else {
                let loaded = self.load_hyper_graph(&self.input_problem.serialized_hyper_graph);
                TinyHyperGraphSolver::new(loaded.topology, loaded.problem, Some(options))
            };
            self.initial_visualization_solver = Some(solver);
        }

        self.initial_visualization_solver.as_ref().unwrap()
    }

    pub fn initial_visualize(&mut self) -> GraphicsObject {
        if self.poly_mode {
            let loaded = crate::poly::load_serialized_hyper_graph_as_poly(
                &self.input_problem.serialized_hyper_graph,
                None,
            );
            return crate::poly::PolyHyperGraphSolver::new(
                loaded.topology,
                loaded.problem,
                Some(self.get_solve_graph_options()),
            )
            .visualize();
        }

        self.get_initial_visualization_solver().visualize()
    }

    pub fn visualize(&mut self) -> GraphicsObject {
        if self.iterations == 0 {
            return self.initial_visualize();
        }

        if let Some(section) = &self.optimize_section {
            return section.visualize();
        }

        if let Some(solver) = &self.solve_graph {
            if let Some(topology) = &self.poly_topology {
                return crate::poly::visualize_poly_hyper_graph_parts(solver, topology);
            }

            return solver.visualize();
        }

        self.initial_visualize()
    }

    pub fn step(&mut self) {
        if self.solved || self.failed {
            return;
        }

        self.iterations += 1;
        if self.iterations > self.max_iterations {
            self.try_final_acceptance();
            if !self.solved {
                self.failed = true;
                self.error = Some("Maximum iterations exceeded".into());
            }

            return;
        }

        if self.solve_graph.is_none() {
            let options = self.get_solve_graph_options();
            self.solve_graph = Some(if self.poly_mode {
                let loaded = crate::poly::load_serialized_hyper_graph_as_poly(
                    &self.input_problem.serialized_hyper_graph,
                    None,
                );
                self.poly_topology = Some(loaded.topology.clone());
                crate::poly::PolyHyperGraphSolver::new(
                    loaded.topology,
                    loaded.problem,
                    Some(options),
                )
                .core
            } else {
                let loaded = self.load_hyper_graph(&self.input_problem.serialized_hyper_graph);
                TinyHyperGraphSolver::new(loaded.topology, loaded.problem, Some(options))
            });
        }

        let solver = self.solve_graph.as_mut().unwrap();
        if !solver.solved {
            solver.step();
            if solver.failed {
                self.failed = true;
                self.error = solver.error.clone();
            }

            return;
        }

        if self.optimize_section.is_none() {
            let (t, p, s, o) = self.get_section_stage_params();
            self.optimize_section = Some(TinyHyperGraphSectionSolver::new(t, p, s, Some(o)));
        }

        let section = self.optimize_section.as_mut().unwrap();
        section.step();
        if section.failed {
            self.failed = true;
            self.error = section.error.clone();
        } else if section.solved {
            self.solved = true;
        }
    }

    pub fn solve(&mut self) {
        while !self.solved && !self.failed {
            self.step();
        }
    }

    pub fn get_output(&self) -> Value {
        if let Some(section) = &self.optimize_section
            && section.solved
            && !section.failed
        {
            return section.get_output();
        }

        if let Some(solver) = &self.solve_graph
            && solver.solved
            && !solver.failed
        {
            return solver.get_output();
        }

        Value::Null
    }

    pub fn try_final_acceptance(&mut self) {
        if self
            .solve_graph
            .as_ref()
            .map(|s| s.solved && !s.failed)
            .unwrap_or(false)
        {
            self.stats["acceptedSolveGraphOutputOnSectionPipelineTimeout"] = json!(true);
            self.solved = true;
            self.failed = false;
            self.error = None;
        }
    }
}
