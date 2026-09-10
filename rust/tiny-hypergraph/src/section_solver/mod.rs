pub mod section_candidate_families;
pub mod tiny_hyper_graph_section_pipeline_solver;
use crate::core::*;
use crate::graphics::GraphicsObject;
use crate::shuffle::shuffle;
use crate::types::RegionIntersectionCache;
use crate::visualize_tiny_graph::{TinyHyperGraphVisualizationOptions, visualize_tiny_graph};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};

#[derive(Clone)]
struct SectionSnapshot {
    port_assignment: Vec<i32>,
    region_segments: Vec<Vec<(i32, i32, i32)>>,
    region_intersection_caches: Vec<RegionIntersectionCache>,
}

#[derive(Clone)]
struct FixedSegment {
    region_id: i32,
    from_port_id: i32,
    to_port_id: i32,
}

#[derive(Clone)]
struct SectionRoutePlan {
    route_id: i32,
    fixed_segments: Vec<FixedSegment>,
    active_start_port_id: Option<i32>,
    active_end_port_id: Option<i32>,
    forced_start_region_id: Option<i32>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct TinyHyperGraphSectionSolverOptions {
    #[serde(flatten)]
    pub core: TinyHyperGraphSolverOptions,
    #[serde(rename = "MAX_RIPS")]
    pub max_rips: Option<f64>,
    #[serde(rename = "MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT")]
    pub max_rips_without_max_region_cost_improvement: Option<f64>,
    #[serde(rename = "EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST")]
    pub extra_rips_after_beating_baseline_max_region_cost: Option<f64>,
    #[serde(rename = "MAX_HOT_REGIONS")]
    pub max_hot_regions: Option<usize>,
}

fn snapshot(solver: &TinyHyperGraphSolver) -> SectionSnapshot {
    SectionSnapshot {
        port_assignment: solver.state.port_assignment.clone(),
        region_segments: solver.state.region_segments.clone(),
        region_intersection_caches: solver.state.region_intersection_caches.clone(),
    }
}

fn restore(solver: &mut TinyHyperGraphSolver, state: &SectionSnapshot) -> () {
    let cloned = state.clone();
    solver.state.port_assignment = cloned.port_assignment;
    solver.state.region_segments = cloned.region_segments;
    solver.state.region_intersection_caches = cloned.region_intersection_caches;
}

fn summarize(
    caches: &[RegionIntersectionCache],
    ids: impl Iterator<Item = usize>,
) -> RegionCostSummary {
    let mut max_region_cost: f64 = 0.0;
    let mut total_region_cost = 0.0;

    for id in ids {
        let cost = caches
            .get(id)
            .map(|c| c.existing_region_cost)
            .unwrap_or(0.0);
        max_region_cost = max_region_cost.max(cost);
        total_region_cost += cost;
    }

    RegionCostSummary {
        max_region_cost,
        total_region_cost,
    }
}

fn compare(left: &RegionCostSummary, right: &RegionCostSummary) -> f64 {
    if left.max_region_cost != right.max_region_cost {
        left.max_region_cost - right.max_region_cost
    } else {
        left.total_region_cost - right.total_region_cost
    }
}

fn ordered_route_path(
    topology: &TinyHyperGraphTopology,
    problem: &TinyHyperGraphProblem,
    solution: &TinyHyperGraphSolution,
    route: usize,
) -> (Vec<i32>, Vec<i32>) {
    let segments = solution
        .solved_route_path_segments
        .get(route)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let start = problem.route_start_port[route];
    let end = problem.route_end_port[route];
    if segments.is_empty() {
        assert!(
            start == end,
            "Route {route} does not have an existing solved path"
        );
        return (vec![start], vec![]);
    }

    let mut by_port = HashMap::<i32, Vec<usize>>::new();

    for (i, &(a, b)) in segments.iter().enumerate() {
        by_port.entry(a).or_default().push(i);
        by_port.entry(b).or_default().push(i);
    }

    let mut ports = vec![start];
    let mut regions = vec![];
    let mut used = HashSet::new();
    let mut current = start;
    let mut previous = None;

    while current != end {
        let next: Vec<usize> = by_port
            .get(&current)
            .into_iter()
            .flatten()
            .copied()
            .filter(|i| {
                let (a, b) = segments[*i];
                !used.contains(i) && Some(if a == current { b } else { a }) != previous
            })
            .collect();
        assert!(
            next.len() == 1,
            "Route {route} is not a single ordered path from {start} to {end}"
        );
        let index = next[0];
        let (a, b) = segments[index];
        let next_port = if a == current { b } else { a };
        used.insert(index);
        let explicit = solution
            .solved_route_path_region_ids
            .as_ref()
            .and_then(|r| r.get(route))
            .and_then(|r| r.get(index))
            .copied()
            .flatten();
        let region = explicit.unwrap_or_else(|| {
            *topology.incident_port_region[a as usize]
                .iter()
                .find(|r| topology.incident_port_region[b as usize].contains(r))
                .unwrap_or_else(|| panic!("Ports {a} and {b} do not share a region"))
        });
        regions.push(region);
        ports.push(next_port);
        previous = Some(current);
        current = next_port;
    }

    assert!(
        used.len() == segments.len(),
        "Route {route} contains disconnected solved segments"
    );
    (ports, regions)
}

fn apply_route_segments(
    solver: &mut TinyHyperGraphSolver,
    segments: Vec<Vec<(i32, i32, i32)>>,
) -> () {
    solver.state.port_assignment.fill(-1);
    solver.state.region_segments = vec![vec![]; solver.topology.region_count];
    solver.state.region_intersection_caches = (0..solver.topology.region_count)
        .map(|_| create_empty_region_intersection_cache())
        .collect();
    solver.state.current_route_id = None;
    solver.state.current_route_net_id = None;
    solver.state.unrouted_routes.clear();
    solver.state.candidate_queue.clear();
    solver.reset_candidate_best_costs();
    solver.state.goal_port_id = -1;
    solver.state.rip_count = 0;
    solver.state.region_congestion_cost.fill(0.0);

    for (r, segments) in segments.iter().enumerate() {
        for &(route, a, b) in segments {
            let net = solver.problem.route_net[route as usize];
            solver.state.current_route_net_id = Some(net);
            solver.state.region_segments[r].push((route, a, b));
            solver.state.port_assignment[a as usize] = net;
            solver.state.port_assignment[b as usize] = net;
            solver.append_segment_to_region_cache(r as i32, a, b);
        }
    }

    solver.state.current_route_id = None;
    solver.state.current_route_net_id = None;
    solver.solved = true;
    solver.failed = false;
    solver.error = None;
}

fn solved_from_segments(
    topology: &TinyHyperGraphTopology,
    problem: &TinyHyperGraphProblem,
    segments: Vec<Vec<(i32, i32, i32)>>,
    options: &TinyHyperGraphSolverOptions,
) -> TinyHyperGraphSolver {
    let mut solver =
        TinyHyperGraphSolver::new(topology.clone(), problem.clone(), Some(options.clone()));
    apply_route_segments(&mut solver, segments);
    solver
}

fn solved_from_solution(
    topology: &TinyHyperGraphTopology,
    problem: &TinyHyperGraphProblem,
    solution: &TinyHyperGraphSolution,
    options: &TinyHyperGraphSolverOptions,
) -> TinyHyperGraphSolver {
    let mut segments = vec![vec![]; topology.region_count];

    for route in 0..problem.route_count {
        let (ports, regions) = ordered_route_path(topology, problem, solution, route);

        for i in 1..ports.len() {
            segments[regions[i - 1] as usize].push((route as i32, ports[i - 1], ports[i]));
        }
    }

    solved_from_segments(topology, problem, segments, options)
}

fn create_section_route_plans(
    topology: &TinyHyperGraphTopology,
    problem: &TinyHyperGraphProblem,
    solution: &TinyHyperGraphSolution,
) -> (TinyHyperGraphProblem, Vec<SectionRoutePlan>, Vec<i32>) {
    let mut section_problem = problem.clone();
    section_problem.initial_assignments = None;
    let mut plans = vec![];
    let mut active = vec![];

    for route in 0..problem.route_count {
        let mut plan = SectionRoutePlan {
            route_id: route as i32,
            fixed_segments: vec![],
            active_start_port_id: None,
            active_end_port_id: None,
            forced_start_region_id: None,
        };
        let (ports, regions) = ordered_route_path(topology, problem, solution, route);
        let mut runs = vec![];
        let mut run_start = None;

        for (i, p) in ports.iter().enumerate() {
            let masked = problem.port_section_mask[*p as usize] == 1;
            if masked && run_start.is_none() {
                run_start = Some(i);
            } else if !masked && run_start.is_some() {
                runs.push((run_start.take().unwrap(), i - 1));
            }
        }

        if let Some(start) = run_start {
            runs.push((start, ports.len() - 1));
        }

        if runs.is_empty() {
            for i in 1..ports.len() {
                plan.fixed_segments.push(FixedSegment {
                    region_id: regions[i - 1],
                    from_port_id: ports[i - 1],
                    to_port_id: ports[i],
                });
            }

            plans.push(plan);
            continue;
        }

        assert!(
            runs.len() == 1,
            "Route {route} enters the section multiple times; only one contiguous section span is currently supported"
        );
        let start = runs[0].0.saturating_sub(1);
        let end = (runs[0].1 + 1).min(ports.len() - 1);
        assert!(
            end > start,
            "Route {route} does not have a valid section span"
        );

        for i in (1..=start).chain(end + 1..ports.len()) {
            plan.fixed_segments.push(FixedSegment {
                region_id: regions[i - 1],
                from_port_id: ports[i - 1],
                to_port_id: ports[i],
            });
        }

        plan.active_start_port_id = Some(ports[start]);
        plan.active_end_port_id = Some(ports[end]);
        plan.forced_start_region_id = regions.get(start).copied();
        section_problem.route_start_port[route] = ports[start];
        section_problem.route_end_port[route] = ports[end];
        active.push(route as i32);
        plans.push(plan);
    }

    (section_problem, plans, active)
}

pub fn get_active_section_route_ids(
    topology: &TinyHyperGraphTopology,
    problem: &TinyHyperGraphProblem,
    solution: &TinyHyperGraphSolution,
) -> Vec<i32> {
    let (_, _, active) = create_section_route_plans(topology, problem, solution);
    active
}

fn section_regions(topology: &TinyHyperGraphTopology, problem: &TinyHyperGraphProblem) -> Vec<i32> {
    let mut regions = vec![];

    for (p, mask) in problem.port_section_mask.iter().enumerate() {
        if *mask != 1 {
            continue;
        }

        for region in &topology.incident_port_region[p] {
            if !regions.contains(region) {
                regions.push(*region);
            }
        }
    }

    regions
}

pub struct TinyHyperGraphSectionSearchSolver {
    pub core: TinyHyperGraphSolver,
    best_snapshot: Option<SectionSnapshot>,
    fixed_snapshot: Option<SectionSnapshot>,
    best_summary: Option<RegionCostSummary>,
    baseline_beat_rip_count: Option<usize>,
    previous_best_max_region_cost: f64,
    rips_since_best_max_region_cost_improvement: usize,
    route_plans: Vec<SectionRoutePlan>,
    active_route_ids: Vec<i32>,
    mutable_region_ids: Vec<i32>,
    immutable_region_summary: RegionCostSummary,
    baseline_summary: RegionCostSummary,
    max_rips: f64,
    max_rips_without_max_region_cost_improvement: f64,
    extra_rips_after_beating_baseline_max_region_cost: f64,
}

impl TinyHyperGraphSectionSearchSolver {
    fn new(
        topology: TinyHyperGraphTopology,
        problem: TinyHyperGraphProblem,
        route_plans: Vec<SectionRoutePlan>,
        active_route_ids: Vec<i32>,
        mutable_region_ids: Vec<i32>,
        immutable_region_summary: RegionCostSummary,
        baseline_summary: RegionCostSummary,
        options: TinyHyperGraphSectionSolverOptions,
    ) -> Self {
        let mut core = TinyHyperGraphSolver::new(topology, problem, Some(options.core));
        core.state.unrouted_routes = active_route_ids.clone();
        core.deferred_section_callbacks = true;
        core.forced_start_region_ids = Some(
            route_plans
                .iter()
                .map(|p| p.forced_start_region_id)
                .collect(),
        );
        let mut solver = Self {
            core,
            best_snapshot: None,
            fixed_snapshot: None,
            best_summary: None,
            baseline_beat_rip_count: None,
            previous_best_max_region_cost: f64::INFINITY,
            rips_since_best_max_region_cost_improvement: 0,
            route_plans,
            active_route_ids,
            mutable_region_ids,
            immutable_region_summary,
            baseline_summary,
            max_rips: options.max_rips.unwrap_or(f64::INFINITY),
            max_rips_without_max_region_cost_improvement: options
                .max_rips_without_max_region_cost_improvement
                .unwrap_or(f64::INFINITY),
            extra_rips_after_beating_baseline_max_region_cost: options
                .extra_rips_after_beating_baseline_max_region_cost
                .unwrap_or(f64::INFINITY),
        };
        solver.apply_fixed_segments();
        solver.fixed_snapshot = Some(snapshot(&solver.core));
        solver
    }

    fn apply_fixed_segments(&mut self) -> () {
        for plan in &self.route_plans {
            for s in &plan.fixed_segments {
                let net = self.core.problem.route_net[plan.route_id as usize];
                self.core.state.current_route_net_id = Some(net);
                self.core.state.region_segments[s.region_id as usize].push((
                    plan.route_id,
                    s.from_port_id,
                    s.to_port_id,
                ));
                self.core.state.port_assignment[s.from_port_id as usize] = net;
                self.core.state.port_assignment[s.to_port_id as usize] = net;
                self.core
                    .append_segment_to_region_cache(s.region_id, s.from_port_id, s.to_port_id);
            }
        }

        self.core.state.current_route_id = None;
        self.core.state.current_route_net_id = None;
    }

    fn capture_best_state(&mut self, summary: RegionCostSummary) -> () {
        if self
            .best_summary
            .as_ref()
            .map(|best| compare(&summary, best) >= 0.0)
            .unwrap_or(false)
        {
            return;
        }

        self.best_summary = Some(summary);
        self.best_snapshot = Some(snapshot(&self.core));
    }

    fn restore_best_state(&mut self) -> () {
        let Some(best) = &self.best_snapshot else {
            return;
        };
        restore(&mut self.core, best);
        self.core.state.current_route_id = None;
        self.core.state.current_route_net_id = None;
        self.core.state.unrouted_routes.clear();
        self.core.state.candidate_queue.clear();
        self.core.reset_candidate_best_costs();
        self.core.state.goal_port_id = -1;
    }

    fn reset_routing_state_for_rerip(&mut self) -> () {
        if let Some(fixed) = &self.fixed_snapshot {
            restore(&mut self.core, fixed);
        } else {
            self.core.reset_routing_state_for_rerip();
            self.apply_fixed_segments();
        }

        self.core.state.current_route_id = None;
        self.core.state.current_route_net_id = None;
        self.core.state.unrouted_routes =
            shuffle(&self.active_route_ids, self.core.state.rip_count as u32);
        self.core.state.candidate_queue.clear();
        self.core.reset_candidate_best_costs();
        self.core.state.goal_port_id = -1;
    }

    fn on_all_routes_routed(&mut self) -> () {
        let max_rips = self
            .max_rips
            .min(self.core.options.rip_threshold_ramp_attempts);
        let rip = self.core.state.rip_count;
        let progress = if max_rips <= 0.0 {
            1.0
        } else {
            (rip as f64 / max_rips).min(1.0)
        };
        let threshold = self.core.options.rip_threshold_start
            + (self.core.options.rip_threshold_end - self.core.options.rip_threshold_start)
                * progress;
        let mut hot = vec![];
        let mut costs = vec![];
        let mut max: f64 = 0.0;
        let mut total = 0.0;

        for region in &self.mutable_region_ids {
            let cost =
                self.core.state.region_intersection_caches[*region as usize].existing_region_cost;
            costs.push(cost);
            max = max.max(cost);
            total += cost;
            if cost > threshold {
                hot.push(*region);
            }
        }

        max = max.max(self.immutable_region_summary.max_region_cost);
        total += self.immutable_region_summary.total_region_cost;
        self.capture_best_state(RegionCostSummary {
            max_region_cost: max,
            total_region_cost: total,
        });
        let best = self.best_summary.as_ref().unwrap();
        if best.max_region_cost < self.previous_best_max_region_cost - f64::EPSILON {
            self.previous_best_max_region_cost = best.max_region_cost;
            self.rips_since_best_max_region_cost_improvement = 0;
        } else {
            self.rips_since_best_max_region_cost_improvement += 1;
        }

        if self.baseline_beat_rip_count.is_none()
            && best.max_region_cost < self.baseline_summary.max_region_cost - f64::EPSILON
        {
            self.baseline_beat_rip_count = Some(rip);
        }

        merge_stats(
            &mut self.core.stats,
            json!({"activeRouteCount":self.active_route_ids.len(),"currentRipThreshold":threshold,"hotRegionCount":hot.len(),"maxRegionCost":max,"totalRegionCost":total,"bestMaxRegionCost":best.max_region_cost,"bestTotalRegionCost":best.total_region_cost,"ripCount":rip}),
        );
        if hot.is_empty()
            || rip as f64 >= max_rips
            || self.rips_since_best_max_region_cost_improvement as f64
                >= self.max_rips_without_max_region_cost_improvement
            || self
                .baseline_beat_rip_count
                .map(|baseline| {
                    (rip - baseline) as f64
                        >= self.extra_rips_after_beating_baseline_max_region_cost
                })
                .unwrap_or(false)
        {
            self.restore_best_state();
            self.core.solved = true;
            return;
        }

        for (region, cost) in self.mutable_region_ids.iter().zip(costs) {
            self.core.state.region_congestion_cost[*region as usize] +=
                cost * self.core.options.rip_congestion_region_cost_factor;
        }

        self.core.state.rip_count += 1;
        self.reset_routing_state_for_rerip();
        merge_stats(
            &mut self.core.stats,
            json!({"ripCount":self.core.state.rip_count,"reripRegionCount":hot.len()}),
        );
    }

    fn on_out_of_candidates(&mut self) -> () {
        for region in &self.mutable_region_ids {
            let cost =
                self.core.state.region_intersection_caches[*region as usize].existing_region_cost;
            self.core.state.region_congestion_cost[*region as usize] +=
                cost * self.core.options.rip_congestion_region_cost_factor;
        }

        self.core.state.rip_count += 1;
        self.reset_routing_state_for_rerip();
        merge_stats(
            &mut self.core.stats,
            json!({"ripCount":self.core.state.rip_count,"reripReason":"out_of_candidates"}),
        );
    }

    fn try_final_acceptance(&mut self) -> () {
        if self.best_snapshot.is_some() {
            self.restore_best_state();
            self.core.solved = true;
            return;
        }

        if let Some(fixed) = &self.fixed_snapshot {
            restore(&mut self.core, fixed);
        }

        self.core.state.current_route_id = None;
        self.core.state.current_route_net_id = None;
        self.core.state.unrouted_routes = self.active_route_ids.clone();
        self.core.state.candidate_queue.clear();
        self.core.reset_candidate_best_costs();
        self.core.state.goal_port_id = -1;
        merge_stats(
            &mut self.core.stats,
            json!({"acceptedFixedSectionStateOnTimeout":true}),
        );
        self.core.solved = true;
    }

    pub fn step(&mut self) -> () {
        self.core.step();
        match self.core.pending_section_event.take() {
            Some(SectionEvent::AllRoutesRouted) => self.on_all_routes_routed(),
            Some(SectionEvent::OutOfCandidates) => self.on_out_of_candidates(),
            Some(SectionEvent::FinalAcceptance) => self.try_final_acceptance(),
            None => {}
        }
    }

    pub fn visualize(&self) -> GraphicsObject {
        visualize_tiny_graph(
            &self.core,
            TinyHyperGraphVisualizationOptions {
                highlight_section_mask: true,
                show_initial_route_hints: Some(false),
                show_only_section_ports_on_idle: true,
                ..Default::default()
            },
        )
    }
}

pub(crate) fn merge_stats(stats: &mut Value, extra: Value) -> () {
    if !stats.is_object() {
        *stats = json!({});
    }

    for (key, value) in extra.as_object().unwrap() {
        stats[key] = value.clone();
    }
}

pub struct TinyHyperGraphSectionSolver {
    pub topology: TinyHyperGraphTopology,
    pub problem: TinyHyperGraphProblem,
    pub initial_solution: TinyHyperGraphSolution,
    pub baseline_solver: TinyHyperGraphSolver,
    pub baseline_summary: RegionCostSummary,
    pub section_baseline_summary: RegionCostSummary,
    pub outside_section_baseline_summary: RegionCostSummary,
    pub section_region_ids: Vec<i32>,
    pub optimized_solver: Option<TinyHyperGraphSolver>,
    pub section_solver: Option<TinyHyperGraphSectionSearchSolver>,
    pub active_route_ids: Vec<i32>,
    pub options: TinyHyperGraphSectionSolverOptions,
    pub solved: bool,
    pub failed: bool,
    pub error: Option<String>,
    pub stats: Value,
    pub iterations: usize,
    setup_done: bool,
    use_baseline: bool,
}

impl TinyHyperGraphSectionSolver {
    pub fn new(
        topology: TinyHyperGraphTopology,
        problem: TinyHyperGraphProblem,
        initial_solution: TinyHyperGraphSolution,
        options: Option<TinyHyperGraphSectionSolverOptions>,
    ) -> Self {
        let mut options = options.unwrap_or_default();
        options
            .core
            .static_reachability_precheck
            .get_or_insert(false);
        options
            .max_rips_without_max_region_cost_improvement
            .get_or_insert(10.0);
        options
            .extra_rips_after_beating_baseline_max_region_cost
            .get_or_insert(10.0);
        let baseline_solver =
            solved_from_solution(&topology, &problem, &initial_solution, &options.core);
        let caches = &baseline_solver.state.region_intersection_caches;
        let baseline_summary = summarize(caches, 0..caches.len());
        let section_region_ids = section_regions(&topology, &problem);
        let section_baseline_summary =
            summarize(caches, section_region_ids.iter().map(|r| *r as usize));
        let outside_section_baseline_summary = summarize(
            caches,
            (0..caches.len()).filter(|r| !section_region_ids.contains(&(*r as i32))),
        );
        let mut solver = Self {
            topology,
            problem,
            initial_solution,
            baseline_solver,
            baseline_summary,
            section_baseline_summary,
            outside_section_baseline_summary,
            section_region_ids,
            optimized_solver: None,
            section_solver: None,
            active_route_ids: vec![],
            options,
            solved: false,
            failed: false,
            error: None,
            stats: json!({}),
            iterations: 0,
            setup_done: false,
            use_baseline: false,
        };
        solver.apply_section_rip_policy();
        solver
    }

    fn apply_section_rip_policy(&mut self) -> () {
        self.options.core.rip_threshold_start = Some(0.05);
        self.options.core.rip_threshold_end =
            Some(self.section_baseline_summary.max_region_cost.max(0.05));
        self.options.max_rips = Some(self.options.max_rips.unwrap_or(f64::INFINITY).min(20.0));
    }

    fn setup(&mut self) -> () {
        self.apply_section_rip_policy();
        let (problem, plans, active) =
            create_section_route_plans(&self.topology, &self.problem, &self.initial_solution);
        self.active_route_ids = active.clone();
        if active.is_empty() {
            self.use_baseline = true;
            merge_stats(
                &mut self.stats,
                json!({"activeRouteCount":0,"initialMaxRegionCost":self.baseline_summary.max_region_cost,"finalMaxRegionCost":self.baseline_summary.max_region_cost,"optimized":false}),
            );
            self.solved = true;
            return;
        }

        self.section_solver = Some(TinyHyperGraphSectionSearchSolver::new(
            self.topology.clone(),
            problem,
            plans,
            active,
            self.section_region_ids.clone(),
            self.outside_section_baseline_summary.clone(),
            self.baseline_summary.clone(),
            self.options.clone(),
        ));
        merge_stats(
            &mut self.stats,
            json!({"sectionBaselineMaxRegionCost":self.section_baseline_summary.max_region_cost,"sectionBaselineTotalRegionCost":self.section_baseline_summary.total_region_cost,"effectiveRipThresholdStart":self.options.core.rip_threshold_start,"effectiveRipThresholdEnd":self.options.core.rip_threshold_end,"effectiveMaxRips":self.options.max_rips}),
        );
    }

    pub fn step(&mut self) -> () {
        if self.solved || self.failed {
            return;
        }

        if !self.setup_done {
            self.setup_done = true;
            self.setup();
            if self.solved {
                return;
            }
        }

        self.iterations += 1;
        if self.iterations as f64 > self.options.core.max_iterations.unwrap_or(1e6) {
            self.try_final_acceptance();
            return;
        }

        let Some(section) = &mut self.section_solver else {
            self.solved = true;
            return;
        };
        section.step();
        merge_stats(&mut self.stats, section.core.stats.clone());
        self.stats["activeRouteCount"] = json!(self.active_route_ids.len());
        if section.core.failed {
            self.use_baseline = true;
            merge_stats(
                &mut self.stats,
                json!({"initialMaxRegionCost":self.baseline_summary.max_region_cost,"initialTotalRegionCost":self.baseline_summary.total_region_cost,"finalMaxRegionCost":self.baseline_summary.max_region_cost,"finalTotalRegionCost":self.baseline_summary.total_region_cost,"optimized":false,"sectionSearchFailedFallbackToBaseline":true,"sectionSearchError":section.core.error}),
            );
            self.solved = true;
            return;
        }

        if !section.core.solved {
            return;
        }

        let candidate = solved_from_segments(
            &self.topology,
            &self.problem,
            section.core.state.region_segments.clone(),
            &self.options.core,
        );
        let summary = summarize(
            &candidate.state.region_intersection_caches,
            0..candidate.state.region_intersection_caches.len(),
        );
        let optimized = compare(&summary, &self.baseline_summary) < 0.0;
        let final_summary = if optimized {
            summary.clone()
        } else {
            self.baseline_summary.clone()
        };
        if optimized {
            self.optimized_solver = Some(candidate);
        } else {
            self.use_baseline = true;
        }

        merge_stats(
            &mut self.stats,
            json!({"initialMaxRegionCost":self.baseline_summary.max_region_cost,"initialTotalRegionCost":self.baseline_summary.total_region_cost,"candidateMaxRegionCost":summary.max_region_cost,"candidateTotalRegionCost":summary.total_region_cost,"finalMaxRegionCost":final_summary.max_region_cost,"finalTotalRegionCost":final_summary.total_region_cost,"optimized":optimized}),
        );
        self.solved = true;
    }

    pub fn solve(&mut self) -> () {
        while !self.solved && !self.failed {
            self.step();
        }
    }

    pub fn try_final_acceptance(&mut self) -> () {
        self.use_baseline = true;
        merge_stats(
            &mut self.stats,
            json!({"initialMaxRegionCost":self.baseline_summary.max_region_cost,"initialTotalRegionCost":self.baseline_summary.total_region_cost,"finalMaxRegionCost":self.baseline_summary.max_region_cost,"finalTotalRegionCost":self.baseline_summary.total_region_cost,"optimized":false,"sectionSolverTimeoutFallbackToBaseline":true}),
        );
        self.solved = true;
        self.failed = false;
        self.error = None;
    }

    pub fn get_solved_solver(&self) -> &TinyHyperGraphSolver {
        assert!(
            self.solved && !self.failed && (self.use_baseline || self.optimized_solver.is_some()),
            "TinyHyperGraphSectionSolver does not have a solved output yet"
        );
        if self.use_baseline {
            &self.baseline_solver
        } else {
            self.optimized_solver.as_ref().unwrap()
        }
    }

    pub fn visualize(&self) -> GraphicsObject {
        if self.use_baseline || self.optimized_solver.is_some() {
            return visualize_tiny_graph(
                self.get_solved_solver(),
                TinyHyperGraphVisualizationOptions {
                    highlight_section_mask: true,
                    ..Default::default()
                },
            );
        }

        if let Some(section) = &self.section_solver {
            return section.visualize();
        }

        visualize_tiny_graph(
            &self.baseline_solver,
            TinyHyperGraphVisualizationOptions {
                highlight_section_mask: true,
                show_initial_route_hints: Some(false),
                show_only_section_ports_on_idle: true,
                ..Default::default()
            },
        )
    }

    pub fn get_output(&self) -> Value {
        self.get_solved_solver().get_output()
    }
}
