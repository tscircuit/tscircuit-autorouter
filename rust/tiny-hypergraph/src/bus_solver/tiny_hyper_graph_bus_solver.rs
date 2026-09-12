use super::bus_boundary_planner::{BusBoundaryPlanner, BusBoundaryPlannerOptions};
use super::bus_trace_inference_planner::BusTraceInferencePlanner;
use super::derive_bus_trace_order::{BusTraceOrder, derive_bus_trace_order};
use super::preview_routing_state::{
    PreviewIntersectionCounts, restore_preview_routing_state, snapshot_preview_routing_state,
};
use super::{bus_goal_search::*, bus_path_helpers::*, bus_solver_types::*, geometry::*};
use crate::core::{TinyHyperGraphProblem, TinyHyperGraphSolver, TinyHyperGraphTopology};
use crate::count_new_intersections::count_new_intersections_with_values;
use crate::graphics::GraphicsObject;
use crate::min_heap::MinHeap;
use crate::types::{NetId, PortId, RegionId, RouteId};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    rc::Rc,
};

#[derive(Clone)]
struct PreviewMetricsSnapshot {
    touched_region_ids: Vec<RegionId>,
    touched_port_ids: Vec<PortId>,
    same_layer_intersection_count: i32,
    crossing_layer_intersection_count: i32,
    total_region_cost: f64,
}

struct RemainderOption {
    segments: Vec<TraceSegment>,
    preview_cost: f64,
}

struct ManualPortOption {
    boundary_step: BoundaryStep,
    port_id: PortId,
    score: f64,
}

pub struct TinyHyperGraphBusSolver {
    pub core: TinyHyperGraphSolver,
    pub bus_end_margin_steps: usize,
    pub bus_max_remainder_steps: usize,
    pub bus_remainder_guide_weight: f64,
    pub bus_remainder_goal_weight: f64,
    pub bus_remainder_side_weight: f64,
    pub complete_trace_option_branch_limit: usize,
    pub bus_min_trace_progress_ratio: f64,
    pub bus_min_trace_progress_threshold: usize,
    pub center_greedy_heuristic_multiplier: f64,
    pub center_port_options_per_edge: usize,
    pub bus_trace_length_margin: f64,
    pub bus_max_trace_steps: usize,
    pub manual_center_finish_max_hops: i32,
    pub manual_center_finish_port_options_per_boundary: usize,
    pub manual_center_finish_candidate_limit: usize,
    pub trace_alongside_search_branch_limit: usize,
    pub trace_alongside_search_beam_width: usize,
    pub trace_alongside_search_option_limit: usize,
    pub trace_alongside_lane_weight: f64,
    pub trace_alongside_regression_weight: f64,
    pub bus_trace_order: BusTraceOrder,
    pub center_trace_index: usize,
    pub center_route_id: RouteId,
    pub center_route_net_id: NetId,
    pub center_goal_transit_region_id: RegionId,
    pub center_goal_hop_distance_by_region: Vec<i32>,
    pub other_trace_indices: Vec<usize>,
    pub commit_trace_indices: Vec<usize>,
    pub trace_pitch: f64,
    pub region_distance_to_goal_by_region: Vec<f64>,
    pub queue_all_candidates: bool,
    pub show_unassigned_ports_in_visualization: bool,
    boundary_planner: BusBoundaryPlanner,
    centerline_neighbor_region_ids_by_region: Vec<Vec<RegionId>>,
    preview_touched_region_mask: Vec<u8>,
    preview_touched_port_mask: Vec<u8>,
    region_index_by_serialized_id: HashMap<String, RegionId>,
    candidate_best_cost_by_state_key: HashMap<String, f64>,
    queued_candidate_best_cost_by_state_key: HashMap<String, f64>,
    preview_touched_region_ids: Vec<RegionId>,
    preview_touched_port_ids: Vec<PortId>,
    preview_same_layer_intersection_count: i32,
    preview_crossing_layer_intersection_count: i32,
    preview_total_region_cost: f64,
    last_expanded_candidate: Option<BusCenterCandidate>,
    last_preview: Option<BusPreview>,
    last_neighbor_count: usize,
    last_queued_neighbor_count: usize,
}

impl TinyHyperGraphBusSolver {
    pub fn new(
        topology: TinyHyperGraphTopology,
        problem: TinyHyperGraphProblem,
        options: Option<TinyHyperGraphBusSolverOptions>,
    ) -> Self {
        let options = options.unwrap_or_default();
        let mut core = TinyHyperGraphSolver::new(topology, problem, Some(options.core.clone()));
        core.get_problem_setup();
        let order = derive_bus_trace_order(&core.topology, &core.problem);
        let center = order.center_trace_index;
        let route = order.center_trace_route_id;
        let net = core.problem.route_net[route as usize];
        let mut others: Vec<_> = (0..order.traces.len()).filter(|i| *i != center).collect();
        others.sort_by(|l, r| {
            order.traces[*l]
                .distance_from_center
                .cmp(&order.traces[*r].distance_from_center)
                .then_with(|| {
                    order.traces[*l]
                        .signed_index_from_center
                        .cmp(&order.traces[*r].signed_index_from_center)
                })
        });
        let mut commit = vec![center];
        commit.extend(others.clone());
        let pitch = compute_median_trace_pitch(&order);
        let mut serialized = HashMap::new();

        for region in 0..core.topology.region_count {
            if let Some(id) = core
                .topology
                .region_metadata
                .as_ref()
                .and_then(|m| m.get(region))
                .and_then(|m| m.get("serializedRegionId"))
                .and_then(Value::as_str)
            {
                serialized.insert(id.to_owned(), region as RegionId);
            }
        }

        let goal = core.problem.route_end_port[route as usize];
        let preferred = core
            .problem
            .route_metadata
            .as_ref()
            .and_then(|m| m.get(route as usize))
            .and_then(|m| m.get("endRegionId"))
            .and_then(Value::as_str)
            .and_then(|id| serialized.get(id))
            .copied();
        let incident = &core.topology.incident_port_region[goal as usize];
        let goal_region = incident
            .iter()
            .find(|r| Some(**r) != preferred)
            .or(incident.first())
            .copied()
            .unwrap_or(-1);
        let center_options = options.center_port_options_per_edge.unwrap_or(6);
        let usable: Vec<bool> = (0..core.topology.port_count)
            .map(|p| {
                core.problem.port_section_mask[p] == 1
                    && core.topology.port_z[p] == 0
                    && !core
                        .problem_setup
                        .as_ref()
                        .expect("Problem setup")
                        .port_endpoint_net_ids[p]
                        .iter()
                        .any(|n| *n != net)
            })
            .collect();
        let boundary = BusBoundaryPlanner::new(BusBoundaryPlannerOptions {
            topology: core.topology.clone(),
            problem: core.problem.clone(),
            bus_trace_order: order.clone(),
            center_trace_index: center,
            center_port_options_per_edge: center_options,
            is_usable_centerline_boundary_port: Box::new(move |p| usable[p as usize]),
        });
        let neighbors = boundary.centerline_neighbor_region_ids_by_region.clone();
        let distances = compute_region_distance_to_goal(&core.topology, goal_region, &neighbors);
        let hops =
            compute_center_goal_hop_distance(core.topology.region_count, goal_region, &neighbors);
        let mut result = Self {
            preview_touched_region_mask: vec![0; core.topology.region_count],
            preview_touched_port_mask: vec![0; core.topology.port_count],
            core,
            bus_end_margin_steps: options.bus_end_margin_steps.unwrap_or(3),
            bus_max_remainder_steps: options.bus_max_remainder_steps.unwrap_or(8),
            bus_remainder_guide_weight: options.bus_remainder_guide_weight.unwrap_or(1.0),
            bus_remainder_goal_weight: options.bus_remainder_goal_weight.unwrap_or(0.35),
            bus_remainder_side_weight: options.bus_remainder_side_weight.unwrap_or(0.2),
            complete_trace_option_branch_limit: 4,
            bus_min_trace_progress_ratio: 0.7,
            bus_min_trace_progress_threshold: 2,
            center_greedy_heuristic_multiplier: options
                .center_greedy_heuristic_multiplier
                .unwrap_or(10.0),
            center_port_options_per_edge: center_options,
            bus_trace_length_margin: 1.0,
            bus_max_trace_steps: 256,
            manual_center_finish_max_hops: 2,
            manual_center_finish_port_options_per_boundary: 6,
            manual_center_finish_candidate_limit: 24,
            trace_alongside_search_branch_limit: 6,
            trace_alongside_search_beam_width: 32,
            trace_alongside_search_option_limit: 8,
            trace_alongside_lane_weight: 1.0,
            trace_alongside_regression_weight: 2.0,
            bus_trace_order: order,
            center_trace_index: center,
            center_route_id: route,
            center_route_net_id: net,
            center_goal_transit_region_id: goal_region,
            center_goal_hop_distance_by_region: hops,
            other_trace_indices: others,
            commit_trace_indices: commit,
            trace_pitch: pitch,
            region_distance_to_goal_by_region: distances,
            queue_all_candidates: options.queue_all_candidates.unwrap_or(false),
            show_unassigned_ports_in_visualization: options
                .visualize_unassigned_ports
                .unwrap_or(false),
            boundary_planner: boundary,
            centerline_neighbor_region_ids_by_region: neighbors,
            region_index_by_serialized_id: serialized,
            candidate_best_cost_by_state_key: HashMap::new(),
            queued_candidate_best_cost_by_state_key: HashMap::new(),
            preview_touched_region_ids: vec![],
            preview_touched_port_ids: vec![],
            preview_same_layer_intersection_count: 0,
            preview_crossing_layer_intersection_count: 0,
            preview_total_region_cost: 0.0,
            last_expanded_candidate: None,
            last_preview: None,
            last_neighbor_count: 0,
            last_queued_neighbor_count: 0,
        };
        result.update_bus_stats(None);
        result
    }

    pub fn _setup(&mut self) -> () {
        self.core.get_problem_setup();
        self.core.is_setup = true;
        self.core.state.current_route_id = Some(self.center_route_id);
        self.core.state.current_route_net_id = Some(self.center_route_net_id);
        self.core.state.goal_port_id =
            self.core.problem.route_end_port[self.center_route_id as usize];
        self.core.state.unrouted_routes = self
            .other_trace_indices
            .iter()
            .map(|i| self.bus_trace_order.traces[*i].route_id)
            .collect();
        self.last_expanded_candidate = None;
        self.last_preview = None;
        self.last_neighbor_count = 0;
        self.last_queued_neighbor_count = 0;
        self.candidate_best_cost_by_state_key.clear();
        self.queued_candidate_best_cost_by_state_key.clear();
        self.clear_preview_working_state();
        self.core.reset_candidate_best_costs();
        self.core.state.candidate_queue =
            Box::new(MinHeap::new(vec![], compare_bus_candidates_by_f));
        let start = self.core.problem.route_start_port[self.center_route_id as usize];
        let Some(next) = self.get_starting_next_region_id(self.center_route_id, start) else {
            self.core.failed = true;
            self.core.error = Some(format!(
                "Centerline start port {start} has no incident regions"
            ));
            self.update_bus_stats(None);
            return;
        };
        let h = self.scale_center_heuristic(self.compute_center_heuristic(start, Some(next)));
        let candidate = BusCenterCandidate {
            port_id: start,
            next_region_id: next,
            g: 0.0,
            h,
            f: h,
            ..Default::default()
        };
        if self.should_use_bus_state_pruning() {
            let preview = BusPreview {
                trace_previews: vec![],
                total_length: 0.0,
                total_cost: 0.0,
                complete_trace_count: 0,
                same_layer_intersection_count: 0,
                crossing_layer_intersection_count: 0,
                reason: None,
            };
            self.queued_candidate_best_cost_by_state_key
                .insert(self.get_bus_candidate_state_key(&candidate, &preview), 0.0);
        } else {
            let hop = self.core.get_hop_id(start, next);
            self.core.set_candidate_best_cost(hop, 0.0);
        }

        self.core.state.candidate_queue.queue(candidate);
        self.update_bus_stats(None);
    }

    pub fn _step(&mut self) -> () {
        if self.core.failed || self.core.solved {
            return;
        }

        let Some(mut current) = self.core.state.candidate_queue.dequeue() else {
            self.core.failed = true;
            self.core.error = Some(
                "Centerline candidates are exhausted without a non-intersecting bus solution"
                    .into(),
            );
            self.update_bus_stats(None);
            return;
        };
        if !self.should_use_bus_state_pruning() {
            let hop = self
                .core
                .get_hop_id(current.port_id, current.next_region_id);
            if current.g > self.core.get_candidate_best_cost(hop) {
                self.update_bus_stats(None);
                return;
            }
        }

        self.last_expanded_candidate = Some(current.clone());
        self.last_neighbor_count = 0;
        self.last_queued_neighbor_count = 0;
        let preview = self.evaluate_candidate(&current);
        self.last_preview = preview.clone();
        let Some(preview) = preview else {
            self.update_bus_stats(Some("preview_failed"));
            return;
        };
        Rc::make_mut(current.bus.get_or_insert_with(Default::default)).bus_cost = Some(preview.total_cost);
        self.last_expanded_candidate = Some(current.clone());
        if self.should_use_bus_state_pruning() {
            let key = self.get_bus_candidate_state_key(&current, &preview);
            if self
                .candidate_best_cost_by_state_key
                .get(&key)
                .is_some_and(|old| preview.total_cost >= *old - BUS_CANDIDATE_EPSILON)
            {
                self.update_bus_stats(None);
                return;
            }

            self.candidate_best_cost_by_state_key
                .insert(key, preview.total_cost);
        }

        let intersections = preview.same_layer_intersection_count > 0
            || preview.crossing_layer_intersection_count > 0;
        let inference_failure = preview.reason.is_some() && !intersections;
        if current.at_goal
            && !intersections
            && preview.complete_trace_count == self.core.problem.route_count
        {
            self.core.solved = true;
            self.core.state.unrouted_routes.clear();
            self.update_bus_stats(None);
            return;
        }

        if !intersections && !inference_failure && !current.at_goal {
            let snapshot = snapshot_preview_routing_state(&self.core.state);
            let metrics = self.snapshot_preview_metrics();
            let next_candidates = self.get_available_center_moves(&current);
            self.last_neighbor_count = next_candidates.len();
            self.last_queued_neighbor_count = 0;

            for mut next in next_candidates {
                if !self.should_use_queued_candidate_preview_filtering(&current) {
                    let hop = self.core.get_hop_id(next.port_id, next.next_region_id);
                    if next.g >= self.core.get_candidate_best_cost(hop) {
                        continue;
                    }

                    self.core.set_candidate_best_cost(hop, next.g);
                    self.core.state.candidate_queue.queue(next);
                    self.last_queued_neighbor_count += 1;
                    continue;
                }

                let Some(next_preview) = self.evaluate_candidate(&next) else {
                    continue;
                };
                if (self.core.problem.route_count > 6
                    && current.prev_candidate.is_none()
                    && !self.has_remaining_trace_candidates(&next_preview))
                    || !self.is_queueable_preview(&next_preview)
                {
                    continue;
                }

                let bus_cost = if next_preview.total_cost.is_finite() {
                    next_preview.total_cost
                } else {
                    next.f
                };
                Rc::make_mut(next.bus.get_or_insert_with(Default::default)).bus_cost = Some(bus_cost);
                if self.should_use_bus_state_pruning() {
                    let key = self.get_bus_candidate_state_key(&next, &next_preview);
                    if bus_cost
                        >= self
                            .queued_candidate_best_cost_by_state_key
                            .get(&key)
                            .copied()
                            .unwrap_or(f64::INFINITY)
                    {
                        continue;
                    }

                    self.queued_candidate_best_cost_by_state_key
                        .insert(key, bus_cost);
                } else {
                    let hop = self.core.get_hop_id(next.port_id, next.next_region_id);
                    if next.g >= self.core.get_candidate_best_cost(hop) {
                        continue;
                    }

                    self.core.set_candidate_best_cost(hop, next.g);
                }

                self.core.state.candidate_queue.queue(next);
                self.last_queued_neighbor_count += 1;
            }

            restore_preview_routing_state(&mut self.core.state, &snapshot);
            self.restore_preview_metrics(metrics);
        } else {
            self.last_neighbor_count = 0;
            self.last_queued_neighbor_count = 0;
        }

        if self.core.state.candidate_queue.len() == 0 {
            self.core.failed = true;
            self.core.error = Some(preview.reason.unwrap_or_else(|| {
                if current.at_goal {
                    "Centerline reached its destination but the bus remainder could not be inferred"
                        .into()
                } else {
                    "Centerline candidates are exhausted without a non-intersecting bus solution"
                        .into()
                }
            }));
            self.update_bus_stats(None);
            return;
        }

        self.update_bus_stats(None);
    }

    pub fn step(&mut self) -> () {
        if !self.core.is_setup {
            self._setup();
        }
        if self.core.solved || self.core.failed {
            return;
        }
        self.core.iterations += 1;
        self._step();
        if !self.core.solved && self.core.iterations as f64 >= self.core.options.max_iterations {
            self.core.try_final_acceptance();
        }
        if !self.core.solved && self.core.iterations as f64 >= self.core.options.max_iterations {
            self.core.error = Some("TinyHyperGraphBusSolver ran out of iterations".into());
            self.core.failed = true;
        }
    }

    pub fn solve(&mut self) -> () {
        while !self.core.solved && !self.core.failed {
            self.step();
        }
    }

    pub fn visualize(&self) -> GraphicsObject {
        let additional_region_labels: HashMap<RegionId, String> =
            (0..self.core.topology.region_count)
                .filter_map(|region| {
                    self.get_additional_region_label(region as RegionId)
                        .map(|label| (region as RegionId, label))
                })
                .collect();
        crate::visualize_tiny_graph::visualize_tiny_graph(
            &self.core,
            crate::visualize_tiny_graph::TinyHyperGraphVisualizationOptions {
                center_route_id: Some(self.center_route_id),
                show_unassigned_ports_in_visualization: self.show_unassigned_ports_in_visualization,
                additional_region_labels: Some(additional_region_labels),
                ..Default::default()
            },
        )
    }

    fn resolve_center_goal_transit_region_id(&self) -> RegionId {
        let goal = self.core.problem.route_end_port[self.center_route_id as usize];
        let ids = &self.core.topology.incident_port_region[goal as usize];
        let preferred =
            self.get_serialized_region_id_from_route_metadata(self.center_route_id, "end");
        ids.iter()
            .find(|r| Some(**r) != preferred)
            .or(ids.first())
            .copied()
            .unwrap_or(-1)
    }

    fn get_serialized_region_id_from_route_metadata(
        &self,
        route: RouteId,
        side: &str,
    ) -> Option<RegionId> {
        let key = if side == "start" {
            "startRegionId"
        } else {
            "endRegionId"
        };
        let id = self
            .core
            .problem
            .route_metadata
            .as_ref()?
            .get(route as usize)?
            .get(key)?
            .as_str()?;
        self.region_index_by_serialized_id.get(id).copied()
    }

    fn evaluate_candidate(&mut self, candidate: &BusCenterCandidate) -> Option<BusPreview> {
        self.clear_preview_working_state();
        self.core.state.current_route_id = Some(self.center_route_id);
        self.core.state.current_route_net_id = Some(self.center_route_net_id);
        self.core.state.goal_port_id =
            self.core.problem.route_end_port[self.center_route_id as usize];
        let path = get_center_candidate_path(candidate);
        let steps = self.boundary_planner.get_boundary_steps(&path);
        let assignments = self.boundary_planner.assign_boundary_ports_for_path(&steps);
        Some(self.build_derived_bus_preview(&path, &steps, &assignments, candidate.at_goal))
    }

    fn build_centerline_trace_preview(
        &self,
        path: &[BusCenterCandidate],
        owners: &HashMap<PortId, RouteId>,
        complete: bool,
    ) -> Option<TracePreview> {
        let route = self.center_route_id;
        let start = self.core.problem.route_start_port[route as usize];
        let mut local = owners.clone();
        if !ensure_port_ownership(route, start, &mut local) {
            return None;
        }

        let mut segments = vec![];
        let mut port = start;
        let mut region = path.first()?.next_region_id;

        for next in path.iter().skip(1) {
            if !ensure_port_ownership(route, next.port_id, &mut local) {
                return None;
            }

            if port != next.port_id {
                segments.push(TraceSegment {
                    region_id: region,
                    from_port_id: port,
                    to_port_id: next.port_id,
                });
            }

            port = next.port_id;
            if !next.at_goal {
                region = next.next_region_id;
            }
        }

        Some(TracePreview {
            trace_index: self.center_trace_index,
            route_id: route,
            segments,
            complete,
            terminal_port_id: port,
            terminal_region_id: if complete { None } else { Some(region) },
            preview_cost: Some(0.0),
        })
    }

    pub(super) fn build_prefix_trace_preview(
        &self,
        trace: usize,
        shared: usize,
        steps: &[BoundaryStep],
        assignments: &[Option<Vec<PortId>>],
        owners: &HashMap<PortId, RouteId>,
    ) -> Option<TracePreview> {
        let route = self.bus_trace_order.traces[trace].route_id;
        let start = self.core.problem.route_start_port[route as usize];
        let mut region = self.get_starting_next_region_id(route, start)?;
        if self.core.topology.port_z[start as usize] != 0
            || (shared > 0 && region != steps[0].from_region_id)
        {
            return None;
        }

        let mut local = owners.clone();
        if !ensure_port_ownership(route, start, &mut local) {
            return None;
        }

        let mut segments = vec![];
        let mut port = start;

        for i in 0..shared {
            let step = &steps[i];
            let boundary = *assignments.get(i)?.as_ref()?.get(trace)?;
            if region != step.from_region_id || !ensure_port_ownership(route, boundary, &mut local)
            {
                return None;
            }

            if port != boundary {
                segments.push(TraceSegment {
                    region_id: region,
                    from_port_id: port,
                    to_port_id: boundary,
                });
            }

            port = boundary;
            region = step.to_region_id;
        }

        Some(TracePreview {
            trace_index: trace,
            route_id: route,
            segments,
            complete: false,
            terminal_port_id: port,
            terminal_region_id: Some(region),
            preview_cost: Some(0.0),
        })
    }

    fn build_best_prefix_trace_preview(
        &self,
        trace: usize,
        path: &[BusCenterCandidate],
        shared: usize,
        steps: &[BoundaryStep],
        assignments: &[Option<Vec<PortId>>],
        owners: &HashMap<PortId, RouteId>,
    ) -> Option<TracePreview> {
        BusTraceInferencePlanner::new(self).build_best_prefix_trace_preview(
            trace,
            path,
            shared,
            steps,
            assignments,
            owners,
        )
    }

    fn build_complete_trace_preview(
        &self,
        trace: usize,
        path: &[BusCenterCandidate],
        steps: &[BoundaryStep],
        assignments: &[Option<Vec<PortId>>],
        owners: &HashMap<PortId, RouteId>,
    ) -> Option<TracePreview> {
        BusTraceInferencePlanner::new(self).build_complete_trace_preview(
            trace,
            path,
            steps,
            assignments,
            owners,
        )
    }

    fn build_complete_trace_preview_options(
        &self,
        trace: usize,
        path: &[BusCenterCandidate],
        steps: &[BoundaryStep],
        assignments: &[Option<Vec<PortId>>],
        owners: &HashMap<PortId, RouteId>,
    ) -> Vec<TracePreview> {
        if trace == self.center_trace_index {
            return self
                .build_centerline_complete_trace_preview(path, steps, owners)
                .into_iter()
                .collect();
        }

        let route = self.bus_trace_order.traces[trace].route_id;
        let start = self.core.problem.route_start_port[route as usize];
        let goal = self.core.problem.route_end_port[route as usize];
        let mut previews = vec![];

        for shared in (0..=steps.len()).rev() {
            let Some(prefix) =
                self.build_prefix_trace_preview(trace, shared, steps, assignments, owners)
            else {
                continue;
            };
            let region = if shared == 0 {
                self.get_starting_next_region_id(route, start)
            } else {
                Some(steps[shared - 1].to_region_id)
            };
            let port = if shared == 0 {
                Some(start)
            } else {
                assignments[shared - 1]
                    .as_ref()
                    .and_then(|ports| ports.get(trace))
                    .copied()
            };
            let (Some(region), Some(port)) = (region, port) else {
                continue;
            };

            for remainder in
                self.infer_end_remainder_segments(trace, port, region, path, shared, owners)
            {
                let mut segments = prefix.segments.clone();
                segments.extend(remainder.segments);
                previews.push(TracePreview {
                    trace_index: trace,
                    route_id: route,
                    segments,
                    complete: true,
                    terminal_port_id: goal,
                    terminal_region_id: None,
                    preview_cost: Some(remainder.preview_cost),
                });
            }
        }

        previews
    }

    fn build_best_complete_bus_preview(
        &mut self,
        path: &[BusCenterCandidate],
        steps: &[BoundaryStep],
        assignments: &[Option<Vec<PortId>>],
    ) -> Option<BusPreview> {
        fn search(
            solver: &mut TinyHyperGraphBusSolver,
            path: &[BusCenterCandidate],
            steps: &[BoundaryStep],
            assignments: &[Option<Vec<PortId>>],
            order: usize,
            owners: &mut HashMap<PortId, RouteId>,
            stack: &mut Vec<TracePreview>,
            best: &mut Option<Vec<TracePreview>>,
            best_intersections: &mut f64,
            best_length: &mut f64,
        ) -> () {
            let counts = solver.get_preview_intersection_counts();
            let count = (counts.same_layer_intersection_count
                + counts.crossing_layer_intersection_count) as f64;
            let length = stack
                .iter()
                .map(|p| solver.get_trace_preview_length(p))
                .sum::<f64>();
            if count > *best_intersections
                || (count == *best_intersections && length >= *best_length - BUS_CANDIDATE_EPSILON)
            {
                return;
            }

            if order >= solver.commit_trace_indices.len() {
                if best.is_none()
                    || count < *best_intersections
                    || (count == *best_intersections
                        && length < *best_length - BUS_CANDIDATE_EPSILON)
                {
                    *best_intersections = count;
                    *best_length = length;
                    *best = Some(stack.clone());
                }

                return;
            }

            let trace = solver.commit_trace_indices[order];
            let options = solver.build_complete_trace_preview_options(
                trace,
                path,
                steps,
                assignments,
                owners,
            );
            let mut ranked = vec![];

            for preview in options {
                let snapshot = snapshot_preview_routing_state(&solver.core.state);
                let metrics = solver.snapshot_preview_metrics();
                let old_owners = owners.clone();
                let length = solver.commit_trace_preview(&preview, owners);
                let counts = solver.get_preview_intersection_counts();
                let count =
                    counts.same_layer_intersection_count + counts.crossing_layer_intersection_count;
                restore_preview_routing_state(&mut solver.core.state, &snapshot);
                solver.restore_preview_metrics(metrics);
                *owners = old_owners;
                if length.is_finite() {
                    ranked.push((preview, length, count));
                }
            }

            ranked.sort_by(|l, r| l.2.cmp(&r.2).then_with(|| l.1.total_cmp(&r.1)));
            ranked.truncate(solver.complete_trace_option_branch_limit);

            for (preview, _, _) in ranked {
                let snapshot = snapshot_preview_routing_state(&solver.core.state);
                let metrics = solver.snapshot_preview_metrics();
                let old_owners = owners.clone();
                let length = solver.commit_trace_preview(&preview, owners);
                if length.is_finite() {
                    stack.push(preview);
                    search(
                        solver,
                        path,
                        steps,
                        assignments,
                        order + 1,
                        owners,
                        stack,
                        best,
                        best_intersections,
                        best_length,
                    );
                    stack.pop();
                }

                restore_preview_routing_state(&mut solver.core.state, &snapshot);
                solver.restore_preview_metrics(metrics);
                *owners = old_owners;
                if *best_intersections == 0.0 {
                    return;
                }
            }
        }

        self.clear_preview_working_state();
        let mut best = None;
        let mut stack = vec![];
        let mut best_intersections = f64::INFINITY;
        let mut best_length = f64::INFINITY;
        search(
            self,
            path,
            steps,
            assignments,
            0,
            &mut HashMap::new(),
            &mut stack,
            &mut best,
            &mut best_intersections,
            &mut best_length,
        );
        let best = best?;
        self.clear_preview_working_state();
        let mut owners = HashMap::new();
        let mut length = 0.0;
        let mut cost = 0.0;

        for preview in &best {
            length += self.commit_trace_preview(preview, &mut owners);
            cost += preview.preview_cost.unwrap_or(0.0);
        }

        let counts = self.get_preview_intersection_counts();
        Some(BusPreview {
            complete_trace_count: best.iter().filter(|p| p.complete).count(),
            trace_previews: best,
            total_length: length,
            total_cost: length * self.core.options.distance_to_cost
                + self.preview_total_region_cost
                + cost,
            same_layer_intersection_count: counts.same_layer_intersection_count,
            crossing_layer_intersection_count: counts.crossing_layer_intersection_count,
            reason: None,
        })
    }

    fn infer_end_remainder_segments(
        &self,
        trace: usize,
        start: PortId,
        start_region: RegionId,
        path: &[BusCenterCandidate],
        shared: usize,
        owners: &HashMap<PortId, RouteId>,
    ) -> Vec<RemainderOption> {
        let route = self.bus_trace_order.traces[trace].route_id;
        let end = self.core.problem.route_end_port[route as usize];
        if self.core.topology.port_z[end as usize] != 0 {
            return vec![];
        }

        if is_port_incident_to_region(&self.core.topology, end, start_region) {
            if ensure_port_ownership(route, end, &mut owners.clone()) && start != end {
                return vec![RemainderOption {
                    segments: vec![TraceSegment {
                        region_id: start_region,
                        from_port_id: start,
                        to_port_id: end,
                    }],
                    preview_cost: 0.0,
                }];
            }

            return vec![RemainderOption {
                segments: vec![],
                preview_cost: 0.0,
            }];
        }

        let guide = get_guide_port_ids(path, shared);
        let goal_regions = self
            .core
            .topology
            .incident_port_region
            .get(end as usize)
            .cloned()
            .unwrap_or_default();
        let net = self.core.problem.route_net[route as usize];
        let mut local = owners.clone();
        if !ensure_port_ownership(route, start, &mut local) {
            return vec![];
        }

        let mut visited = HashSet::from([(start, start_region)]);
        let mut segments = vec![];
        let mut port = start;
        let mut region = start_region;
        let mut cost = 0.0;

        for _ in 0..self.bus_max_remainder_steps {
            if is_port_incident_to_region(&self.core.topology, end, region) {
                if !ensure_port_ownership(route, end, &mut local) {
                    return vec![];
                }

                if port != end {
                    let segment = TraceSegment {
                        region_id: region,
                        from_port_id: port,
                        to_port_id: end,
                    };
                    if !self.is_trace_segment_usable(route, &segment, &local) {
                        return vec![];
                    }

                    segments.push(segment);
                    cost += get_distance_from_port_to_polyline(&self.core.topology, end, &guide);
                }

                return vec![RemainderOption {
                    segments,
                    preview_cost: cost,
                }];
            }

            let mut best: Option<(PortId, RegionId, f64)> = None;

            for &boundary in self
                .core
                .topology
                .region_incident_ports
                .get(region as usize)
                .into_iter()
                .flatten()
            {
                if boundary == port || self.core.topology.port_z[boundary as usize] != 0 {
                    continue;
                }

                let ids = &self.core.topology.incident_port_region[boundary as usize];
                let next = if ids.first() == Some(&region) {
                    ids.get(1)
                } else {
                    ids.first()
                };
                let Some(&next) = next else {
                    continue;
                };
                if self.is_region_reserved_for_different_bus_net(net, next)
                    || visited.contains(&(boundary, next))
                {
                    continue;
                }

                if local.get(&boundary).is_some_and(|owner| *owner != route) {
                    continue;
                }

                let segment = TraceSegment {
                    region_id: region,
                    from_port_id: port,
                    to_port_id: boundary,
                };
                if !self.is_trace_segment_usable(route, &segment, &local) {
                    continue;
                }

                let goal_distance = get_port_distance(&self.core.topology, boundary, end);
                let guide_distance =
                    get_distance_from_port_to_polyline(&self.core.topology, boundary, &guide);
                let side = self.get_trace_side_penalty(trace, boundary);
                let bonus = if goal_regions.contains(&next) {
                    -5.0
                } else {
                    0.0
                };
                let score = guide_distance * self.bus_remainder_guide_weight
                    + goal_distance * self.bus_remainder_goal_weight
                    + side * self.bus_remainder_side_weight
                    + bonus;
                if best.is_none_or(|b| {
                    score < b.2 - BUS_CANDIDATE_EPSILON
                        || ((score - b.2).abs() <= BUS_CANDIDATE_EPSILON && boundary < b.0)
                }) {
                    best = Some((boundary, next, score));
                }
            }

            let Some((boundary, next, score)) = best else {
                return vec![];
            };
            if !ensure_port_ownership(route, boundary, &mut local) {
                return vec![];
            }

            segments.push(TraceSegment {
                region_id: region,
                from_port_id: port,
                to_port_id: boundary,
            });
            port = boundary;
            region = next;
            cost += score;
            visited.insert((port, region));
        }

        vec![]
    }

    fn build_derived_bus_preview(
        &mut self,
        path: &[BusCenterCandidate],
        steps: &[BoundaryStep],
        assignments: &[Option<Vec<PortId>>],
        complete: bool,
    ) -> BusPreview {
        if complete && self.core.problem.route_count > 6 {
            if let Some(best) = self.build_best_complete_bus_preview(path, steps, assignments) {
                return best;
            }

            self.clear_preview_working_state();
        }

        let mut previews = vec![];
        let mut owners = HashMap::new();
        let mut length = 0.0;
        let mut cost = 0.0;

        for trace in self.commit_trace_indices.clone() {
            let preview = if trace == self.center_trace_index {
                if complete {
                    self.build_centerline_complete_trace_preview(path, steps, &owners)
                } else {
                    self.build_centerline_trace_preview(path, &owners, false)
                }
            } else if complete {
                self.build_complete_trace_preview(trace, path, steps, assignments, &owners)
            } else {
                self.build_best_prefix_trace_preview(
                    trace,
                    path,
                    steps.len(),
                    steps,
                    assignments,
                    &owners,
                )
            };
            let Some(preview) = preview else {
                let counts = self.get_preview_intersection_counts();
                let reason = if trace == self.center_trace_index {
                    format!(
                        "Failed to infer centerline preview for {}",
                        self.get_trace_connection_id(trace)
                    )
                } else {
                    format!(
                        "Failed to infer {} for {}",
                        if complete { "remainder" } else { "prefix" },
                        self.get_trace_connection_id(trace)
                    )
                };
                return BusPreview {
                    complete_trace_count: previews
                        .iter()
                        .filter(|p: &&TracePreview| p.complete)
                        .count(),
                    trace_previews: previews,
                    total_length: length,
                    total_cost: f64::INFINITY,
                    same_layer_intersection_count: counts.same_layer_intersection_count,
                    crossing_layer_intersection_count: counts.crossing_layer_intersection_count,
                    reason: Some(reason),
                };
            };
            let before = self.get_preview_intersection_counts();
            previews.push(preview.clone());
            let trace_length = self.commit_trace_preview(&preview, &mut owners);
            let counts = self.get_preview_intersection_counts();
            if !trace_length.is_finite() {
                return BusPreview {
                    complete_trace_count: previews.iter().filter(|p| p.complete).count(),
                    trace_previews: previews,
                    total_length: length,
                    total_cost: f64::INFINITY,
                    same_layer_intersection_count: counts.same_layer_intersection_count,
                    crossing_layer_intersection_count: counts.crossing_layer_intersection_count,
                    reason: Some(format!(
                        "Conflicting inferred port ownership for {}",
                        self.get_trace_connection_id(trace)
                    )),
                };
            }

            if counts.same_layer_intersection_count > before.same_layer_intersection_count
                || counts.crossing_layer_intersection_count
                    > before.crossing_layer_intersection_count
            {
                return BusPreview {
                    complete_trace_count: previews.iter().filter(|p| p.complete).count(),
                    trace_previews: previews,
                    total_length: length,
                    total_cost: f64::INFINITY,
                    same_layer_intersection_count: counts.same_layer_intersection_count,
                    crossing_layer_intersection_count: counts.crossing_layer_intersection_count,
                    reason: Some(format!(
                        "Intersecting inferred path for {}",
                        self.get_trace_connection_id(trace)
                    )),
                };
            }

            length += trace_length;
            cost += preview.preview_cost.unwrap_or(0.0);
        }

        let counts = self.get_preview_intersection_counts();
        let region_cost = self.preview_total_region_cost;
        if !complete && self.core.problem.route_count <= 6 {
            for preview in &previews {
                if preview.trace_index == self.center_trace_index {
                    continue;
                }

                if !BusTraceInferencePlanner::new(self)
                    .has_remaining_trace_candidate(preview, &owners)
                {
                    let reason = format!(
                        "No remaining candidates for {}",
                        self.get_trace_connection_id(preview.trace_index)
                    );
                    return BusPreview {
                        complete_trace_count: previews.iter().filter(|p| p.complete).count(),
                        trace_previews: previews,
                        total_length: length,
                        total_cost: f64::INFINITY,
                        same_layer_intersection_count: counts.same_layer_intersection_count,
                        crossing_layer_intersection_count: counts.crossing_layer_intersection_count,
                        reason: Some(reason),
                    };
                }
            }
        }

        BusPreview {
            complete_trace_count: previews.iter().filter(|p| p.complete).count(),
            trace_previews: previews,
            total_length: length,
            total_cost: length * self.core.options.distance_to_cost + region_cost + cost,
            same_layer_intersection_count: counts.same_layer_intersection_count,
            crossing_layer_intersection_count: counts.crossing_layer_intersection_count,
            reason: None,
        }
    }

    fn get_bus_candidate_state_key(
        &self,
        candidate: &BusCenterCandidate,
        preview: &BusPreview,
    ) -> String {
        let mut parts = vec![format!(
            "{}:{}:{}:{}",
            candidate.port_id,
            candidate.next_region_id,
            candidate.prev_region_id.unwrap_or(-1),
            usize::from(candidate.at_goal)
        )];
        parts.extend(preview.trace_previews.iter().map(|p| {
            format!(
                "{}:{}:{}",
                p.trace_index,
                p.terminal_region_id.unwrap_or(-1),
                usize::from(p.complete)
            )
        }));
        parts.join("|")
    }

    fn should_use_bus_state_pruning(&self) -> bool {
        self.core.problem.route_count <= 6
    }

    fn should_use_queued_candidate_preview_filtering(
        &self,
        candidate: &BusCenterCandidate,
    ) -> bool {
        if self.queue_all_candidates {
            return false;
        }

        self.core.problem.route_count <= 6 || candidate.prev_candidate.is_none()
    }

    fn is_queueable_preview(&self, preview: &BusPreview) -> bool {
        if preview.reason.is_some()
            || preview.same_layer_intersection_count > 0
            || preview.crossing_layer_intersection_count > 0
        {
            return false;
        }

        let Some(center) = preview
            .trace_previews
            .iter()
            .find(|p| p.trace_index == self.center_trace_index)
        else {
            return false;
        };
        if preview.complete_trace_count == self.core.problem.route_count {
            return true;
        }

        let count = center.segments.len();
        let length = self.get_trace_preview_length(center);
        if count < self.bus_min_trace_progress_threshold {
            return preview.trace_previews.iter().all(|p| {
                p.trace_index == self.center_trace_index
                    || (p.segments.len() <= count
                        && self.get_trace_preview_length(p) <= length + BUS_CANDIDATE_EPSILON)
            });
        }

        let minimum = 1.max((count as f64 * self.bus_min_trace_progress_ratio).floor() as usize);

        for p in &preview.trace_previews {
            if p.trace_index == self.center_trace_index {
                continue;
            }

            if p.segments.len() > count
                || self.get_trace_preview_length(p) > length + BUS_CANDIDATE_EPSILON
                || p.segments.len() < minimum
            {
                return false;
            }
        }

        true
    }

    fn build_preview_used_port_owners(
        &self,
        previews: &[TracePreview],
    ) -> Option<HashMap<PortId, RouteId>> {
        let mut owners = HashMap::new();

        for preview in previews {
            for s in &preview.segments {
                if !ensure_port_ownership(preview.route_id, s.from_port_id, &mut owners)
                    || !ensure_port_ownership(preview.route_id, s.to_port_id, &mut owners)
                {
                    return None;
                }
            }
        }

        Some(owners)
    }

    fn has_remaining_trace_candidates(&self, preview: &BusPreview) -> bool {
        let Some(owners) = self.build_preview_used_port_owners(&preview.trace_previews) else {
            return false;
        };
        preview.trace_previews.iter().all(|p| {
            p.trace_index == self.center_trace_index
                || BusTraceInferencePlanner::new(self).has_remaining_trace_candidate(p, &owners)
        })
    }

    fn get_trace_preview_length(&self, preview: &TracePreview) -> f64 {
        preview
            .segments
            .iter()
            .map(|s| get_port_distance(&self.core.topology, s.from_port_id, s.to_port_id))
            .sum()
    }

    fn snapshot_preview_metrics(&self) -> PreviewMetricsSnapshot {
        PreviewMetricsSnapshot {
            touched_region_ids: self.preview_touched_region_ids.clone(),
            touched_port_ids: self.preview_touched_port_ids.clone(),
            same_layer_intersection_count: self.preview_same_layer_intersection_count,
            crossing_layer_intersection_count: self.preview_crossing_layer_intersection_count,
            total_region_cost: self.preview_total_region_cost,
        }
    }

    fn restore_preview_metrics(&mut self, snapshot: PreviewMetricsSnapshot) -> () {
        for &r in &self.preview_touched_region_ids {
            self.preview_touched_region_mask[r as usize] = 0;
        }

        for &p in &self.preview_touched_port_ids {
            self.preview_touched_port_mask[p as usize] = 0;
        }

        self.preview_touched_region_ids = snapshot.touched_region_ids;
        self.preview_touched_port_ids = snapshot.touched_port_ids;
        self.preview_same_layer_intersection_count = snapshot.same_layer_intersection_count;
        self.preview_crossing_layer_intersection_count = snapshot.crossing_layer_intersection_count;
        self.preview_total_region_cost = snapshot.total_region_cost;

        for &r in &self.preview_touched_region_ids {
            self.preview_touched_region_mask[r as usize] = 1;
        }

        for &p in &self.preview_touched_port_ids {
            self.preview_touched_port_mask[p as usize] = 1;
        }
    }

    fn clear_preview_working_state(&mut self) -> () {
        for &p in &self.preview_touched_port_ids {
            self.core.state.port_assignment[p as usize] = -1;
            self.preview_touched_port_mask[p as usize] = 0;
        }

        for &r in &self.preview_touched_region_ids {
            self.core.state.region_segments[r as usize].clear();
            let cache = &mut self.core.state.region_intersection_caches[r as usize];
            cache.net_ids.clear();
            cache.lesser_angles.clear();
            cache.greater_angles.clear();
            cache.layer_masks.clear();
            cache.existing_crossing_layer_intersections = 0;
            cache.existing_same_layer_intersections = 0;
            cache.existing_entry_exit_layer_changes = 0;
            cache.existing_region_cost = 0.0;
            cache.existing_segment_count = 0;
            self.preview_touched_region_mask[r as usize] = 0;
        }

        self.preview_touched_port_ids.clear();
        self.preview_touched_region_ids.clear();
        self.preview_same_layer_intersection_count = 0;
        self.preview_crossing_layer_intersection_count = 0;
        self.preview_total_region_cost = 0.0;
    }

    fn record_preview_port_touch(&mut self, port: PortId) -> () {
        if self.preview_touched_port_mask[port as usize] != 0 {
            return;
        }

        self.preview_touched_port_mask[port as usize] = 1;
        self.preview_touched_port_ids.push(port);
    }

    fn record_preview_region_touch(&mut self, region: RegionId) -> () {
        if self.preview_touched_region_mask[region as usize] != 0 {
            return;
        }

        self.preview_touched_region_mask[region as usize] = 1;
        self.preview_touched_region_ids.push(region);
    }

    fn get_preview_intersection_counts(&self) -> PreviewIntersectionCounts {
        PreviewIntersectionCounts {
            same_layer_intersection_count: self.preview_same_layer_intersection_count,
            crossing_layer_intersection_count: self.preview_crossing_layer_intersection_count,
        }
    }

    pub(super) fn is_trace_segment_usable(
        &self,
        route: RouteId,
        segment: &TraceSegment,
        owners: &HashMap<PortId, RouteId>,
    ) -> bool {
        if self.core.topology.port_z[segment.from_port_id as usize] != 0
            || self.core.topology.port_z[segment.to_port_id as usize] != 0
        {
            return false;
        }

        if owners
            .get(&segment.from_port_id)
            .is_some_and(|o| *o != route)
            || owners.get(&segment.to_port_id).is_some_and(|o| *o != route)
        {
            return false;
        }

        let geometry = self.core.populate_segment_geometry_scratch(
            segment.region_id,
            segment.from_port_id,
            segment.to_port_id,
        );
        let cache = &self.core.state.region_intersection_caches[segment.region_id as usize];
        if cache.net_ids.is_empty() {
            return true;
        }

        let (same, cross, _) = count_new_intersections_with_values(
            cache,
            self.core.problem.route_net[route as usize],
            geometry.lesser_angle,
            geometry.greater_angle,
            geometry.layer_mask,
            geometry.entry_exit_layer_changes,
        );
        same == 0 && cross == 0
    }

    pub(super) fn is_trace_preview_usable(
        &self,
        preview: &TracePreview,
        owners: &HashMap<PortId, RouteId>,
    ) -> bool {
        let mut local = owners.clone();

        for s in &preview.segments {
            if !ensure_port_ownership(preview.route_id, s.from_port_id, &mut local)
                || !ensure_port_ownership(preview.route_id, s.to_port_id, &mut local)
                || !self.is_trace_segment_usable(preview.route_id, s, &local)
            {
                return false;
            }
        }

        true
    }

    fn build_centerline_complete_trace_preview(
        &self,
        _path: &[BusCenterCandidate],
        steps: &[BoundaryStep],
        owners: &HashMap<PortId, RouteId>,
    ) -> Option<TracePreview> {
        let route = self.center_route_id;
        let start = self.core.problem.route_start_port[route as usize];
        let goal = self.core.problem.route_end_port[route as usize];
        let mut region = self.get_starting_next_region_id(route, start)?;
        let mut local = owners.clone();
        if !ensure_port_ownership(route, start, &mut local)
            || !ensure_port_ownership(route, goal, &mut local)
        {
            return None;
        }

        let mut segments = vec![];
        let mut port = start;

        for step in steps {
            if !ensure_port_ownership(route, step.center_port_id, &mut local)
                || region != step.from_region_id
            {
                return None;
            }

            if port != step.center_port_id {
                segments.push(TraceSegment {
                    region_id: region,
                    from_port_id: port,
                    to_port_id: step.center_port_id,
                });
            }

            port = step.center_port_id;
            region = step.to_region_id;
        }

        if port != goal {
            segments.push(TraceSegment {
                region_id: region,
                from_port_id: port,
                to_port_id: goal,
            });
        }

        Some(TracePreview {
            trace_index: self.center_trace_index,
            route_id: route,
            segments,
            complete: true,
            terminal_port_id: goal,
            terminal_region_id: None,
            preview_cost: Some(0.0),
        })
    }

    fn is_usable_centerline_boundary_port(&self, port: PortId) -> bool {
        self.core.problem.port_section_mask[port as usize] == 1
            && self.core.topology.port_z[port as usize] == 0
            && !self.is_port_reserved_for_different_bus_net(self.center_route_net_id, port)
    }

    fn is_manual_center_finish_region(&self, region: RegionId) -> bool {
        let distance = self.center_goal_hop_distance_by_region[region as usize];
        distance >= 0 && distance <= self.manual_center_finish_max_hops
    }

    pub fn get_additional_region_label(&self, region: RegionId) -> Option<String> {
        if !self.is_manual_center_finish_region(region) {
            return None;
        }

        Some(format!(
            "bus end-manual hop: {}",
            self.center_goal_hop_distance_by_region[region as usize]
        ))
    }

    fn get_manual_center_finish_port_options(
        &self,
        current: &BusCenterCandidate,
        next: RegionId,
    ) -> Vec<ManualPortOption> {
        let region = current.next_region_id;
        let previous = get_candidate_boundary_normal(current);
        let mut options = vec![];

        for &port in self
            .boundary_planner
            .get_usable_centerline_port_ids_between_regions(region, next)
            .into_iter()
            .flatten()
        {
            if port == current.port_id {
                continue;
            }

            let step = self.boundary_planner.create_boundary_step(
                region,
                next,
                port,
                current.port_id,
                previous,
            );
            let midpoint = self
                .boundary_planner
                .get_boundary_center_midpoint_penalty(&step);
            let length = get_port_distance(&self.core.topology, current.port_id, port);
            let h = self.scale_center_heuristic(self.compute_center_heuristic(port, Some(next)));
            let score =
                length * self.core.options.distance_to_cost * self.core.problem.route_count as f64
                    + midpoint
                    + h;
            options.push(ManualPortOption {
                boundary_step: step,
                port_id: port,
                score,
            });
        }

        options.sort_by(|l, r| {
            l.score
                .total_cmp(&r.score)
                .then_with(|| l.port_id.cmp(&r.port_id))
        });
        options.truncate(self.manual_center_finish_port_options_per_boundary);
        options
    }

    fn get_manual_center_finish_candidates(
        &self,
        current: &BusCenterCandidate,
    ) -> Vec<BusCenterCandidate> {
        let region = current.next_region_id;
        if !self.is_manual_center_finish_region(region) {
            return vec![];
        }

        let goal = self.core.problem.route_end_port[self.center_route_id as usize];
        let mut keys = HashSet::new();
        let mut completions = vec![];
        let hops = self.center_goal_hop_distance_by_region[region as usize];
        let cost = current.bus.as_ref().and_then(|bus| bus.bus_cost).unwrap_or(current.g);

        fn search(
            solver: &TinyHyperGraphBusSolver,
            candidate: &BusCenterCandidate,
            region: RegionId,
            hops: i32,
            cost: f64,
            goal: PortId,
            keys: &mut HashSet<String>,
            completions: &mut Vec<BusCenterCandidate>,
        ) -> () {
            if is_port_incident_to_region(&solver.core.topology, goal, region) {
                let length = get_port_distance(&solver.core.topology, candidate.port_id, goal);
                let g = cost
                    + length
                        * solver.core.options.distance_to_cost
                        * solver.core.problem.route_count as f64;
                let goal_candidate = BusCenterCandidate {
                    port_id: goal,
                    next_region_id: region,
                    g,
                    h: 0.0,
                    f: g,
                    at_goal: true,
                    prev_region_id: Some(region),
                    prev_candidate: Some(Rc::new(candidate.clone())),
                    ..Default::default()
                };
                let key = get_center_candidate_path_key(&goal_candidate);
                if keys.insert(key) {
                    completions.push(goal_candidate);
                }

                return;
            }

            if hops <= 0 {
                return;
            }

            let next_hops = hops - 1;

            for &next in solver
                .centerline_neighbor_region_ids_by_region
                .get(region as usize)
                .into_iter()
                .flatten()
            {
                if solver.center_goal_hop_distance_by_region[next as usize] != next_hops
                    || center_candidate_path_contains_region(candidate, next)
                {
                    continue;
                }

                for option in solver.get_manual_center_finish_port_options(candidate, next) {
                    if center_candidate_path_contains_hop(candidate, option.port_id, next) {
                        continue;
                    }

                    let _segment_length =
                        get_port_distance(&solver.core.topology, candidate.port_id, option.port_id);
                    let next_cost = cost + option.score;
                    let next_candidate = BusCenterCandidate {
                        port_id: option.port_id,
                        next_region_id: next,
                        g: next_cost,
                        h: 0.0,
                        f: next_cost,
                        prev_region_id: Some(region),
                        prev_candidate: Some(Rc::new(candidate.clone())),
                        bus: Some(Rc::new(BusCandidateState {
                            boundary_normal_x: Some(option.boundary_step.normal_x),
                            boundary_normal_y: Some(option.boundary_step.normal_y),
                            ..Default::default()
                        })),
                        ..Default::default()
                    };
                    search(
                        solver,
                        &next_candidate,
                        next,
                        next_hops,
                        next_cost,
                        goal,
                        keys,
                        completions,
                    );
                }
            }
        }

        search(
            self,
            current,
            region,
            hops,
            cost,
            goal,
            &mut keys,
            &mut completions,
        );
        completions.sort_by(|l, r| l.g.total_cmp(&r.g).then_with(|| l.port_id.cmp(&r.port_id)));
        completions.truncate(self.manual_center_finish_candidate_limit);
        completions
    }

    fn get_manual_center_finish_heuristic(
        &self,
        current: &BusCenterCandidate,
        port: PortId,
        next: RegionId,
        nx: f64,
        ny: f64,
    ) -> Option<f64> {
        let seed = BusCenterCandidate {
            port_id: port,
            next_region_id: next,
            g: 0.0,
            h: 0.0,
            f: 0.0,
            prev_region_id: Some(current.next_region_id),
            prev_candidate: Some(Rc::new(current.clone())),
            bus: Some(Rc::new(BusCandidateState {
                boundary_normal_x: Some(nx),
                boundary_normal_y: Some(ny),
                ..Default::default()
            })),
            ..Default::default()
        };
        self.get_manual_center_finish_candidates(&seed)
            .first()
            .map(|c| c.g)
    }

    fn get_available_center_moves(&self, current: &BusCenterCandidate) -> Vec<BusCenterCandidate> {
        let mut moves = vec![];
        let route = self.center_route_id;
        let net = self.center_route_net_id;
        if current.at_goal
            || self.is_region_reserved_for_different_bus_net(net, current.next_region_id)
        {
            return moves;
        }

        if self.is_manual_center_finish_region(current.next_region_id) {
            return self.get_manual_center_finish_candidates(current);
        }

        let parent = current.bus.as_ref().and_then(|bus| bus.bus_cost).unwrap_or(current.g);
        let goal = self.core.problem.route_end_port[route as usize];

        for &port in self
            .core
            .topology
            .region_incident_ports
            .get(current.next_region_id as usize)
            .into_iter()
            .flatten()
        {
            let reserved = self
                .core
                .problem_setup
                .as_ref()
                .expect("Problem setup initialized")
                .port_endpoint_reservation_net_id[port as usize];
            if port == current.port_id
                || self.core.problem.port_section_mask[port as usize] == 0
                || self.core.topology.port_z[port as usize] != 0
                || reserved == -2
                || (reserved != -1 && Some(reserved) != self.core.state.current_route_net_id)
            {
                continue;
            }

            let length = get_port_distance(&self.core.topology, current.port_id, port);
            if port == goal {
                let g = parent
                    + length
                        * self.core.options.distance_to_cost
                        * self.core.problem.route_count as f64;
                moves.push(BusCenterCandidate {
                    port_id: goal,
                    next_region_id: current.next_region_id,
                    g,
                    h: 0.0,
                    f: g,
                    at_goal: true,
                    prev_region_id: Some(current.next_region_id),
                    prev_candidate: Some(Rc::new(current.clone())),
                    ..Default::default()
                });
                continue;
            }

            let ids = &self.core.topology.incident_port_region[port as usize];
            let next = if ids.first() == Some(&current.next_region_id) {
                ids.get(1)
            } else {
                ids.first()
            };
            let Some(&next) = next else {
                continue;
            };
            if self.is_region_reserved_for_different_bus_net(net, next) {
                continue;
            }

            let step = self.boundary_planner.create_boundary_step(
                current.next_region_id,
                next,
                port,
                current.port_id,
                get_candidate_boundary_normal(current),
            );
            let support = self.boundary_planner.get_boundary_support_penalty(&step);
            let g = parent
                + length
                    * self.core.options.distance_to_cost
                    * self.core.problem.route_count as f64
                + support;
            if !self
                .boundary_planner
                .get_preferred_center_port_options_for_boundary_step(&step)
                .contains(&port)
                || center_candidate_path_contains_hop(current, port, next)
                || center_candidate_path_contains_region(current, next)
            {
                continue;
            }

            let h = if self.is_manual_center_finish_region(next) {
                self.get_manual_center_finish_heuristic(
                    current,
                    port,
                    next,
                    step.normal_x,
                    step.normal_y,
                )
            } else {
                let h = self.compute_center_heuristic(port, Some(next));
                if !h.is_finite() {
                    continue;
                }

                Some(self.scale_center_heuristic(h))
            };
            let Some(h) = h.filter(|v| v.is_finite()) else {
                continue;
            };
            moves.push(BusCenterCandidate {
                port_id: port,
                next_region_id: next,
                g,
                h,
                f: g + h,
                prev_region_id: Some(current.next_region_id),
                prev_candidate: Some(Rc::new(current.clone())),
                bus: Some(Rc::new(BusCandidateState {
                    boundary_normal_x: Some(step.normal_x),
                    boundary_normal_y: Some(step.normal_y),
                    ..Default::default()
                })),
                ..Default::default()
            });
        }

        moves
    }

    fn commit_trace_preview(
        &mut self,
        preview: &TracePreview,
        owners: &mut HashMap<PortId, RouteId>,
    ) -> f64 {
        let mut length = 0.0;
        let net = self.core.problem.route_net[preview.route_id as usize];
        self.core.state.current_route_id = Some(preview.route_id);
        self.core.state.current_route_net_id = Some(net);

        for segment in &preview.segments {
            if self.core.topology.port_z[segment.from_port_id as usize] != 0
                || self.core.topology.port_z[segment.to_port_id as usize] != 0
                || !ensure_port_ownership(preview.route_id, segment.from_port_id, owners)
                || !ensure_port_ownership(preview.route_id, segment.to_port_id, owners)
            {
                return f64::INFINITY;
            }

            self.record_preview_region_touch(segment.region_id);
            self.record_preview_port_touch(segment.from_port_id);
            self.record_preview_port_touch(segment.to_port_id);
            let cache = &self.core.state.region_intersection_caches[segment.region_id as usize];
            let same = cache.existing_same_layer_intersections;
            let crossing = cache.existing_crossing_layer_intersections;
            let cost = cache.existing_region_cost;
            self.core.state.region_segments[segment.region_id as usize].push((
                preview.route_id,
                segment.from_port_id,
                segment.to_port_id,
            ));
            self.core.state.port_assignment[segment.from_port_id as usize] = net;
            self.core.state.port_assignment[segment.to_port_id as usize] = net;
            self.core.append_segment_to_region_cache(
                segment.region_id,
                segment.from_port_id,
                segment.to_port_id,
            );
            let next = &self.core.state.region_intersection_caches[segment.region_id as usize];
            self.preview_same_layer_intersection_count +=
                next.existing_same_layer_intersections - same;
            self.preview_crossing_layer_intersection_count +=
                next.existing_crossing_layer_intersections - crossing;
            self.preview_total_region_cost += next.existing_region_cost - cost;
            length += get_port_distance(
                &self.core.topology,
                segment.from_port_id,
                segment.to_port_id,
            );
        }

        self.core.state.current_route_id = Some(self.center_route_id);
        self.core.state.current_route_net_id = Some(self.center_route_net_id);
        length
    }

    pub(super) fn get_trace_side_penalty(&self, trace: usize, port: PortId) -> f64 {
        let trace = &self.bus_trace_order.traces[trace];
        if trace.signed_index_from_center == 0 {
            return 0.0;
        }

        let projection = get_port_projection(
            &self.core.topology,
            port,
            self.bus_trace_order.normal_x,
            self.bus_trace_order.normal_y,
        );
        let center = self.bus_trace_order.traces[self.center_trace_index].score;
        let offset = projection - center;
        if (trace.signed_index_from_center < 0 && offset <= 0.0)
            || (trace.signed_index_from_center > 0 && offset >= 0.0)
        {
            return 0.0;
        }

        offset.abs()
    }

    pub(super) fn get_trace_lane_penalty(&self, trace: usize, port: PortId) -> f64 {
        let trace = &self.bus_trace_order.traces[trace];
        let projection = get_port_projection(
            &self.core.topology,
            port,
            self.bus_trace_order.normal_x,
            self.bus_trace_order.normal_y,
        );
        (projection - trace.score).abs()
    }

    pub(super) fn get_route_heuristic(&self, route: RouteId, port: PortId) -> f64 {
        self.core
            .problem_setup
            .as_ref()
            .expect("Problem setup initialized")
            .port_h_cost_to_end_of_route
            .as_ref()
            .expect("Bus routing requires route heuristic costs")
            [port as usize * self.core.problem.route_count + route as usize]
    }

    fn compute_center_heuristic(&self, port: PortId, next: Option<RegionId>) -> f64 {
        let h = self.get_route_heuristic(self.center_route_id, port);
        let Some(next) = next else {
            return h;
        };
        let region_h = self.region_distance_to_goal_by_region[next as usize];
        if !region_h.is_finite() {
            return h;
        }

        h.max(region_h * self.core.options.distance_to_cost)
    }

    fn scale_center_heuristic(&self, h: f64) -> f64 {
        h * self.core.problem.route_count as f64 * self.center_greedy_heuristic_multiplier
    }

    fn is_port_reserved_for_different_bus_net(&self, net: NetId, port: PortId) -> bool {
        self.core
            .problem_setup
            .as_ref()
            .expect("Problem setup initialized")
            .port_endpoint_net_ids
            .get(port as usize)
            .is_some_and(|ids| ids.iter().any(|id| *id != net))
    }

    pub(super) fn is_region_reserved_for_different_bus_net(
        &self,
        net: NetId,
        region: RegionId,
    ) -> bool {
        let reserved = self.core.problem.region_net_id[region as usize];
        reserved != -1 && reserved != net
    }

    pub(super) fn get_starting_next_region_id(
        &self,
        route: RouteId,
        start: PortId,
    ) -> Option<RegionId> {
        self.core.get_starting_next_region_id(route, start)
    }

    pub fn get_route_connection_id(&self, route: RouteId) -> Value {
        self.core
            .problem
            .route_metadata
            .as_ref()
            .and_then(|m| m.get(route as usize))
            .and_then(|m| m.get("connectionId"))
            .filter(|v| !v.is_null())
            .cloned()
            .unwrap_or_else(|| json!(format!("route-{route}")))
    }

    fn get_trace_connection_id(&self, trace: usize) -> String {
        self.bus_trace_order
            .traces
            .get(trace)
            .map(|t| t.connection_id.clone())
            .unwrap_or_else(|| format!("trace-{trace}"))
    }

    fn update_bus_stats(&mut self, failure: Option<&str>) -> () {
        let center = self.get_route_connection_id(self.center_route_id);
        let patch = json!({"routeCount":self.core.problem.route_count,"busCenterConnectionId":center,"currentTraceConnectionId":center,"openCandidateCount":self.core.state.candidate_queue.len(),"solvedTraceCount":self.last_preview.as_ref().map(|p|p.complete_trace_count).unwrap_or(0),"currentBusCost":self.last_expanded_candidate.as_ref().and_then(|c|c.bus.as_ref().and_then(|bus|bus.bus_cost)),"previewReason":failure.map(str::to_owned).or_else(||self.last_preview.as_ref().and_then(|p|p.reason.clone())),"previewRouteCount":self.last_preview.as_ref().map(|p|p.trace_previews.len()).unwrap_or(0),"lastNeighborCount":self.last_neighbor_count,"lastQueuedNeighborCount":self.last_queued_neighbor_count});
        let stats = self
            .core
            .stats
            .as_object_mut()
            .expect("Solver stats must be an object");

        for (key, value) in patch.as_object().expect("Stats patch") {
            stats.insert(key.clone(), value.clone());
        }
    }
}
