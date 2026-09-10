use crate::compute_region_cost::{
    DEFAULT_MIN_VIA_PAD_DIAMETER, compute_region_cost, is_known_single_layer_mask,
};
use crate::count_new_intersections::count_new_intersections_with_values;
use crate::graphics::GraphicsObject;
use crate::initial_assignments::TinyHyperGraphInitialAssignment;
use crate::static_reachability::StaticallyUnroutableRouteSummary;
use crate::types::*;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    rc::Rc,
};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TinyHyperGraphTopology {
    pub port_count: usize,
    pub region_count: usize,
    pub region_incident_ports: Vec<Vec<PortId>>,
    pub incident_port_region: Vec<Vec<RegionId>>,
    pub region_width: Vec<f64>,
    pub region_height: Vec<f64>,
    pub region_center_x: Vec<f64>,
    pub region_center_y: Vec<f64>,
    pub region_available_z_mask: Option<Vec<i32>>,
    pub region_metadata: Option<Vec<Value>>,
    pub port_angle_for_region1: Vec<i32>,
    pub port_angle_for_region2: Option<Vec<i32>>,
    pub port_x: Vec<f64>,
    pub port_y: Vec<f64>,
    pub port_z: Vec<i32>,
    pub port_metadata: Option<Vec<Value>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TinyHyperGraphProblem {
    pub route_count: usize,
    pub port_section_mask: Vec<i32>,
    pub route_metadata: Option<Vec<Value>>,
    pub route_start_port: Vec<i32>,
    pub route_end_port: Vec<i32>,
    pub route_net: Vec<i32>,
    pub region_net_id: Vec<i32>,
    pub port_penalty: Option<Vec<f64>>,
    pub initial_assignments: Option<Vec<TinyHyperGraphInitialAssignment>>,
}

#[derive(Clone, Debug)]
pub struct TinyHyperGraphProblemSetup {
    pub port_h_cost_to_end_of_route: Option<Vec<f64>>,
    pub port_endpoint_net_ids: Vec<HashSet<NetId>>,
    pub port_endpoint_reservation_net_id: Vec<i32>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TinyHyperGraphSolution {
    pub solved_route_path_segments: Vec<Vec<(PortId, PortId)>>,
    pub solved_route_path_region_ids: Option<Vec<Vec<Option<RegionId>>>>,
}

#[derive(Clone, Debug)]
pub struct RegionCostSummary {
    pub max_region_cost: f64,
    pub total_region_cost: f64,
}

#[derive(Clone, Debug)]
pub struct SolvedStateSnapshot {
    pub port_assignment: Vec<i32>,
    pub region_segments: Vec<Vec<(RouteId, PortId, PortId)>>,
    pub region_intersection_caches: Vec<RegionIntersectionCache>,
    pub region_congestion_cost: Vec<f64>,
    pub rip_count: usize,
}

#[derive(Clone, Debug, Serialize)]
pub struct NeverSuccessfullyRoutedRouteSummary {
    #[serde(flatten)]
    pub route: StaticallyUnroutableRouteSummary,
    pub attempts: u32,
}

#[derive(Clone, Debug, Default)]
pub struct Candidate {
    pub prev_region_id: Option<RegionId>,
    pub port_id: PortId,
    pub next_region_id: RegionId,
    pub prev_candidate: Option<Rc<Candidate>>,
    pub f: f64,
    pub g: f64,
    pub h: f64,
    pub travel_distance: f64,
    pub at_goal: bool,
    pub bus_cost: Option<f64>,
    pub boundary_normal_x: Option<f64>,
    pub boundary_normal_y: Option<f64>,
}

pub trait TinyHyperGraphCandidateQueue {
    fn len(&self) -> usize;

    fn to_array(&self) -> Vec<Candidate>;

    fn clear(&mut self);

    fn queue(&mut self, candidate: Candidate);

    fn dequeue(&mut self) -> Option<Candidate>;

    fn is_closed_hop(&self, _port_id: PortId, _next_region_id: RegionId) -> bool {
        false
    }
}

pub enum CandidateStorage<T> {
    Dense(Vec<T>),
    Sparse(HashMap<HopId, T>),
}

pub struct TinyHyperGraphWorkingState {
    pub port_assignment: Vec<i32>,
    pub region_segments: Vec<Vec<(RouteId, PortId, PortId)>>,
    pub region_intersection_caches: Vec<RegionIntersectionCache>,
    pub current_route_net_id: Option<NetId>,
    pub current_route_id: Option<RouteId>,
    pub unrouted_routes: Vec<RouteId>,
    pub candidate_queue: Box<dyn TinyHyperGraphCandidateQueue>,
    pub candidate_best_cost_by_hop_id: CandidateStorage<f64>,
    pub candidate_best_cost_generation_by_hop_id: CandidateStorage<u32>,
    pub candidate_best_cost_generation: u32,
    pub goal_port_id: PortId,
    pub rip_count: usize,
    pub region_congestion_cost: Vec<f64>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct TinyHyperGraphSolverOptions {
    #[serde(rename = "minViaPadDiameter")]
    pub min_via_pad_diameter: Option<f64>,
    #[serde(rename = "DISTANCE_TO_COST")]
    pub distance_to_cost: Option<f64>,
    #[serde(rename = "RIP_THRESHOLD_START")]
    pub rip_threshold_start: Option<f64>,
    #[serde(rename = "RIP_THRESHOLD_END")]
    pub rip_threshold_end: Option<f64>,
    #[serde(rename = "RIP_THRESHOLD_RAMP_ATTEMPTS")]
    pub rip_threshold_ramp_attempts: Option<f64>,
    #[serde(rename = "RIP_CONGESTION_REGION_COST_FACTOR")]
    pub rip_congestion_region_cost_factor: Option<f64>,
    #[serde(rename = "USE_LAZY_ROUTE_HEURISTIC")]
    pub use_lazy_route_heuristic: Option<bool>,
    #[serde(rename = "USE_SPARSE_CANDIDATE_STORAGE")]
    pub use_sparse_candidate_storage: Option<bool>,
    #[serde(rename = "MAX_ITERATIONS")]
    pub max_iterations: Option<f64>,
    #[serde(rename = "VERBOSE")]
    pub verbose: Option<bool>,
    #[serde(rename = "STATIC_REACHABILITY_PRECHECK")]
    pub static_reachability_precheck: Option<bool>,
    #[serde(rename = "STATIC_REACHABILITY_PRECHECK_MAX_HOPS")]
    pub static_reachability_precheck_max_hops: Option<f64>,
    #[serde(rename = "ACCEPT_BEST_SOLUTION_ON_TIMEOUT")]
    pub accept_best_solution_on_timeout: Option<bool>,
    #[serde(rename = "GREEDY_FINAL_ROUTE_ITERS")]
    pub greedy_final_route_iters: Option<f64>,
    #[serde(rename = "PARTIAL_RIP_ENABLED")]
    pub partial_rip_enabled: Option<bool>,
    #[serde(rename = "PARTIAL_RIP_MIN_ROUTE_COUNT")]
    pub partial_rip_min_route_count: Option<f64>,
    #[serde(rename = "PARTIAL_RIP_MAX_ROUTE_COUNT")]
    pub partial_rip_max_route_count: Option<f64>,
    #[serde(rename = "PARTIAL_RIP_MAX_DISTANCE")]
    pub partial_rip_max_distance: Option<f64>,
    #[serde(rename = "PARTIAL_RIP_QUALITY_MAX_DISTANCE")]
    pub partial_rip_quality_max_distance: Option<f64>,
    #[serde(rename = "PARTIAL_RIP_MAX_ATTEMPTS")]
    pub partial_rip_max_attempts: Option<f64>,
    #[serde(rename = "PARTIAL_RIP_WARMUP_FULL_RIP_ATTEMPTS")]
    pub partial_rip_warmup_full_rip_attempts: Option<f64>,
    #[serde(rename = "PARTIAL_RIP_COMPLEXITY_SELECTION_MIN_ROUTE_COUNT")]
    pub partial_rip_complexity_selection_min_route_count: Option<f64>,
    #[serde(rename = "PARTIAL_RIP_TARGET_MAX_COST_IMPROVEMENT_RATIO")]
    pub partial_rip_target_max_cost_improvement_ratio: Option<f64>,
    #[serde(rename = "PARTIAL_RIP_MAX_REGION_COST_GROWTH_RATIO")]
    pub partial_rip_max_region_cost_growth_ratio: Option<f64>,
    #[serde(rename = "PARTIAL_RIP_MAX_TOTAL_COST_GROWTH_RATIO")]
    pub partial_rip_max_total_cost_growth_ratio: Option<f64>,
    #[serde(rename = "OUTSIDE_IN_ROUTING")]
    pub outside_in_routing: Option<bool>,
    #[serde(rename = "OUTSIDE_IN_MAX_DISTANCE")]
    pub outside_in_max_distance: Option<f64>,
}

#[derive(Clone, Debug)]
pub struct TinyHyperGraphSolverOptionTarget {
    pub min_via_pad_diameter: f64,
    pub distance_to_cost: f64,
    pub rip_threshold_start: f64,
    pub rip_threshold_end: f64,
    pub rip_threshold_ramp_attempts: f64,
    pub rip_congestion_region_cost_factor: f64,
    pub use_lazy_route_heuristic: bool,
    pub use_sparse_candidate_storage: bool,
    pub max_iterations: f64,
    pub verbose: bool,
    pub static_reachability_precheck: bool,
    pub static_reachability_precheck_max_hops: f64,
    pub accept_best_solution_on_timeout: bool,
    pub greedy_final_route_iters: f64,
    pub partial_rip_enabled: bool,
    pub partial_rip_min_route_count: f64,
    pub partial_rip_max_route_count: f64,
    pub partial_rip_max_distance: f64,
    pub partial_rip_quality_max_distance: Option<f64>,
    pub partial_rip_max_attempts: f64,
    pub partial_rip_warmup_full_rip_attempts: f64,
    pub partial_rip_complexity_selection_min_route_count: f64,
    pub partial_rip_target_max_cost_improvement_ratio: f64,
    pub partial_rip_max_region_cost_growth_ratio: f64,
    pub partial_rip_max_total_cost_growth_ratio: f64,
    pub outside_in_routing: bool,
    pub outside_in_max_distance: f64,
}

impl Default for TinyHyperGraphSolverOptionTarget {
    fn default() -> Self {
        Self {
            min_via_pad_diameter: DEFAULT_MIN_VIA_PAD_DIAMETER,
            distance_to_cost: 0.05,
            rip_threshold_start: 0.05,
            rip_threshold_end: 0.8,
            rip_threshold_ramp_attempts: 50.0,
            rip_congestion_region_cost_factor: 0.1,
            use_lazy_route_heuristic: false,
            use_sparse_candidate_storage: false,
            max_iterations: 1000000.0,
            verbose: false,
            static_reachability_precheck: true,
            static_reachability_precheck_max_hops: 16.0,
            accept_best_solution_on_timeout: true,
            greedy_final_route_iters: 4.0,
            partial_rip_enabled: false,
            partial_rip_min_route_count: 0.0,
            partial_rip_max_route_count: f64::INFINITY,
            partial_rip_max_distance: 12.0,
            partial_rip_quality_max_distance: None,
            partial_rip_max_attempts: f64::INFINITY,
            partial_rip_warmup_full_rip_attempts: 0.0,
            partial_rip_complexity_selection_min_route_count: f64::INFINITY,
            partial_rip_target_max_cost_improvement_ratio: 0.0,
            partial_rip_max_region_cost_growth_ratio: 0.2,
            partial_rip_max_total_cost_growth_ratio: 0.1,
            outside_in_routing: false,
            outside_in_max_distance: 24.0,
        }
    }
}

pub fn apply_tiny_hyper_graph_solver_options(
    target: &mut TinyHyperGraphSolverOptionTarget,
    options: Option<&TinyHyperGraphSolverOptions>,
) {
    if let Some(options) = options {
        if let Some(value) = options.min_via_pad_diameter {
            target.min_via_pad_diameter = value;
        }

        if let Some(value) = options.distance_to_cost {
            target.distance_to_cost = value;
        }

        if let Some(value) = options.rip_threshold_start {
            target.rip_threshold_start = value;
        }

        if let Some(value) = options.rip_threshold_end {
            target.rip_threshold_end = value;
        }

        if let Some(value) = options.rip_threshold_ramp_attempts {
            target.rip_threshold_ramp_attempts = value;
        }

        if let Some(value) = options.rip_congestion_region_cost_factor {
            target.rip_congestion_region_cost_factor = value;
        }

        if let Some(value) = options.use_lazy_route_heuristic {
            target.use_lazy_route_heuristic = value;
        }

        if let Some(value) = options.use_sparse_candidate_storage {
            target.use_sparse_candidate_storage = value;
        }

        if let Some(value) = options.max_iterations {
            target.max_iterations = value;
        }

        if let Some(value) = options.verbose {
            target.verbose = value;
        }

        if let Some(value) = options.static_reachability_precheck {
            target.static_reachability_precheck = value;
        }

        if let Some(value) = options.static_reachability_precheck_max_hops {
            target.static_reachability_precheck_max_hops = value;
        }

        if let Some(value) = options.accept_best_solution_on_timeout {
            target.accept_best_solution_on_timeout = value;
        }

        if let Some(value) = options.greedy_final_route_iters {
            target.greedy_final_route_iters = value;
        }

        if let Some(value) = options.partial_rip_enabled {
            target.partial_rip_enabled = value;
        }

        if let Some(value) = options.partial_rip_min_route_count {
            target.partial_rip_min_route_count = value;
        }

        if let Some(value) = options.partial_rip_max_route_count {
            target.partial_rip_max_route_count = value;
        }

        if let Some(value) = options.partial_rip_max_distance {
            target.partial_rip_max_distance = value;
        }

        if let Some(value) = options.partial_rip_quality_max_distance {
            target.partial_rip_quality_max_distance = Some(value);
        }

        if let Some(value) = options.partial_rip_max_attempts {
            target.partial_rip_max_attempts = value;
        }

        if let Some(value) = options.partial_rip_warmup_full_rip_attempts {
            target.partial_rip_warmup_full_rip_attempts = value;
        }

        if let Some(value) = options.partial_rip_complexity_selection_min_route_count {
            target.partial_rip_complexity_selection_min_route_count = value;
        }

        if let Some(value) = options.partial_rip_target_max_cost_improvement_ratio {
            target.partial_rip_target_max_cost_improvement_ratio = value;
        }

        if let Some(value) = options.partial_rip_max_region_cost_growth_ratio {
            target.partial_rip_max_region_cost_growth_ratio = value;
        }

        if let Some(value) = options.partial_rip_max_total_cost_growth_ratio {
            target.partial_rip_max_total_cost_growth_ratio = value;
        }

        if let Some(value) = options.outside_in_routing {
            target.outside_in_routing = value;
        }

        if let Some(value) = options.outside_in_max_distance {
            target.outside_in_max_distance = value;
        }
    }
}

pub fn get_tiny_hyper_graph_solver_options(
    target: &TinyHyperGraphSolverOptionTarget,
) -> TinyHyperGraphSolverOptions {
    TinyHyperGraphSolverOptions {
        min_via_pad_diameter: Some(target.min_via_pad_diameter),
        distance_to_cost: Some(target.distance_to_cost),
        rip_threshold_start: Some(target.rip_threshold_start),
        rip_threshold_end: Some(target.rip_threshold_end),
        rip_threshold_ramp_attempts: Some(target.rip_threshold_ramp_attempts),
        rip_congestion_region_cost_factor: Some(target.rip_congestion_region_cost_factor),
        use_lazy_route_heuristic: Some(target.use_lazy_route_heuristic),
        use_sparse_candidate_storage: Some(target.use_sparse_candidate_storage),
        max_iterations: Some(target.max_iterations),
        verbose: Some(target.verbose),
        static_reachability_precheck: Some(target.static_reachability_precheck),
        static_reachability_precheck_max_hops: Some(target.static_reachability_precheck_max_hops),
        accept_best_solution_on_timeout: Some(target.accept_best_solution_on_timeout),
        greedy_final_route_iters: Some(target.greedy_final_route_iters),
        partial_rip_enabled: Some(target.partial_rip_enabled),
        partial_rip_min_route_count: Some(target.partial_rip_min_route_count),
        partial_rip_max_route_count: Some(target.partial_rip_max_route_count),
        partial_rip_max_distance: Some(target.partial_rip_max_distance),
        partial_rip_quality_max_distance: target.partial_rip_quality_max_distance,
        partial_rip_max_attempts: Some(target.partial_rip_max_attempts),
        partial_rip_warmup_full_rip_attempts: Some(target.partial_rip_warmup_full_rip_attempts),
        partial_rip_complexity_selection_min_route_count: Some(
            target.partial_rip_complexity_selection_min_route_count,
        ),
        partial_rip_target_max_cost_improvement_ratio: Some(
            target.partial_rip_target_max_cost_improvement_ratio,
        ),
        partial_rip_max_region_cost_growth_ratio: Some(
            target.partial_rip_max_region_cost_growth_ratio,
        ),
        partial_rip_max_total_cost_growth_ratio: Some(
            target.partial_rip_max_total_cost_growth_ratio,
        ),
        outside_in_routing: Some(target.outside_in_routing),
        outside_in_max_distance: Some(target.outside_in_max_distance),
    }
}

#[derive(Clone, Debug, Default)]
pub struct SegmentGeometryScratch {
    pub lesser_angle: i32,
    pub greater_angle: i32,
    pub layer_mask: i32,
    pub entry_exit_layer_changes: i32,
}

#[derive(Clone, Debug)]
pub struct SolvedPathSegment {
    pub region_id: RegionId,
    pub from_port_id: PortId,
    pub to_port_id: PortId,
}

pub fn create_empty_region_intersection_cache() -> RegionIntersectionCache {
    RegionIntersectionCache {
        net_ids: vec![],
        lesser_angles: vec![],
        greater_angles: vec![],
        layer_masks: vec![],
        existing_crossing_layer_intersections: 0,
        existing_same_layer_intersections: 0,
        existing_entry_exit_layer_changes: 0,
        existing_region_cost: 0.0,
        existing_segment_count: 0,
    }
}

impl TinyHyperGraphCandidateQueue for crate::min_heap::MinHeap<Candidate> {
    fn len(&self) -> usize {
        self.length()
    }

    fn to_array(&self) -> Vec<Candidate> {
        self.to_array()
    }

    fn clear(&mut self) {
        self.clear();
    }

    fn queue(&mut self, candidate: Candidate) {
        self.queue(candidate);
    }

    fn dequeue(&mut self) -> Option<Candidate> {
        self.dequeue()
    }
}

#[derive(Clone, Copy, Debug)]
pub enum SectionEvent {
    AllRoutesRouted,
    OutOfCandidates,
    FinalAcceptance,
}

pub struct TinyHyperGraphSolver {
    pub active_route_endpoints: HashMap<RouteId, (PortId, PortId)>,
    pub forced_start_region_ids: Option<Vec<Option<i32>>>,
    pub deferred_section_callbacks: bool,
    pub pending_section_event: Option<SectionEvent>,
    pub topology: TinyHyperGraphTopology,
    pub problem: TinyHyperGraphProblem,
    pub options: TinyHyperGraphSolverOptionTarget,
    pub state: TinyHyperGraphWorkingState,
    pub candidate_hop_slot_stride: usize,
    pub candidate_hop_capacity: usize,
    pub candidate_first_region_by_port_id: Vec<i32>,
    pub candidate_second_region_by_port_id: Vec<i32>,
    pub candidate_overflow_best_cost: HashMap<HopId, f64>,
    pub problem_setup: Option<TinyHyperGraphProblemSetup>,
    pub route_attempt_count_by_route_id: Vec<u32>,
    pub route_success_count_by_route_id: Vec<u32>,
    pub best_solved_state_snapshot: Option<SolvedStateSnapshot>,
    pub best_solved_state_summary: Option<RegionCostSummary>,
    pub has_logged_never_successfully_routed_routes: bool,
    pub statically_unroutable_routes: Vec<StaticallyUnroutableRouteSummary>,
    pub segment_geometry_scratch: SegmentGeometryScratch,
    pub add_segment_distance_to_g: bool,
    pub region_area: Option<Vec<f64>>,
    pub greedy_final_route: bool,
    pub distance_aware_goal: bool,
    pub solved: bool,
    pub failed: bool,
    pub error: Option<String>,
    pub iterations: usize,
    pub stats: Value,
    pub is_setup: bool,
}

impl TinyHyperGraphSolver {
    pub fn new(
        topology: TinyHyperGraphTopology,
        problem: TinyHyperGraphProblem,
        options: Option<TinyHyperGraphSolverOptions>,
    ) -> Self {
        let mut settings = TinyHyperGraphSolverOptionTarget::default();
        apply_tiny_hyper_graph_solver_options(&mut settings, options.as_ref());
        let mut stride = 1;
        let mut first = vec![-1; topology.port_count];
        let mut second = first.clone();

        for port in 0..topology.port_count {
            let incident = &topology.incident_port_region[port];
            stride = stride.max(incident.len());
            first[port] = incident.first().copied().unwrap_or(-1);
            second[port] = incident.get(1).copied().unwrap_or(-1);
        }

        let capacity = topology.port_count * stride;
        let state = TinyHyperGraphWorkingState {
            port_assignment: vec![-1; topology.port_count],
            region_segments: vec![vec![]; topology.region_count],
            region_intersection_caches: (0..topology.region_count)
                .map(|_| create_empty_region_intersection_cache())
                .collect(),
            current_route_id: None,
            current_route_net_id: None,
            unrouted_routes: crate::utils::range(problem.route_count),
            candidate_queue: Box::new(crate::min_heap::MinHeap::new(
                vec![],
                |a: &Candidate, b: &Candidate| a.f - b.f,
            )),
            candidate_best_cost_by_hop_id: if settings.use_sparse_candidate_storage {
                CandidateStorage::Sparse(HashMap::new())
            } else {
                CandidateStorage::Dense(vec![0.0; capacity])
            },
            candidate_best_cost_generation_by_hop_id: if settings.use_sparse_candidate_storage {
                CandidateStorage::Sparse(HashMap::new())
            } else {
                CandidateStorage::Dense(vec![0; capacity])
            },
            candidate_best_cost_generation: 1,
            goal_port_id: -1,
            rip_count: 0,
            region_congestion_cost: vec![0.0; topology.region_count],
        };
        let route_count = problem.route_count;
        let mut solver = Self {
            active_route_endpoints: HashMap::new(),
            forced_start_region_ids: None,
            deferred_section_callbacks: false,
            pending_section_event: None,
            topology,
            problem,
            options: settings,
            state,
            candidate_hop_slot_stride: stride,
            candidate_hop_capacity: capacity,
            candidate_first_region_by_port_id: first,
            candidate_second_region_by_port_id: second,
            candidate_overflow_best_cost: HashMap::new(),
            problem_setup: None,
            route_attempt_count_by_route_id: vec![0; route_count],
            route_success_count_by_route_id: vec![0; route_count],
            best_solved_state_snapshot: None,
            best_solved_state_summary: None,
            has_logged_never_successfully_routed_routes: false,
            statically_unroutable_routes: vec![],
            segment_geometry_scratch: SegmentGeometryScratch::default(),
            add_segment_distance_to_g: false,
            region_area: None,
            greedy_final_route: false,
            distance_aware_goal: false,
            solved: false,
            failed: false,
            error: None,
            iterations: 0,
            stats: json!({}),
            is_setup: false,
        };
        if let Some(stats) = crate::initial_assignments::apply_initial_assignments(&mut solver) {
            solver.merge_stats(json!({"initialAssignmentCount":stats.initial_assignment_count,"initiallyRoutedRouteCount":stats.initially_routed_route_count}));
        }

        solver
    }

    pub fn merge_stats(&mut self, stats: Value) -> () {
        for (key, value) in stats.as_object().expect("stats must be object") {
            self.stats[key] = value.clone();
        }
    }

    pub fn compute_problem_setup(&self) -> TinyHyperGraphProblemSetup {
        let mut costs = if self.options.use_lazy_route_heuristic {
            None
        } else {
            Some(vec![
                0.0;
                self.topology.port_count * self.problem.route_count
            ])
        };
        let mut nets = vec![HashSet::new(); self.topology.port_count];
        let mut reservations = vec![-1; self.topology.port_count];

        for route in 0..self.problem.route_count {
            let net = self.problem.route_net[route];

            for port in [
                self.problem.route_start_port[route],
                self.problem.route_end_port[route],
            ] {
                nets[port as usize].insert(net);
                let reservation = &mut reservations[port as usize];
                if *reservation == -1 {
                    *reservation = net;
                } else if *reservation != net {
                    *reservation = -2;
                }
            }

            if let Some(costs) = costs.as_mut() {
                let end = self.problem.route_end_port[route] as usize;

                for port in 0..self.topology.port_count {
                    let dx = self.topology.port_x[port] - self.topology.port_x[end];
                    let dy = self.topology.port_y[port] - self.topology.port_y[end];
                    costs[port * self.problem.route_count + route] =
                        (dx * dx + dy * dy).sqrt() * self.options.distance_to_cost;
                }
            }
        }

        TinyHyperGraphProblemSetup {
            port_h_cost_to_end_of_route: costs,
            port_endpoint_net_ids: nets,
            port_endpoint_reservation_net_id: reservations,
        }
    }

    pub fn get_problem_setup(&mut self) -> &TinyHyperGraphProblemSetup {
        if self.problem_setup.is_none() {
            self.problem_setup = Some(self.compute_problem_setup());
        }

        self.problem_setup
            .as_ref()
            .expect("problem setup initialized")
    }

    pub fn setup(&mut self) -> () {
        self.get_problem_setup();
        self.is_setup = true;
        if self.options.static_reachability_precheck {
            self.statically_unroutable_routes =
                crate::static_reachability::get_statically_unroutable_routes_for_solver(self);
            if !self.statically_unroutable_routes.is_empty() {
                self.failed = true;
                self.error = Some(crate::static_reachability::get_static_reachability_error(
                    &self.statically_unroutable_routes,
                ));
                self.stats["staticallyUnroutableRouteCount"] =
                    json!(self.statically_unroutable_routes.len());
            }
        }
    }

    pub fn solve(&mut self) -> () {
        if !self.is_setup {
            self.setup();
        }

        while !self.solved && !self.failed && self.iterations < self.options.max_iterations as usize
        {
            self.step();
            self.iterations += 1;
        }

        if !self.solved && !self.failed {
            self.try_final_acceptance();
            if !self.solved {
                self.failed = true;
                self.error = Some("Maximum iterations reached".into());
            }
        }
    }

    pub fn step(&mut self) -> () {
        if self.state.current_route_id.is_none() {
            if self.state.unrouted_routes.is_empty() {
                self.on_all_routes_routed();
                return;
            }

            let route = self.state.unrouted_routes.remove(0);
            self.state.current_route_id = Some(route);
            self.state.current_route_net_id = Some(self.problem.route_net[route as usize]);
            self.route_attempt_count_by_route_id[route as usize] += 1;
            self.reset_candidate_best_costs();
            let start = self.get_route_start_port_id(route);
            self.state.candidate_queue.clear();
            let Some(region) = self.get_starting_next_region_id(route, start) else {
                self.failed = true;
                self.error = Some(format!("Start port {start} has no incident regions"));
                return;
            };
            self.set_candidate_best_cost(self.get_hop_id(start, region), 0.0);
            self.state.candidate_queue.queue(Candidate {
                port_id: start,
                next_region_id: region,
                ..Default::default()
            });
            self.state.goal_port_id = self.get_route_end_port_id(route);
        }

        let Some(candidate) = self.state.candidate_queue.dequeue() else {
            self.on_out_of_candidates();
            return;
        };
        if candidate.g
            > self.get_candidate_best_cost(
                self.get_hop_id(candidate.port_id, candidate.next_region_id),
            )
            || self.is_region_reserved_for_different_net(candidate.next_region_id)
        {
            return;
        }

        let neighbors =
            self.topology.region_incident_ports[candidate.next_region_id as usize].clone();

        for neighbor in neighbors {
            let assigned = self.state.port_assignment[neighbor as usize];
            if self.is_port_reserved_for_different_net(neighbor) {
                continue;
            }

            if neighbor == self.state.goal_port_id {
                if assigned != -1 && Some(assigned) != self.state.current_route_net_id {
                    continue;
                }

                self.on_path_found(candidate.clone());
                return;
            }

            if assigned != -1 && Some(assigned) != self.state.current_route_net_id {
                continue;
            }

            if neighbor == candidate.port_id
                || self.problem.port_section_mask[neighbor as usize] == 0
            {
                continue;
            }

            let incident = &self.topology.incident_port_region[neighbor as usize];
            let next = if incident.first() == Some(&candidate.next_region_id) {
                incident.get(1)
            } else {
                incident.first()
            };
            let Some(&next) = next else {
                continue;
            };
            if self.is_region_reserved_for_different_net(next) {
                continue;
            }

            let hop = self.get_hop_id(neighbor, next);
            if self.state.candidate_queue.is_closed_hop(neighbor, next) {
                continue;
            }

            let best = self.get_candidate_best_cost(hop);
            if candidate.g >= best {
                continue;
            }

            let g = self.compute_g(&candidate, neighbor, best, None);
            if !g.is_finite() || g >= best {
                continue;
            }

            let h = self.compute_h(neighbor);
            let new = Candidate {
                prev_region_id: Some(candidate.next_region_id),
                next_region_id: next,
                port_id: neighbor,
                g,
                h,
                f: g + h,
                prev_candidate: Some(Rc::new(candidate.clone())),
                ..Default::default()
            };
            if neighbor == self.state.goal_port_id {
                self.on_path_found(new);
                return;
            }

            self.set_candidate_best_cost(hop, g);
            self.state.candidate_queue.queue(new);
        }
    }

    pub fn reset_candidate_best_costs(&mut self) -> () {
        self.candidate_overflow_best_cost.clear();
        if self.state.candidate_best_cost_generation == u32::MAX {
            if let CandidateStorage::Sparse(m) = &mut self.state.candidate_best_cost_by_hop_id {
                m.clear();
            }

            match &mut self.state.candidate_best_cost_generation_by_hop_id {
                CandidateStorage::Sparse(m) => m.clear(),
                CandidateStorage::Dense(v) => v.fill(0),
            }

            self.state.candidate_best_cost_generation = 1;
            return;
        }

        self.state.candidate_best_cost_generation += 1;
    }

    pub fn get_candidate_best_cost(&self, hop: HopId) -> f64 {
        if hop < 0 {
            return self
                .candidate_overflow_best_cost
                .get(&hop)
                .copied()
                .unwrap_or(f64::INFINITY);
        }

        let generation = match &self.state.candidate_best_cost_generation_by_hop_id {
            CandidateStorage::Dense(v) => v[hop as usize],
            CandidateStorage::Sparse(m) => m.get(&hop).copied().unwrap_or(0),
        };
        if generation != self.state.candidate_best_cost_generation {
            return f64::INFINITY;
        }

        match &self.state.candidate_best_cost_by_hop_id {
            CandidateStorage::Dense(v) => v[hop as usize],
            CandidateStorage::Sparse(m) => *m.get(&hop).expect("generation has cost"),
        }
    }

    pub fn set_candidate_best_cost(&mut self, hop: HopId, cost: f64) -> () {
        if hop < 0 {
            self.candidate_overflow_best_cost.insert(hop, cost);
            return;
        }

        match &mut self.state.candidate_best_cost_generation_by_hop_id {
            CandidateStorage::Dense(v) => {
                v[hop as usize] = self.state.candidate_best_cost_generation
            }

            CandidateStorage::Sparse(m) => {
                m.insert(hop, self.state.candidate_best_cost_generation);
            }
        }

        match &mut self.state.candidate_best_cost_by_hop_id {
            CandidateStorage::Dense(v) => v[hop as usize] = cost,
            CandidateStorage::Sparse(m) => {
                m.insert(hop, cost);
            }
        }
    }

    pub fn get_hop_id(&self, port: PortId, next: RegionId) -> HopId {
        let base = port as i64 * self.candidate_hop_slot_stride as i64;
        if self.candidate_first_region_by_port_id[port as usize] == next {
            return base;
        }

        if self.candidate_second_region_by_port_id[port as usize] == next {
            return base + 1;
        }

        for (slot, region) in self.topology.incident_port_region[port as usize]
            .iter()
            .enumerate()
            .skip(2)
        {
            if *region == next {
                return base + slot as i64;
            }
        }

        -(port as i64 * self.topology.region_count as i64 + next as i64) - 1
    }

    pub fn get_starting_next_region_id(&self, route: RouteId, start: PortId) -> Option<RegionId> {
        if let Some(regions) = &self.forced_start_region_ids {
            if let Some(region) = regions[route as usize] {
                return Some(region);
            }
        }

        let incident = &self.topology.incident_port_region[start as usize];
        let net = self.problem.route_net[route as usize];
        incident
            .iter()
            .find(|&&r| self.problem.region_net_id[r as usize] == -1)
            .or_else(|| {
                incident
                    .iter()
                    .find(|&&r| self.problem.region_net_id[r as usize] == net)
            })
            .or(incident.first())
            .copied()
    }

    pub fn get_route_start_port_id(&self, route: RouteId) -> PortId {
        self.active_route_endpoints
            .get(&route)
            .map(|p| p.0)
            .unwrap_or(self.problem.route_start_port[route as usize])
    }

    pub fn get_route_end_port_id(&self, route: RouteId) -> PortId {
        self.active_route_endpoints
            .get(&route)
            .map(|p| p.1)
            .unwrap_or(self.problem.route_end_port[route as usize])
    }

    pub fn is_port_reserved_for_different_net(&self, port: PortId) -> bool {
        let reserved = self
            .problem_setup
            .as_ref()
            .expect("problem setup initialized")
            .port_endpoint_reservation_net_id[port as usize];
        reserved == -2 || (reserved != -1 && Some(reserved) != self.state.current_route_net_id)
    }

    pub fn is_region_reserved_for_different_net(&self, region: RegionId) -> bool {
        let reserved = self.problem.region_net_id[region as usize];
        reserved != -1 && Some(reserved) != self.state.current_route_net_id
    }

    pub fn is_known_single_layer_region(&self, region: RegionId) -> bool {
        is_known_single_layer_mask(
            self.topology
                .region_available_z_mask
                .as_ref()
                .map(|m| m[region as usize])
                .unwrap_or(0),
        )
    }

    pub fn compute_region_cost_for_region(
        &self,
        region: RegionId,
        same: i32,
        cross: i32,
        changes: i32,
        count: usize,
    ) -> f64 {
        let region = region as usize;
        let mask = self
            .topology
            .region_available_z_mask
            .as_ref()
            .map(|m| m[region])
            .unwrap_or(0);
        if let Some(area) = &self.region_area {
            return crate::compute_region_cost::compute_region_cost_for_area(
                area[region],
                same,
                cross,
                changes,
                count,
                mask,
                self.options.min_via_pad_diameter,
            );
        }

        compute_region_cost(
            self.topology.region_width[region],
            self.topology.region_height[region],
            same,
            cross,
            changes,
            count,
            mask,
            self.options.min_via_pad_diameter,
        )
    }

    pub fn populate_segment_geometry_scratch(
        &self,
        region: RegionId,
        p1: PortId,
        p2: PortId,
    ) -> SegmentGeometryScratch {
        let angle = |port: i32| {
            let p = port as usize;
            if self.candidate_first_region_by_port_id[p] == region
                || self.candidate_second_region_by_port_id[p] != region
            {
                self.topology.port_angle_for_region1[p]
            } else {
                self.topology
                    .port_angle_for_region2
                    .as_ref()
                    .map(|v| v[p])
                    .unwrap_or(self.topology.port_angle_for_region1[p])
            }
        };
        let a = angle(p1);
        let b = angle(p2);
        let z1 = self.topology.port_z[p1 as usize];
        let z2 = self.topology.port_z[p2 as usize];
        SegmentGeometryScratch {
            lesser_angle: a.min(b),
            greater_angle: a.max(b),
            layer_mask: (1 << z1) | (1 << z2),
            entry_exit_layer_changes: if z1 != z2 { 1 } else { 0 },
        }
    }

    pub fn append_segment_to_region_cache(
        &mut self,
        region: RegionId,
        p1: PortId,
        p2: PortId,
    ) -> () {
        let geo = self.populate_segment_geometry_scratch(region, p1, p2);
        let net = self.state.current_route_net_id.expect("segment route net");
        let mut cache = self.state.region_intersection_caches[region as usize].clone();
        let (same, cross, changes) = count_new_intersections_with_values(
            &cache,
            net,
            geo.lesser_angle,
            geo.greater_angle,
            geo.layer_mask,
            geo.entry_exit_layer_changes,
        );
        cache.net_ids.push(net);
        cache.lesser_angles.push(geo.lesser_angle);
        cache.greater_angles.push(geo.greater_angle);
        cache.layer_masks.push(geo.layer_mask);
        cache.existing_same_layer_intersections += same;
        cache.existing_crossing_layer_intersections += cross;
        cache.existing_entry_exit_layer_changes += changes;
        cache.existing_segment_count = cache.lesser_angles.len();
        cache.existing_region_cost = self.compute_region_cost_for_region(
            region,
            cache.existing_same_layer_intersections,
            cache.existing_crossing_layer_intersections,
            cache.existing_entry_exit_layer_changes,
            cache.existing_segment_count,
        );
        self.state.region_intersection_caches[region as usize] = cache;
    }

    pub fn get_solved_path_segments(&self, final_candidate: &Candidate) -> Vec<SolvedPathSegment> {
        let mut path = vec![];
        let mut cursor = Some(final_candidate);

        while let Some(c) = cursor {
            path.push(c);
            cursor = c.prev_candidate.as_deref();
        }

        path.reverse();
        let mut segments = vec![];

        for pair in path.windows(2) {
            segments.push(SolvedPathSegment {
                region_id: pair[0].next_region_id,
                from_port_id: pair[0].port_id,
                to_port_id: pair[1].port_id,
            });
        }

        if let Some(last) = path.last() {
            if last.port_id != self.state.goal_port_id {
                segments.push(SolvedPathSegment {
                    region_id: last.next_region_id,
                    from_port_id: last.port_id,
                    to_port_id: self.state.goal_port_id,
                });
            }
        }

        segments
    }

    pub fn reset_routing_state_for_rerip(&mut self) -> () {
        self.state.port_assignment.fill(-1);
        self.state.region_segments = vec![vec![]; self.topology.region_count];
        self.state.region_intersection_caches = (0..self.topology.region_count)
            .map(|_| create_empty_region_intersection_cache())
            .collect();
        self.state.current_route_net_id = None;
        self.state.current_route_id = None;
        self.state.unrouted_routes = crate::shuffle::shuffle(
            &crate::utils::range(self.problem.route_count),
            self.state.rip_count as u32,
        );
        self.state.candidate_queue.clear();
        self.reset_candidate_best_costs();
        self.state.goal_port_id = -1;
    }

    pub fn get_max_region_cost(&self) -> f64 {
        self.state
            .region_intersection_caches
            .iter()
            .fold(0.0_f64, |max, c| max.max(c.existing_region_cost))
    }

    pub fn get_route_metadata(&self, route: RouteId) -> Option<&Value> {
        self.problem
            .route_metadata
            .as_ref()
            .and_then(|m| m.get(route as usize))
    }

    pub fn get_route_connection_id(&self, route: RouteId) -> String {
        self.get_route_metadata(route)
            .and_then(|v| v.get("connectionId"))
            .and_then(Value::as_str)
            .map(str::to_owned)
            .unwrap_or_else(|| format!("route-{route}"))
    }

    pub fn get_route_summary(&self, route: RouteId) -> StaticallyUnroutableRouteSummary {
        crate::static_reachability::create_statically_unroutable_route_summary(
            &self.problem,
            route,
            &|r| self.get_route_metadata(r).cloned(),
            &|r| self.get_route_connection_id(r),
        )
    }

    pub fn get_additional_region_label(&self, _region: RegionId) -> Option<String> {
        None
    }

    pub fn get_never_successfully_routed_routes(&self) -> Vec<NeverSuccessfullyRoutedRouteSummary> {
        let mut routes = vec![];

        for route in 0..self.problem.route_count {
            let attempts = self.route_attempt_count_by_route_id[route];
            if attempts == 0 || self.route_success_count_by_route_id[route] > 0 {
                continue;
            }

            routes.push(NeverSuccessfullyRoutedRouteSummary {
                route: self.get_route_summary(route as i32),
                attempts,
            });
        }

        routes
    }

    pub fn get_statically_unroutable_routes(&self) -> &[StaticallyUnroutableRouteSummary] {
        &self.statically_unroutable_routes
    }

    pub fn log_never_successfully_routed_routes(&mut self) -> () {
        if !self.options.verbose || self.has_logged_never_successfully_routed_routes {
            return;
        }

        let routes = self.get_never_successfully_routed_routes();
        self.has_logged_never_successfully_routed_routes = true;
        if routes.is_empty() {
            return;
        }

        println!(
            "[TinyHyperGraphSolver:never-routed-summary] count={}",
            routes.len()
        );

        for summary in routes {
            let r = summary.route;
            let path = if r.point_ids.len() >= 2 {
                format!("{}->{}", r.point_ids[0], r.point_ids[1])
            } else {
                "unknown".into()
            };
            println!(
                "[TinyHyperGraphSolver:never-routed] routeId={} connectionId={} attempts={} pointPath={} startRegionId={} endRegionId={}",
                r.route_id,
                r.connection_id,
                summary.attempts,
                path,
                r.start_region_id.as_deref().unwrap_or("unknown"),
                r.end_region_id.as_deref().unwrap_or("unknown")
            );
        }
    }

    pub fn log_rip_event(&self, reason: &str, max_cost: f64, extra: Value) -> () {
        if !self.options.verbose {
            return;
        }

        let mut fields = vec![
            "[TinyHyperGraphSolver:rip]".to_string(),
            format!("ripCount={}", self.state.rip_count),
            format!("maxRegionCostBeforeRip={max_cost:.3}"),
            format!("reason={reason}"),
        ];

        for (key, value) in extra.as_object().expect("rip fields object") {
            let text = if let Some(n) = value.as_f64() {
                if n.fract() == 0.0 {
                    format!("{n:.0}")
                } else {
                    format!("{n:.3}")
                }
            } else {
                value.as_str().expect("rip string field").to_owned()
            };
            fields.push(format!("{key}={text}"));
        }

        println!("{}", fields.join(" "));
    }

    pub fn compare_region_cost_summaries(
        &self,
        left: &RegionCostSummary,
        right: &RegionCostSummary,
    ) -> f64 {
        if left.max_region_cost != right.max_region_cost {
            left.max_region_cost - right.max_region_cost
        } else {
            left.total_region_cost - right.total_region_cost
        }
    }

    pub fn capture_best_solved_state(&mut self, summary: RegionCostSummary) -> () {
        if self
            .best_solved_state_summary
            .as_ref()
            .is_some_and(|best| self.compare_region_cost_summaries(&summary, best) >= 0.0)
        {
            return;
        }

        self.replace_best_solved_state(summary);
    }

    pub fn snapshot(&self) -> SolvedStateSnapshot {
        SolvedStateSnapshot {
            port_assignment: self.state.port_assignment.clone(),
            region_segments: self.state.region_segments.clone(),
            region_intersection_caches: self.state.region_intersection_caches.clone(),
            region_congestion_cost: self.state.region_congestion_cost.clone(),
            rip_count: self.state.rip_count,
        }
    }

    pub fn replace_best_solved_state(&mut self, summary: RegionCostSummary) -> () {
        self.best_solved_state_summary = Some(summary);
        self.best_solved_state_snapshot = Some(self.snapshot());
    }

    pub fn restore_best_solved_state(&mut self) -> () {
        let Some(snapshot) = self.best_solved_state_snapshot.clone() else {
            return;
        };
        self.state.port_assignment = snapshot.port_assignment;
        self.state.region_segments = snapshot.region_segments;
        self.state.region_intersection_caches = snapshot.region_intersection_caches;
        self.state.region_congestion_cost = snapshot.region_congestion_cost;
        self.state.rip_count = snapshot.rip_count;
        self.state.current_route_id = None;
        self.state.current_route_net_id = None;
        self.state.unrouted_routes.clear();
        self.state.candidate_queue.clear();
        self.reset_candidate_best_costs();
        self.state.goal_port_id = -1;
    }

    pub fn get_remaining_route_ids_for_greedy_final_route(&self) -> Vec<RouteId> {
        let mut routes = self.state.unrouted_routes.clone();
        if let Some(route) = self.state.current_route_id {
            if !routes.contains(&route) {
                routes.push(route);
            }
        }

        routes
    }

    pub fn apply_snapshot_to_greedy_final_route_solver(
        solver: &mut TinyHyperGraphSolver,
        snapshot: &SolvedStateSnapshot,
        routes: &[RouteId],
    ) -> () {
        solver.state.port_assignment = snapshot.port_assignment.clone();
        solver.state.region_segments = snapshot.region_segments.clone();
        solver.state.region_intersection_caches = snapshot.region_intersection_caches.clone();
        solver.state.region_congestion_cost = snapshot.region_congestion_cost.clone();
        solver.state.rip_count = 0;
        solver.state.current_route_id = None;
        solver.state.current_route_net_id = None;
        solver.state.unrouted_routes = routes.to_vec();
        solver.state.candidate_queue.clear();
        solver.reset_candidate_best_costs();
        solver.state.goal_port_id = -1;
    }

    pub fn summarize_solved_state(&self) -> RegionCostSummary {
        let mut summary = RegionCostSummary {
            max_region_cost: 0.0,
            total_region_cost: 0.0,
        };

        for cache in &self.state.region_intersection_caches {
            summary.max_region_cost = summary.max_region_cost.max(cache.existing_region_cost);
            summary.total_region_cost += cache.existing_region_cost;
        }

        summary
    }

    pub fn try_greedy_final_route_acceptance(&mut self) -> bool {
        let iterations = self.options.greedy_final_route_iters.max(0.0).floor() as usize;
        if iterations == 0 {
            return false;
        }

        let remaining = self.get_remaining_route_ids_for_greedy_final_route();
        if remaining.is_empty() {
            return false;
        }

        let snapshot = self.snapshot();

        for iteration in 0..iterations {
            let routes = if iteration == 0 {
                remaining.clone()
            } else {
                crate::shuffle::shuffle(&remaining, (self.state.rip_count + iteration) as u32)
            };
            let mut options = get_tiny_hyper_graph_solver_options(&self.options);
            options.accept_best_solution_on_timeout = Some(false);
            options.greedy_final_route_iters = Some(0.0);
            options.max_iterations = Some(50_000.0);
            options.rip_threshold_ramp_attempts = Some(0.0);
            options.static_reachability_precheck = Some(false);
            let mut greedy = TinyHyperGraphSolver::new(
                self.topology.clone(),
                self.problem.clone(),
                Some(options),
            );
            greedy.greedy_final_route = true;
            Self::apply_snapshot_to_greedy_final_route_solver(&mut greedy, &snapshot, &routes);
            greedy.solve();
            if !greedy.solved || greedy.failed {
                continue;
            }

            self.best_solved_state_snapshot = Some(greedy.snapshot());
            self.best_solved_state_summary = Some(greedy.summarize_solved_state());
            self.restore_best_solved_state();
            let summary = self
                .best_solved_state_summary
                .as_ref()
                .expect("greedy summary");
            self.merge_stats(json!({"acceptedGreedyFinalRouteOnTimeout":true,"greedyFinalRouteIter":iteration,"greedyFinalRouteRemainingRouteCount":remaining.len(),"greedyFinalRouteMaxIterations":50000,"neverSuccessfullyRoutedRouteCount":0,"maxRegionCost":summary.max_region_cost,"totalRegionCost":summary.total_region_cost,"bestMaxRegionCost":summary.max_region_cost,"bestTotalRegionCost":summary.total_region_cost}));
            self.solved = true;
            self.failed = false;
            self.error = None;
            return true;
        }

        self.merge_stats(json!({"greedyFinalRouteAttemptCount":iterations,"greedyFinalRouteRemainingRouteCount":remaining.len(),"greedyFinalRouteMaxIterations":50000}));
        false
    }

    pub fn on_all_routes_routed(&mut self) -> () {
        if self.deferred_section_callbacks {
            self.pending_section_event = Some(SectionEvent::AllRoutesRouted);
            return;
        }

        let progress = if self.options.rip_threshold_ramp_attempts <= 0.0 {
            1.0
        } else {
            (self.state.rip_count as f64 / self.options.rip_threshold_ramp_attempts).min(1.0)
        };
        let threshold = self.options.rip_threshold_start
            + (self.options.rip_threshold_end - self.options.rip_threshold_start) * progress;
        let costs: Vec<f64> = self
            .state
            .region_intersection_caches
            .iter()
            .map(|c| c.existing_region_cost)
            .collect();
        let hot: Vec<usize> = costs
            .iter()
            .enumerate()
            .filter_map(|(i, &c)| if c > threshold { Some(i) } else { None })
            .collect();
        let summary = self.summarize_solved_state();
        self.capture_best_solved_state(summary.clone());
        let best = self
            .best_solved_state_summary
            .as_ref()
            .expect("best solved summary");
        self.merge_stats(json!({"currentRipThreshold":threshold,"hotRegionCount":hot.len(),"maxRegionCost":summary.max_region_cost,"totalRegionCost":summary.total_region_cost,"bestMaxRegionCost":best.max_region_cost,"bestTotalRegionCost":best.total_region_cost,"ripCount":self.state.rip_count}));
        if hot.is_empty() || self.state.rip_count as f64 >= self.options.rip_threshold_ramp_attempts
        {
            self.solved = true;
            return;
        }

        for (region, cost) in costs.into_iter().enumerate() {
            self.state.region_congestion_cost[region] +=
                cost * self.options.rip_congestion_region_cost_factor;
        }

        self.state.rip_count += 1;
        self.reset_routing_state_for_rerip();
        self.merge_stats(json!({"ripCount":self.state.rip_count,"maxRegionCostBeforeRip":summary.max_region_cost,"reripRegionCount":hot.len()}));
        self.log_rip_event(
            "hot_regions",
            summary.max_region_cost,
            json!({"hotRegionCount":hot.len(),"currentRipThreshold":threshold}),
        );
    }

    pub fn on_out_of_candidates(&mut self) -> () {
        if self.deferred_section_callbacks {
            self.pending_section_event = Some(SectionEvent::OutOfCandidates);
            return;
        }

        let route = self.state.current_route_id;
        let max = self.get_max_region_cost();

        for region in 0..self.topology.region_count {
            self.state.region_congestion_cost[region] +=
                self.state.region_intersection_caches[region].existing_region_cost
                    * self.options.rip_congestion_region_cost_factor;
        }

        self.state.rip_count += 1;
        self.reset_routing_state_for_rerip();
        self.merge_stats(json!({"ripCount":self.state.rip_count,"maxRegionCost":max,"maxRegionCostBeforeRip":max,"reripReason":"out_of_candidates"}));
        self.log_rip_event(
            "out_of_candidates",
            max,
            route
                .map(|r| json!({"routeId":r,"connectionId":self.get_route_connection_id(r)}))
                .unwrap_or(json!({})),
        );
    }

    pub fn on_path_found(&mut self, final_candidate: Candidate) -> () {
        if self.distance_aware_goal && final_candidate.port_id != self.state.goal_port_id {
            let goal = self.state.goal_port_id;
            let g = self.compute_g(&final_candidate, goal, f64::INFINITY, None);
            if !g.is_finite() {
                return;
            }

            let hop = self.get_hop_id(goal, final_candidate.next_region_id);
            if g >= self.get_candidate_best_cost(hop) {
                return;
            }

            self.set_candidate_best_cost(hop, g);
            self.state.candidate_queue.queue(Candidate {
                prev_region_id: Some(final_candidate.next_region_id),
                next_region_id: final_candidate.next_region_id,
                port_id: goal,
                g,
                h: 0.0,
                f: g,
                prev_candidate: Some(Rc::new(final_candidate)),
                ..Default::default()
            });
            return;
        }

        let Some(route) = self.state.current_route_id else {
            return;
        };
        self.route_success_count_by_route_id[route as usize] += 1;

        for segment in self.get_solved_path_segments(&final_candidate) {
            self.state.region_segments[segment.region_id as usize].push((
                route,
                segment.from_port_id,
                segment.to_port_id,
            ));
            let net = self.state.current_route_net_id.expect("active route net");
            self.state.port_assignment[segment.from_port_id as usize] = net;
            self.state.port_assignment[segment.to_port_id as usize] = net;
            self.append_segment_to_region_cache(
                segment.region_id,
                segment.from_port_id,
                segment.to_port_id,
            );
        }

        self.state.candidate_queue.clear();
        self.state.current_route_net_id = None;
        self.state.current_route_id = None;
    }

    pub fn compute_g(
        &mut self,
        candidate: &Candidate,
        neighbor: PortId,
        maximum: f64,
        known_distance: Option<f64>,
    ) -> f64 {
        if self.greedy_final_route {
            return candidate.g;
        }

        let region = candidate.next_region_id;
        let mut distance_cost = 0.0;
        if self.add_segment_distance_to_g {
            let distance = known_distance.unwrap_or_else(|| {
                let dx = self.topology.port_x[candidate.port_id as usize]
                    - self.topology.port_x[neighbor as usize];
                let dy = self.topology.port_y[candidate.port_id as usize]
                    - self.topology.port_y[neighbor as usize];
                (dx * dx + dy * dy).sqrt()
            });
            distance_cost = distance * self.options.distance_to_cost;
        }

        let congestion = self.state.region_congestion_cost[region as usize];
        let penalty = self
            .problem
            .port_penalty
            .as_ref()
            .map(|p| p[neighbor as usize])
            .unwrap_or(0.0);
        if candidate.g + congestion + penalty + distance_cost > maximum + 1e-9 {
            return f64::INFINITY;
        }

        let geo = self.populate_segment_geometry_scratch(region, candidate.port_id, neighbor);
        let cache = &self.state.region_intersection_caches[region as usize];
        let (same, cross, changes) = count_new_intersections_with_values(
            cache,
            self.state.current_route_net_id.expect("active route net"),
            geo.lesser_angle,
            geo.greater_angle,
            geo.layer_mask,
            geo.entry_exit_layer_changes,
        );
        if same > 0 && self.is_known_single_layer_region(region) {
            return f64::INFINITY;
        }

        let cost = self.compute_region_cost_for_region(
            region,
            cache.existing_same_layer_intersections + same,
            cache.existing_crossing_layer_intersections + cross,
            cache.existing_entry_exit_layer_changes + changes,
            cache.existing_segment_count + 1,
        ) - cache.existing_region_cost;
        candidate.g + cost + congestion + penalty + distance_cost
    }

    pub fn try_final_acceptance(&mut self) -> () {
        if self.deferred_section_callbacks {
            self.pending_section_event = Some(SectionEvent::FinalAcceptance);
            return;
        }

        self.stats["neverSuccessfullyRoutedRouteCount"] =
            json!(self.get_never_successfully_routed_routes().len());
        if self.options.accept_best_solution_on_timeout
            && self.best_solved_state_snapshot.is_some()
            && self.best_solved_state_summary.is_some()
        {
            self.restore_best_solved_state();
            let summary = self
                .best_solved_state_summary
                .as_ref()
                .expect("best solved summary");
            self.merge_stats(json!({"acceptedBestSolutionOnTimeout":true,"maxRegionCost":summary.max_region_cost,"totalRegionCost":summary.total_region_cost,"bestMaxRegionCost":summary.max_region_cost,"bestTotalRegionCost":summary.total_region_cost}));
            self.solved = true;
            self.failed = false;
            self.error = None;
            return;
        }

        if self.options.accept_best_solution_on_timeout && self.try_greedy_final_route_acceptance()
        {
            return;
        }

        self.log_never_successfully_routed_routes();
    }

    pub fn compute_h(&mut self, neighbor: PortId) -> f64 {
        let route = self.state.current_route_id.expect("active route");
        let count = self.problem.route_count;
        if !self.active_route_endpoints.contains_key(&route) {
            if let Some(costs) = &self.get_problem_setup().port_h_cost_to_end_of_route {
                return costs[neighbor as usize * count + route as usize];
            }
        }

        let end = self.get_route_end_port_id(route) as usize;
        let dx = self.topology.port_x[neighbor as usize] - self.topology.port_x[end];
        let dy = self.topology.port_y[neighbor as usize] - self.topology.port_y[end];
        (dx * dx + dy * dy).sqrt() * self.options.distance_to_cost
    }

    pub fn visualize(&self) -> GraphicsObject {
        crate::visualize_tiny_graph::visualize_tiny_graph(self, Default::default())
    }

    pub fn get_output(&self) -> Value {
        crate::compat::convert_to_serialized_hyper_graph::convert_to_serialized_hyper_graph(self)
    }
}
