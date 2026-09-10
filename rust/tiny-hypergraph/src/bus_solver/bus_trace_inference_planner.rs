use super::bus_path_helpers::{
    get_guide_port_ids, get_polyline_length, get_trace_preview_length, is_port_incident_to_region,
};
use super::bus_solver_types::{
    BUS_CANDIDATE_EPSILON, BoundaryStep, BusCenterCandidate, TracePreview, TraceSegment,
};
use super::geometry::{get_distance_from_port_to_polyline, get_port_distance};
use super::tiny_hyper_graph_bus_solver::TinyHyperGraphBusSolver;
use crate::types::{NetId, PortId, RegionId, RouteId};
use std::collections::{HashMap, HashSet};

// The TS options callbacks borrow their owning solver. Rust expresses that relationship
// with a scoped planner reference, avoiding an owning self-referential closure cycle.
pub struct BusTraceInferencePlanner<'a> {
    pub solver: &'a TinyHyperGraphBusSolver,
}

#[derive(Clone)]
struct ExactPrefixTracePreview {
    preview: TracePreview,
    shared_step_count: usize,
}

struct GreedyTraceExtensionResult {
    segments: Vec<TraceSegment>,
    terminal_port_id: PortId,
    terminal_region_id: RegionId,
    preview_cost: f64,
    made_progress: bool,
}

struct ClosestValidPortMove {
    port_id: PortId,
    next_region_id: RegionId,
    guide_distance: f64,
    segment_length: f64,
}

impl<'a> BusTraceInferencePlanner<'a> {
    pub fn new(solver: &'a TinyHyperGraphBusSolver) -> Self {
        Self { solver }
    }

    pub fn has_remaining_trace_candidate(
        &self,
        preview: &TracePreview,
        owners: &HashMap<PortId, RouteId>,
    ) -> bool {
        if preview.complete {
            return true;
        }

        let route = preview.route_id;
        let net = self.solver.core.problem.route_net[route as usize];
        let port = preview.terminal_port_id;
        let Some(region) = preview.terminal_region_id else {
            return false;
        };
        let guide = vec![port];
        let visited = self.get_trace_preview_visited_port_ids(preview);
        let states = self.get_trace_preview_state_keys(preview);
        if self
            .try_complete_trace_from_current_region(
                route,
                port,
                region,
                preview.preview_cost.unwrap_or(0.0),
                &guide,
                Some(self.solver.core.problem.route_end_port[route as usize]),
                &[],
                owners,
            )
            .is_some()
        {
            return true;
        }

        self.get_closest_valid_port_move(
            route,
            net,
            port,
            region,
            &guide,
            owners,
            &visited,
            &states,
            get_trace_preview_length(&self.solver.core.topology, preview),
            None,
        )
        .is_some()
    }

    pub fn build_best_prefix_trace_preview(
        &self,
        trace: usize,
        path: &[BusCenterCandidate],
        max_shared: usize,
        steps: &[BoundaryStep],
        assignments: &[Option<Vec<PortId>>],
        owners: &HashMap<PortId, RouteId>,
    ) -> Option<TracePreview> {
        let mut best: Option<TracePreview> = None;
        let mut best_remaining = false;

        for exact in
            self.get_exact_prefix_seed_candidates(trace, max_shared, steps, assignments, owners)
        {
            let Some(preview) =
                self.build_partial_preview_from_seed(trace, path, max_shared, &exact, owners)
            else {
                continue;
            };
            let remaining = self.has_remaining_trace_candidate(&preview, owners);
            let better = match &best {
                None => true,
                Some(previous) => {
                    let cost = preview.preview_cost.unwrap_or(f64::INFINITY);
                    let old = previous.preview_cost.unwrap_or(f64::INFINITY);
                    (remaining && !best_remaining)
                        || (remaining == best_remaining && cost < old - BUS_CANDIDATE_EPSILON)
                        || (remaining == best_remaining
                            && (cost - old).abs() <= BUS_CANDIDATE_EPSILON
                            && get_trace_preview_length(&self.solver.core.topology, &preview)
                                < get_trace_preview_length(&self.solver.core.topology, previous))
                }
            };
            if better {
                best = Some(preview);
                best_remaining = remaining;
            }
        }

        best
    }

    pub fn build_complete_trace_preview(
        &self,
        trace: usize,
        path: &[BusCenterCandidate],
        steps: &[BoundaryStep],
        assignments: &[Option<Vec<PortId>>],
        owners: &HashMap<PortId, RouteId>,
    ) -> Option<TracePreview> {
        let mut best: Option<TracePreview> = None;

        for exact in
            self.get_exact_prefix_seed_candidates(trace, steps.len(), steps, assignments, owners)
        {
            let Some(preview) =
                self.build_complete_preview_from_seed(trace, path, steps.len(), &exact, owners)
            else {
                continue;
            };
            let better = match &best {
                None => true,
                Some(previous) => {
                    let cost = preview.preview_cost.unwrap_or(f64::INFINITY);
                    let old = previous.preview_cost.unwrap_or(f64::INFINITY);
                    cost < old - BUS_CANDIDATE_EPSILON
                        || ((cost - old).abs() <= BUS_CANDIDATE_EPSILON
                            && get_trace_preview_length(&self.solver.core.topology, &preview)
                                < get_trace_preview_length(&self.solver.core.topology, previous))
                }
            };
            if better {
                best = Some(preview);
            }
        }

        best
    }

    fn build_partial_preview_from_seed(
        &self,
        trace: usize,
        path: &[BusCenterCandidate],
        max_shared: usize,
        exact: &ExactPrefixTracePreview,
        owners: &HashMap<PortId, RouteId>,
    ) -> Option<TracePreview> {
        let route = self.solver.bus_trace_order.traces[trace].route_id;
        let guide = get_guide_port_ids(path, exact.shared_step_count);
        let count = path.len().saturating_sub(1);
        let length = get_polyline_length(
            &self.solver.core.topology,
            &path.iter().map(|p| p.port_id).collect::<Vec<_>>(),
        );
        let mut preview = exact.preview.clone();
        if exact.shared_step_count < max_shared {
            let extension = self.search_trace_alongside(
                trace,
                &exact.preview,
                owners,
                &guide,
                self.get_partial_trace_search_max_steps(max_shared - exact.shared_step_count),
                None,
                Some(count),
                Some(length),
            );
            if let Some(extension) = extension.filter(|e| e.made_progress) {
                preview.segments.extend(extension.segments);
                preview.trace_index = trace;
                preview.route_id = route;
                preview.complete = false;
                preview.terminal_port_id = extension.terminal_port_id;
                preview.terminal_region_id = Some(extension.terminal_region_id);
                preview.preview_cost = Some(extension.preview_cost);
            } else {
                preview.preview_cost =
                    Some(self.get_trace_preview_guide_deviation(&exact.preview, &guide));
            }
        } else {
            preview.preview_cost =
                Some(self.get_trace_preview_guide_deviation(&exact.preview, &guide));
        }

        if self.is_preview_behind_centerline(&preview, count, length) {
            Some(preview)
        } else {
            None
        }
    }

    fn build_complete_preview_from_seed(
        &self,
        trace: usize,
        path: &[BusCenterCandidate],
        max_shared: usize,
        exact: &ExactPrefixTracePreview,
        owners: &HashMap<PortId, RouteId>,
    ) -> Option<TracePreview> {
        let route = self.solver.bus_trace_order.traces[trace].route_id;
        let guide = get_guide_port_ids(path, exact.shared_step_count);
        let goal = self.solver.core.problem.route_end_port[route as usize];
        let extension = self.search_trace_alongside(
            trace,
            &exact.preview,
            owners,
            &guide,
            self.get_complete_trace_search_max_steps(max_shared - exact.shared_step_count),
            Some(goal),
            None,
            None,
        )?;
        let mut segments = exact.preview.segments.clone();
        segments.extend(extension.segments);
        Some(TracePreview {
            trace_index: trace,
            route_id: route,
            segments,
            complete: true,
            terminal_port_id: goal,
            terminal_region_id: None,
            preview_cost: Some(extension.preview_cost),
        })
    }

    fn build_longest_exact_prefix_trace_preview(
        &self,
        trace: usize,
        max_shared: usize,
        steps: &[BoundaryStep],
        assignments: &[Option<Vec<PortId>>],
        owners: &HashMap<PortId, RouteId>,
    ) -> Option<ExactPrefixTracePreview> {
        for shared in (0..=max_shared).rev() {
            let Some(preview) =
                self.solver
                    .build_prefix_trace_preview(trace, shared, steps, assignments, owners)
            else {
                continue;
            };
            if !self.solver.is_trace_preview_usable(&preview, owners) {
                continue;
            }

            return Some(ExactPrefixTracePreview {
                preview,
                shared_step_count: shared,
            });
        }

        None
    }

    fn get_exact_prefix_seed_candidates(
        &self,
        trace: usize,
        max_shared: usize,
        steps: &[BoundaryStep],
        assignments: &[Option<Vec<PortId>>],
        owners: &HashMap<PortId, RouteId>,
    ) -> Vec<ExactPrefixTracePreview> {
        let mut candidates = vec![];
        if self.solver.core.problem.route_count > 6 {
            for shared in (0..=max_shared).rev() {
                let Some(preview) = self.solver.build_prefix_trace_preview(
                    trace,
                    shared,
                    steps,
                    assignments,
                    owners,
                ) else {
                    continue;
                };
                if self.solver.is_trace_preview_usable(&preview, owners) {
                    candidates.push(ExactPrefixTracePreview {
                        preview,
                        shared_step_count: shared,
                    });
                }
            }

            return candidates;
        }

        let longest = self.build_longest_exact_prefix_trace_preview(
            trace,
            max_shared,
            steps,
            assignments,
            owners,
        );
        let include_zero = longest.as_ref().is_none_or(|p| p.shared_step_count > 0);
        if let Some(longest) = longest {
            candidates.push(longest);
        }

        if include_zero {
            if let Some(preview) =
                self.solver
                    .build_prefix_trace_preview(trace, 0, steps, assignments, owners)
            {
                if self.solver.is_trace_preview_usable(&preview, owners) {
                    candidates.push(ExactPrefixTracePreview {
                        preview,
                        shared_step_count: 0,
                    });
                }
            }
        }

        candidates
    }

    fn search_trace_alongside(
        &self,
        _trace: usize,
        prefix: &TracePreview,
        owners: &HashMap<PortId, RouteId>,
        guide: &[PortId],
        max_steps: usize,
        goal: Option<PortId>,
        max_segments: Option<usize>,
        max_length: Option<f64>,
    ) -> Option<GreedyTraceExtensionResult> {
        let route = prefix.route_id;
        let net = self.solver.core.problem.route_net[route as usize];
        let mut port = prefix.terminal_port_id;
        let mut region = prefix.terminal_region_id?;
        let mut visited = self.get_trace_preview_visited_port_ids(prefix);
        let mut states = self.get_trace_preview_state_keys(prefix);
        let mut deviation = self.get_trace_preview_guide_deviation(prefix, guide);
        let mut length = get_trace_preview_length(&self.solver.core.topology, prefix);
        let mut segments = vec![];

        for _ in 0..max_steps {
            if max_segments.is_some_and(|max| prefix.segments.len() + segments.len() >= max) {
                break;
            }

            if goal.is_some() {
                if let Some(completed) = self.try_complete_trace_from_current_region(
                    route, port, region, deviation, guide, goal, &segments, owners,
                ) {
                    return Some(completed);
                }
            }

            let Some(next) = self.get_closest_valid_port_move(
                route, net, port, region, guide, owners, &visited, &states, length, max_length,
            ) else {
                break;
            };
            segments.push(TraceSegment {
                region_id: region,
                from_port_id: port,
                to_port_id: next.port_id,
            });
            port = next.port_id;
            region = next.next_region_id;
            deviation += next.guide_distance;
            length += next.segment_length;
            visited.insert(next.port_id);
            states.insert(self.get_trace_search_state_key(next.port_id, next.next_region_id));
        }

        if goal.is_some() {
            None
        } else {
            Some(GreedyTraceExtensionResult {
                made_progress: !segments.is_empty(),
                segments,
                terminal_port_id: port,
                terminal_region_id: region,
                preview_cost: deviation,
            })
        }
    }

    fn try_complete_trace_from_current_region(
        &self,
        route: RouteId,
        port: PortId,
        region: RegionId,
        deviation: f64,
        guide: &[PortId],
        goal: Option<PortId>,
        extensions: &[TraceSegment],
        owners: &HashMap<PortId, RouteId>,
    ) -> Option<GreedyTraceExtensionResult> {
        let goal = goal?;
        if !is_port_incident_to_region(&self.solver.core.topology, goal, region) {
            return None;
        }

        if owners.get(&goal).is_some_and(|owner| *owner != route) {
            return None;
        }

        let completion = TraceSegment {
            region_id: region,
            from_port_id: port,
            to_port_id: goal,
        };
        if port != goal
            && !self
                .solver
                .is_trace_segment_usable(route, &completion, owners)
        {
            return None;
        }

        let mut segments = extensions.to_vec();
        if port != goal {
            segments.push(completion);
        }

        Some(GreedyTraceExtensionResult {
            segments,
            terminal_port_id: goal,
            terminal_region_id: region,
            preview_cost: deviation
                + if port == goal {
                    0.0
                } else {
                    get_distance_from_port_to_polyline(&self.solver.core.topology, goal, guide)
                },
            made_progress: true,
        })
    }

    fn get_closest_valid_port_move(
        &self,
        route: RouteId,
        net: NetId,
        port: PortId,
        region: RegionId,
        guide: &[PortId],
        owners: &HashMap<PortId, RouteId>,
        visited: &HashSet<PortId>,
        states: &HashSet<usize>,
        length: f64,
        max_length: Option<f64>,
    ) -> Option<ClosestValidPortMove> {
        let entry = self.get_opposite_region_id(port, region);
        let mut best: Option<ClosestValidPortMove> = None;

        for &boundary in self
            .solver
            .core
            .topology
            .region_incident_ports
            .get(region as usize)
            .into_iter()
            .flatten()
        {
            if boundary == port
                || self.solver.core.topology.port_z[boundary as usize] != 0
                || visited.contains(&boundary)
            {
                continue;
            }

            let Some(next) = self.get_opposite_region_id(boundary, region) else {
                continue;
            };
            if Some(next) == entry
                || self
                    .solver
                    .is_region_reserved_for_different_bus_net(net, next)
            {
                continue;
            }

            if owners.get(&boundary).is_some_and(|owner| *owner != route) {
                continue;
            }

            if states.contains(&self.get_trace_search_state_key(boundary, next)) {
                continue;
            }

            let segment_length = get_port_distance(&self.solver.core.topology, port, boundary);
            if max_length.is_some_and(|max| length + segment_length > max + BUS_CANDIDATE_EPSILON) {
                continue;
            }

            let segment = TraceSegment {
                region_id: region,
                from_port_id: port,
                to_port_id: boundary,
            };
            if self.solver.is_trace_segment_usable(route, &segment, owners) {
                let distance =
                    get_distance_from_port_to_polyline(&self.solver.core.topology, boundary, guide);
                if best.as_ref().is_none_or(|b| {
                    distance < b.guide_distance
                        || (distance == b.guide_distance && boundary < b.port_id)
                }) {
                    best = Some(ClosestValidPortMove {
                        port_id: boundary,
                        next_region_id: next,
                        guide_distance: distance,
                        segment_length,
                    });
                }
            }
        }

        best
    }

    fn get_trace_preview_guide_deviation(&self, preview: &TracePreview, guide: &[PortId]) -> f64 {
        preview
            .segments
            .iter()
            .map(|s| {
                get_distance_from_port_to_polyline(&self.solver.core.topology, s.to_port_id, guide)
            })
            .sum()
    }

    fn is_preview_behind_centerline(
        &self,
        preview: &TracePreview,
        count: usize,
        length: f64,
    ) -> bool {
        preview.segments.len() <= count
            && get_trace_preview_length(&self.solver.core.topology, preview)
                <= length + BUS_CANDIDATE_EPSILON
    }

    fn get_trace_preview_visited_port_ids(&self, preview: &TracePreview) -> HashSet<PortId> {
        let mut visited =
            HashSet::from([self.solver.core.problem.route_start_port[preview.route_id as usize]]);

        for segment in &preview.segments {
            visited.insert(segment.from_port_id);
            visited.insert(segment.to_port_id);
        }

        visited
    }

    fn get_trace_preview_state_keys(&self, preview: &TracePreview) -> HashSet<usize> {
        let mut states = HashSet::new();
        let mut port = self.solver.core.problem.route_start_port[preview.route_id as usize];
        let Some(mut region) = self
            .solver
            .get_starting_next_region_id(preview.route_id, port)
        else {
            return states;
        };
        states.insert(self.get_trace_search_state_key(port, region));

        for segment in &preview.segments {
            port = segment.to_port_id;
            let Some(next) = self.get_opposite_region_id(port, segment.region_id) else {
                break;
            };
            region = next;
            states.insert(self.get_trace_search_state_key(port, region));
        }

        states
    }

    fn get_trace_search_state_key(&self, port: PortId, region: RegionId) -> usize {
        port as usize * self.solver.core.topology.region_count + region as usize
    }

    fn get_opposite_region_id(&self, port: PortId, region: RegionId) -> Option<RegionId> {
        let ids = self
            .solver
            .core
            .topology
            .incident_port_region
            .get(port as usize)?;
        if ids.first() == Some(&region) {
            ids.get(1).copied()
        } else {
            ids.first().copied()
        }
    }

    fn get_partial_trace_search_max_steps(&self, remaining: usize) -> usize {
        1.max((remaining + 1).min(self.solver.bus_max_remainder_steps * 2))
    }

    fn get_complete_trace_search_max_steps(&self, remaining: usize) -> usize {
        2.max((remaining * 2 + 2).min(self.solver.bus_max_remainder_steps * 4))
    }
}
