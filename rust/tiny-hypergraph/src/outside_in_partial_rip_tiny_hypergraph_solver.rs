use crate::{
    core::*, distance_aware_tiny_hypergraph_solver::DistanceAwareTinyHyperGraphSolver,
    min_heap::MinHeap, types::*,
};
use serde::Serialize;
use serde_json::json;
use std::{
    collections::{HashMap, HashSet},
    ops::{Deref, DerefMut},
    rc::Rc,
};
pub type CommittedRouteSegment = SolvedPathSegment;

#[derive(Clone, Debug)]
pub struct PartialRipRoutePlan {
    pub route_id: RouteId,
    pub active_start_port_id: PortId,
    pub active_end_port_id: PortId,
    pub forced_start_region_id: RegionId,
    pub forced_end_region_id: RegionId,
    pub ripped_segment_count: usize,
    pub retained_segment_count: usize,
}
pub type OutsideInCandidate = Candidate;

pub struct OutsideInFrontier {
    pub queue: MinHeap<Candidate>,
    pub best_cost_by_hop_id: HashMap<HopId, f64>,
    pub settled_by_port_id: HashMap<PortId, Candidate>,
    pub settled_by_region_id: HashMap<RegionId, Vec<Candidate>>,
    pub target_port_id: PortId,
}

pub struct OutsideInRouteSearch {
    pub route_id: RouteId,
    pub forward: OutsideInFrontier,
    pub reverse: OutsideInFrontier,
    pub expand_forward_next: bool,
    pub distance_limit_hit: bool,
    pub best_joined_candidate: Option<Candidate>,
    pub best_joined_cost: f64,
    pub remaining_post_meeting_expansions: Option<i32>,
}

pub struct JoinedOutsideInCandidate {
    pub candidate: Candidate,
    pub cost: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletedRoundSummary {
    pub max_region_cost: f64,
    pub total_region_cost: f64,
    pub rip_count: usize,
    pub segment_count: usize,
    pub max_region_segment_count: usize,
    pub squared_region_segment_count: usize,
}

pub struct OutsideInPartialRipTinyHyperGraphSolver {
    pub distance_aware: DistanceAwareTinyHyperGraphSolver,
    pub partial_rip_route_plans: HashMap<RouteId, PartialRipRoutePlan>,
    pub outside_in_route_search: Option<OutsideInRouteSearch>,
    pub one_sided_fallback_route_id: Option<RouteId>,
    pub partial_rip_window_distance: Option<f64>,
    pub partial_rip_count: usize,
    pub partially_ripped_route_count: usize,
    pub partially_ripped_segment_count: usize,
    pub retained_partial_rip_segment_count: usize,
    pub outside_in_route_count: usize,
    pub outside_in_completed_route_count: usize,
    pub outside_in_fallback_route_count: usize,
    pub outside_in_forward_expansion_count: usize,
    pub outside_in_reverse_expansion_count: usize,
    pub outside_in_distance_prune_count: usize,
    pub completed_round_summaries: Vec<CompletedRoundSummary>,
    pub first_completed_round_summary: Option<CompletedRoundSummary>,
    pub partial_rip_quality_baseline_summary: Option<CompletedRoundSummary>,
    pub best_solved_round_summary: Option<CompletedRoundSummary>,
    pub partial_rip_target_reached: bool,
    pub use_complexity_aware_selection: bool,
    pub defer_out_of_candidates: bool,
    pub pending_out_of_candidates: bool,
}

impl Deref for OutsideInPartialRipTinyHyperGraphSolver {
    type Target = TinyHyperGraphSolver;

    fn deref(&self) -> &Self::Target {
        &self.distance_aware.core
    }
}

impl DerefMut for OutsideInPartialRipTinyHyperGraphSolver {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.distance_aware.core
    }
}

impl OutsideInPartialRipTinyHyperGraphSolver {
    pub fn new(
        topology: TinyHyperGraphTopology,
        problem: TinyHyperGraphProblem,
        options: Option<TinyHyperGraphSolverOptions>,
    ) -> Self {
        let mut distance_aware =
            DistanceAwareTinyHyperGraphSolver::new(topology, problem, options.clone());
        if options
            .as_ref()
            .and_then(|o| o.partial_rip_enabled)
            .is_none()
        {
            distance_aware.options.partial_rip_enabled = true;
        }

        if options
            .as_ref()
            .and_then(|o| o.outside_in_routing)
            .is_none()
        {
            distance_aware.options.outside_in_routing = true;
        }

        if distance_aware.options.partial_rip_enabled
            && options
                .as_ref()
                .and_then(|o| o.partial_rip_max_attempts)
                .is_none()
        {
            distance_aware.options.partial_rip_max_attempts = 10.0;
        }

        let count = distance_aware.problem.route_count as f64;
        if count < distance_aware.options.partial_rip_min_route_count.max(0.0)
            || count > distance_aware.options.partial_rip_max_route_count.max(0.0)
        {
            distance_aware.options.partial_rip_enabled = false;
            distance_aware.options.outside_in_routing = false;
        }

        let complexity = count
            >= distance_aware
                .options
                .partial_rip_complexity_selection_min_route_count
                .max(0.0);
        distance_aware.core.deferred_section_callbacks = true;
        Self {
            distance_aware,
            partial_rip_route_plans: HashMap::new(),
            outside_in_route_search: None,
            one_sided_fallback_route_id: None,
            partial_rip_window_distance: None,
            partial_rip_count: 0,
            partially_ripped_route_count: 0,
            partially_ripped_segment_count: 0,
            retained_partial_rip_segment_count: 0,
            outside_in_route_count: 0,
            outside_in_completed_route_count: 0,
            outside_in_fallback_route_count: 0,
            outside_in_forward_expansion_count: 0,
            outside_in_reverse_expansion_count: 0,
            outside_in_distance_prune_count: 0,
            completed_round_summaries: vec![],
            first_completed_round_summary: None,
            partial_rip_quality_baseline_summary: None,
            best_solved_round_summary: None,
            partial_rip_target_reached: false,
            use_complexity_aware_selection: complexity,
            defer_out_of_candidates: false,
            pending_out_of_candidates: false,
        }
    }

    pub fn sync_partial_rip_endpoints(&mut self) {
        let mut endpoints = HashMap::new();
        let mut regions = vec![None; self.problem.route_count];
        if self.options.partial_rip_enabled {
            for (&route, plan) in &self.partial_rip_route_plans {
                endpoints.insert(route, (plan.active_start_port_id, plan.active_end_port_id));
                regions[route as usize] = Some(plan.forced_start_region_id);
            }
        }

        self.active_route_endpoints = endpoints;
        self.forced_start_region_ids = Some(regions);
    }

    pub fn get_ending_next_region_id(&self, route: RouteId, end: PortId) -> Option<RegionId> {
        if let Some(plan) = self.partial_rip_route_plans.get(&route)
            && plan.active_end_port_id == end
        {
            return Some(plan.forced_end_region_id);
        }

        self.distance_aware
            .core
            .get_starting_next_region_id(route, end)
    }

    pub fn on_path_found(&mut self, candidate: Candidate) {
        let route = self.state.current_route_id;
        let outside =
            route.is_some() && self.outside_in_route_search.as_ref().map(|s| s.route_id) == route;
        self.distance_aware.on_path_found(candidate);
        self.finish_route_transition(route, outside);
    }

    pub fn finish_route_transition(&mut self, route: Option<RouteId>, outside: bool) {
        if !self.options.partial_rip_enabled && !self.options.outside_in_routing {
            return;
        }

        if let Some(route) = route
            && self.state.current_route_id.is_none()
        {
            self.partial_rip_route_plans.remove(&route);
            if outside {
                self.outside_in_completed_route_count += 1;
            }

            if self.one_sided_fallback_route_id == Some(route) {
                self.one_sided_fallback_route_id = None;
            }
        }

        self.outside_in_route_search = None;
        self.sync_partial_rip_endpoints();
        self.publish_outside_in_stats();
    }

    pub fn reset_routing_state_for_rerip(&mut self) {
        if self.options.partial_rip_enabled || self.options.outside_in_routing {
            self.partial_rip_route_plans.clear();
            self.outside_in_route_search = None;
            self.one_sided_fallback_route_id = None;
            self.sync_partial_rip_endpoints();
        }

        self.distance_aware.core.reset_routing_state_for_rerip();
    }

    pub fn clear_partial_rip_plans(&mut self, routes: &indexmap::IndexSet<RouteId>) {
        for route in routes {
            self.partial_rip_route_plans.remove(route);
        }

        self.sync_partial_rip_endpoints();
    }

    pub fn get_committed_route_segments(
        &self,
        route: RouteId,
    ) -> Option<Vec<CommittedRouteSegment>> {
        let mut segments = vec![];
        let mut by_port: HashMap<PortId, Vec<usize>> = HashMap::new();

        for (region, items) in self.state.region_segments.iter().enumerate() {
            for &(owner, from, to) in items {
                if owner != route {
                    continue;
                }

                let index = segments.len();
                segments.push(SolvedPathSegment {
                    region_id: region as i32,
                    from_port_id: from,
                    to_port_id: to,
                });

                for p in [from, to] {
                    by_port.entry(p).or_default().push(index);
                }
            }
        }

        if segments.is_empty() {
            return None;
        }

        fn append_path(
            port: PortId,
            end: PortId,
            segments: &[CommittedRouteSegment],
            by_port: &HashMap<PortId, Vec<usize>>,
            used: &mut HashSet<usize>,
            visited: &mut HashSet<PortId>,
            ordered: &mut Vec<CommittedRouteSegment>,
        ) -> bool {
            if port == end {
                return true;
            }

            for &index in by_port.get(&port).into_iter().flatten() {
                if used.contains(&index) {
                    continue;
                }

                let segment = &segments[index];
                let next = if segment.from_port_id == port {
                    segment.to_port_id
                } else {
                    segment.from_port_id
                };
                if visited.contains(&next) {
                    continue;
                }

                used.insert(index);
                visited.insert(next);
                ordered.push(SolvedPathSegment {
                    region_id: segment.region_id,
                    from_port_id: port,
                    to_port_id: next,
                });
                if append_path(next, end, segments, by_port, used, visited, ordered) {
                    return true;
                }

                ordered.pop();
                visited.remove(&next);
                used.remove(&index);
            }

            false
        }

        let start = self.problem.route_start_port[route as usize];
        let mut used = HashSet::new();
        let mut visited = HashSet::from([start]);
        let mut ordered = vec![];
        if !append_path(
            start,
            self.problem.route_end_port[route as usize],
            &segments,
            &by_port,
            &mut used,
            &mut visited,
            &mut ordered,
        ) || used.len() != segments.len()
        {
            None
        } else {
            Some(ordered)
        }
    }

    pub fn get_segment_distance(&self, segment: &CommittedRouteSegment) -> f64 {
        let dx = self.topology.port_x[segment.from_port_id as usize]
            - self.topology.port_x[segment.to_port_id as usize];
        let dy = self.topology.port_y[segment.from_port_id as usize]
            - self.topology.port_y[segment.to_port_id as usize];
        (dx * dx + dy * dy).sqrt()
    }

    pub fn get_partial_rip_window(
        &self,
        segments: &[CommittedRouteSegment],
        hot: &HashSet<RegionId>,
        costs: &[f64],
    ) -> Option<(usize, usize)> {
        let mut hottest = None;
        let mut max = f64::NEG_INFINITY;

        for (i, s) in segments.iter().enumerate() {
            if hot.contains(&s.region_id) && costs[s.region_id as usize] > max {
                hottest = Some(i);
                max = costs[s.region_id as usize];
            }
        }

        let hottest = hottest?;
        let max_distance = self
            .partial_rip_window_distance
            .unwrap_or(self.options.partial_rip_max_distance)
            .max(0.0);
        let mut start = hottest;
        let mut end = hottest;
        let mut start_distance = self.get_segment_distance(&segments[hottest]) / 2.0;
        let mut end_distance = start_distance;

        while start > 0 {
            let next = self.get_segment_distance(&segments[start - 1]);
            if start_distance + next > max_distance {
                break;
            }

            start -= 1;
            start_distance += next;
        }

        while end + 1 < segments.len() {
            let next = self.get_segment_distance(&segments[end + 1]);
            if end_distance + next > max_distance {
                break;
            }

            end += 1;
            end_distance += next;
        }

        Some((start, end))
    }

    pub fn prepare_partial_rip(&mut self, hot: &[RegionId], costs: &[f64]) -> bool {
        if !self.options.partial_rip_enabled || hot.is_empty() {
            return false;
        }

        let hot_set: HashSet<_> = hot.iter().copied().collect();
        if self.partial_rip_window_distance.is_none() {
            let max = hot
                .iter()
                .fold(0.0_f64, |max, &r| max.max(costs[r as usize]));
            let base = self.options.partial_rip_max_distance.max(0.0);
            let quality = self
                .options
                .partial_rip_quality_max_distance
                .unwrap_or(base * 2.0)
                .max(base);
            self.partial_rip_window_distance =
                Some(if max <= self.options.rip_threshold_end * 1.5 {
                    quality
                } else {
                    base
                });
        }

        let mut touching = HashSet::new();

        for &r in hot {
            for &(route, _, _) in &self.state.region_segments[r as usize] {
                touching.insert(route);
            }
        }

        if touching.is_empty() {
            return false;
        }

        let preferred: HashSet<RouteId> = if self.preserve_initial_assignments {
            self.problem
                .initial_assignments
                .iter()
                .flatten()
                .map(|assignment| assignment.route_id)
                .collect()
        } else {
            HashSet::new()
        };
        let has_non_preferred = touching.iter().any(|route| !preferred.contains(route));

        let mut retained = vec![vec![]; self.topology.region_count];
        let mut plans = HashMap::new();
        let mut ripped_count = 0;
        let mut retained_count = 0;

        for route in 0..self.problem.route_count as i32 {
            let Some(segments) = self.get_committed_route_segments(route) else {
                return false;
            };
            if !touching.contains(&route) || (has_non_preferred && preferred.contains(&route)) {
                for s in segments {
                    retained[s.region_id as usize].push((route, s.from_port_id, s.to_port_id));
                    retained_count += 1;
                }

                continue;
            }

            let Some((start, end)) = self.get_partial_rip_window(&segments, &hot_set, costs) else {
                return false;
            };

            for (i, s) in segments.iter().enumerate() {
                if i >= start && i <= end {
                    ripped_count += 1;
                    continue;
                }

                retained[s.region_id as usize].push((route, s.from_port_id, s.to_port_id));
                retained_count += 1;
            }

            plans.insert(
                route,
                PartialRipRoutePlan {
                    route_id: route,
                    active_start_port_id: segments[start].from_port_id,
                    active_end_port_id: segments[end].to_port_id,
                    forced_start_region_id: segments[start].region_id,
                    forced_end_region_id: segments[end].region_id,
                    ripped_segment_count: end - start + 1,
                    retained_segment_count: segments.len() - (end - start + 1),
                },
            );
        }

        if plans.is_empty() || ripped_count == 0 {
            return false;
        }

        let mut routes: Vec<_> = plans.keys().copied().collect();
        routes.sort();
        self.partial_rip_route_plans = plans;
        self.sync_partial_rip_endpoints();
        self.rebuild_retained_routing_state(retained, routes);
        self.partial_rip_count += 1;
        self.partially_ripped_route_count += self.partial_rip_route_plans.len();
        self.partially_ripped_segment_count += ripped_count;
        self.retained_partial_rip_segment_count += retained_count;
        self.publish_partial_rip_stats();
        true
    }

    pub fn rebuild_retained_routing_state(
        &mut self,
        retained: Vec<Vec<(RouteId, PortId, PortId)>>,
        unrouted: Vec<RouteId>,
    ) {
        self.state.port_assignment.fill(-1);
        self.state.region_segments = vec![vec![]; self.topology.region_count];
        self.state.region_intersection_caches = (0..self.topology.region_count)
            .map(|_| create_empty_region_intersection_cache())
            .collect();
        self.state.current_route_id = None;
        self.state.current_route_net_id = None;
        self.state.unrouted_routes = unrouted;
        self.state.candidate_queue.clear();
        self.reset_candidate_best_costs();
        self.state.goal_port_id = -1;
        self.outside_in_route_search = None;
        self.one_sided_fallback_route_id = None;

        for (region, segments) in retained.into_iter().enumerate() {
            for (route, from, to) in segments {
                let net = self.problem.route_net[route as usize];
                self.state.current_route_net_id = Some(net);

                for port in [from, to] {
                    let assigned = self.state.port_assignment[port as usize];
                    assert!(
                        assigned == -1 || assigned == net,
                        "OutsideInPartialRipTinyHyperGraphSolver: retained port {port} belongs to multiple nets"
                    );
                    self.state.port_assignment[port as usize] = net;
                }

                self.state.region_segments[region].push((route, from, to));
                self.append_segment_to_region_cache(region as i32, from, to);
            }
        }

        self.state.current_route_net_id = None;
    }

    pub fn publish_partial_rip_stats(&mut self) {
        let values = json!({"partialRipCount":self.partial_rip_count,"partiallyRippedRouteCount":self.partially_ripped_route_count,"partiallyRippedSegmentCount":self.partially_ripped_segment_count,"retainedPartialRipSegmentCount":self.retained_partial_rip_segment_count,"partialRipMaxDistance":self.partial_rip_window_distance.unwrap_or(self.options.partial_rip_max_distance),"partialRipBaseMaxDistance":self.options.partial_rip_max_distance,"partialRipQualityMaxDistance":self.options.partial_rip_quality_max_distance.unwrap_or(self.options.partial_rip_max_distance*2.0),"partialRipMaxAttempts":self.options.partial_rip_max_attempts});
        self.merge_stats(values);
    }

    pub fn publish_outside_in_stats(&mut self) {
        let values = json!({"outsideInRouteCount":self.outside_in_route_count,"outsideInCompletedRouteCount":self.outside_in_completed_route_count,"outsideInFallbackRouteCount":self.outside_in_fallback_route_count,"outsideInForwardExpansionCount":self.outside_in_forward_expansion_count,"outsideInReverseExpansionCount":self.outside_in_reverse_expansion_count,"outsideInDistancePruneCount":self.outside_in_distance_prune_count,"outsideInMaxDistance":self.options.outside_in_max_distance});
        self.merge_stats(values);
    }

    pub fn create_outside_in_frontier(
        &self,
        start: PortId,
        region: RegionId,
        target: PortId,
    ) -> OutsideInFrontier {
        let mut queue = MinHeap::new(
            vec![],
            |a: &Candidate, b: &Candidate| if a.f == b.f { a.g - b.g } else { a.f - b.f },
        );
        let dx = self.topology.port_x[start as usize] - self.topology.port_x[target as usize];
        let dy = self.topology.port_y[start as usize] - self.topology.port_y[target as usize];
        let h = (dx * dx + dy * dy).sqrt() * self.options.distance_to_cost;
        queue.queue(Candidate {
            port_id: start,
            next_region_id: region,
            f: h,
            h,
            ..Default::default()
        });
        OutsideInFrontier {
            queue,
            best_cost_by_hop_id: HashMap::from([(self.get_hop_id(start, region), 0.0)]),
            settled_by_port_id: HashMap::new(),
            settled_by_region_id: HashMap::new(),
            target_port_id: target,
        }
    }

    pub fn start_outside_in_route_search(&mut self, route: RouteId) -> bool {
        let start = self.get_route_start_port_id(route);
        let end = self.get_route_end_port_id(route);
        let Some(start_region) = self.get_starting_next_region_id(route, start) else {
            return false;
        };
        let Some(end_region) = self.get_ending_next_region_id(route, end) else {
            return false;
        };
        self.state.goal_port_id = end;
        self.state.candidate_queue.clear();
        self.reset_candidate_best_costs();
        self.outside_in_route_search = Some(OutsideInRouteSearch {
            route_id: route,
            forward: self.create_outside_in_frontier(start, start_region, end),
            reverse: self.create_outside_in_frontier(end, end_region, start),
            expand_forward_next: true,
            distance_limit_hit: false,
            best_joined_candidate: None,
            best_joined_cost: f64::INFINITY,
            remaining_post_meeting_expansions: None,
        });
        self.outside_in_route_count += 1;
        self.publish_outside_in_stats();
        true
    }

    pub fn dequeue_fresh_candidate(&self, frontier: &mut OutsideInFrontier) -> Option<Candidate> {
        while let Some(candidate) = frontier.queue.dequeue() {
            let hop = self.get_hop_id(candidate.port_id, candidate.next_region_id);
            if candidate.g
                <= frontier
                    .best_cost_by_hop_id
                    .get(&hop)
                    .copied()
                    .unwrap_or(f64::INFINITY)
            {
                return Some(candidate);
            }
        }

        None
    }

    pub fn record_settled_candidate(frontier: &mut OutsideInFrontier, candidate: &Candidate) {
        if frontier
            .settled_by_port_id
            .get(&candidate.port_id)
            .is_none_or(|c| candidate.g < c.g)
        {
            frontier
                .settled_by_port_id
                .insert(candidate.port_id, candidate.clone());
        }

        let list = frontier
            .settled_by_region_id
            .entry(candidate.next_region_id)
            .or_default();
        list.push(candidate.clone());
        list.sort_by(|a, b| a.g.total_cmp(&b.g));
        list.truncate(16);
    }

    pub fn get_candidate_path(candidate: &Candidate) -> Vec<&Candidate> {
        let mut path = vec![];
        let mut cursor = Some(candidate);

        while let Some(c) = cursor {
            path.push(c);
            cursor = c.prev_candidate.as_deref();
        }

        path.reverse();
        path
    }

    pub fn build_joined_candidate(
        &mut self,
        forward: &Candidate,
        reverse: &Candidate,
    ) -> Option<JoinedOutsideInCandidate> {
        let forward_path = Self::get_candidate_path(forward);
        let reverse_path = Self::get_candidate_path(reverse);
        let mut ports: Vec<_> = forward_path.iter().map(|c| c.port_id).collect();
        let mut regions: Vec<_> = forward_path
            .iter()
            .take(forward_path.len() - 1)
            .map(|c| c.next_region_id)
            .collect();
        if forward.port_id != reverse.port_id {
            if forward.next_region_id != reverse.next_region_id {
                return None;
            }

            let dx = self.topology.port_x[forward.port_id as usize]
                - self.topology.port_x[reverse.port_id as usize];
            let dy = self.topology.port_y[forward.port_id as usize]
                - self.topology.port_y[reverse.port_id as usize];
            let distance = (dx * dx + dy * dy).sqrt();
            if forward.travel_distance + reverse.travel_distance + distance
                > self.options.outside_in_max_distance * 2.0
            {
                return None;
            }

            if !self
                .compute_g(forward, reverse.port_id, f64::INFINITY, None)
                .is_finite()
            {
                return None;
            }

            regions.push(forward.next_region_id);
            ports.push(reverse.port_id);
        }

        for c in reverse_path.iter().take(reverse_path.len() - 1).rev() {
            regions.push(c.next_region_id);
            ports.push(c.port_id);
        }

        if ports.iter().collect::<HashSet<_>>().len() != ports.len()
            || regions.len() + 1 != ports.len()
        {
            return None;
        }

        let mut joined = Candidate {
            port_id: ports[0],
            next_region_id: regions[0],
            ..Default::default()
        };

        for i in 1..ports.len() {
            joined = Candidate {
                port_id: ports[i],
                prev_region_id: Some(regions[i - 1]),
                next_region_id: regions.get(i).copied().unwrap_or(regions[i - 1]),
                prev_candidate: Some(Rc::new(joined)),
                ..Default::default()
            };
        }

        let connector = if forward.port_id == reverse.port_id {
            0.0
        } else {
            self.compute_g(forward, reverse.port_id, f64::INFINITY, None) - forward.g
        };
        Some(JoinedOutsideInCandidate {
            candidate: joined,
            cost: forward.g + reverse.g + connector,
        })
    }

    pub fn consider_outside_in_joins(
        &mut self,
        search: &mut OutsideInRouteSearch,
        candidate: &Candidate,
        expanding_forward: bool,
    ) {
        let opposite = if expanding_forward {
            &search.reverse
        } else {
            &search.forward
        };
        let candidates = opposite
            .settled_by_port_id
            .get(&candidate.port_id)
            .into_iter()
            .chain(
                opposite
                    .settled_by_region_id
                    .get(&candidate.next_region_id)
                    .into_iter()
                    .flatten(),
            );

        for opposite in candidates {
            let joined = if expanding_forward {
                self.build_joined_candidate(candidate, opposite)
            } else {
                self.build_joined_candidate(opposite, candidate)
            };
            if let Some(joined) = joined
                && joined.cost < search.best_joined_cost
            {
                search.best_joined_candidate = Some(joined.candidate);
                search.best_joined_cost = joined.cost;
                search.remaining_post_meeting_expansions = Some(24);
            }
        }
    }

    pub fn commit_best_outside_in_join(&mut self) -> bool {
        let joined = self
            .outside_in_route_search
            .as_ref()
            .and_then(|s| s.best_joined_candidate.clone());
        let Some(joined) = joined else {
            return false;
        };
        self.on_path_found(joined);
        true
    }

    pub fn expand_outside_in_frontier(&mut self, forward: bool) -> bool {
        let mut search = self
            .outside_in_route_search
            .take()
            .expect("outside in route search");
        let frontier = if forward {
            &mut search.forward
        } else {
            &mut search.reverse
        };
        let Some(candidate) = self.dequeue_fresh_candidate(frontier) else {
            self.outside_in_route_search = Some(search);
            return false;
        };
        if forward {
            self.outside_in_forward_expansion_count += 1;
        } else {
            self.outside_in_reverse_expansion_count += 1;
        }

        if self.is_region_reserved_for_different_net(candidate.next_region_id) {
            self.outside_in_route_search = Some(search);
            return true;
        }

        Self::record_settled_candidate(frontier, &candidate);
        self.consider_outside_in_joins(&mut search, &candidate, forward);
        let region = candidate.next_region_id as usize;
        let mut previous_candidate = None;
        for index in 0..self.topology.region_incident_ports[region].len() {
            let neighbor = self.topology.region_incident_ports[region][index];
            if neighbor == candidate.port_id || self.is_port_reserved_for_different_net(neighbor) {
                continue;
            }

            let assigned = self.state.port_assignment[neighbor as usize];
            if assigned != -1 && Some(assigned) != self.state.current_route_net_id {
                continue;
            }

            let target = if forward {
                search.forward.target_port_id
            } else {
                search.reverse.target_port_id
            };
            if neighbor != target && self.problem.port_section_mask[neighbor as usize] == 0 {
                continue;
            }

            let dx = self.topology.port_x[candidate.port_id as usize]
                - self.topology.port_x[neighbor as usize];
            let dy = self.topology.port_y[candidate.port_id as usize]
                - self.topology.port_y[neighbor as usize];
            let distance = (dx * dx + dy * dy).sqrt();
            let travel = candidate.travel_distance + distance;
            if travel > self.options.outside_in_max_distance {
                search.distance_limit_hit = true;
                self.outside_in_distance_prune_count += 1;
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

            let frontier = if forward {
                &mut search.forward
            } else {
                &mut search.reverse
            };
            let hop = self.get_hop_id(neighbor, next);
            let best = frontier
                .best_cost_by_hop_id
                .get(&hop)
                .copied()
                .unwrap_or(f64::INFINITY);
            if candidate.g >= best {
                continue;
            }

            let g = self.compute_g(&candidate, neighbor, best, Some(distance));
            if !g.is_finite() || g >= best {
                continue;
            }

            frontier.best_cost_by_hop_id.insert(hop, g);
            let dx =
                self.topology.port_x[neighbor as usize] - self.topology.port_x[target as usize];
            let dy =
                self.topology.port_y[neighbor as usize] - self.topology.port_y[target as usize];
            let h = (dx * dx + dy * dy).sqrt() * self.options.distance_to_cost;
            frontier.queue.queue(Candidate {
                port_id: neighbor,
                prev_region_id: Some(candidate.next_region_id),
                next_region_id: next,
                prev_candidate: Some(Rc::clone(
                    previous_candidate.get_or_insert_with(|| Rc::new(candidate.clone())),
                )),
                f: g + h,
                g,
                h,
                travel_distance: travel,
                ..Default::default()
            });
        }

        self.outside_in_route_search = Some(search);
        true
    }

    pub fn fall_back_to_one_sided_route_search(&mut self) {
        let Some(route) = self.state.current_route_id else {
            return;
        };
        self.outside_in_route_search = None;
        self.outside_in_fallback_route_count += 1;
        self.one_sided_fallback_route_id = Some(route);
        self.state.current_route_id = None;
        self.state.current_route_net_id = None;
        self.state.goal_port_id = -1;
        self.state.candidate_queue.clear();
        self.reset_candidate_best_costs();
        self.state.unrouted_routes.insert(0, route);
        self.publish_outside_in_stats();
    }

    pub fn step_one_sided(&mut self) {
        let route = self
            .state
            .current_route_id
            .or_else(|| self.state.unrouted_routes.first().copied());
        self.distance_aware.core.step();
        if self.state.current_route_id.is_none() && self.pending_section_event.is_none() {
            self.finish_route_transition(route, false);
        }

        if let Some(event) = self.pending_section_event.take() {
            match event {
                SectionEvent::AllRoutesRouted => self.on_all_routes_routed(),
                SectionEvent::OutOfCandidates => self.on_out_of_candidates(),
                SectionEvent::FinalAcceptance => self.try_final_acceptance(),
            }
        }
    }

    pub fn step(&mut self) {
        let route = self
            .state
            .current_route_id
            .or_else(|| self.state.unrouted_routes.first().copied());
        if !self.options.outside_in_routing
            || route.is_some_and(|r| !self.partial_rip_route_plans.contains_key(&r))
            || self.one_sided_fallback_route_id.is_some()
        {
            self.step_one_sided();
            return;
        }

        if self.state.current_route_id.is_none() {
            if self.state.unrouted_routes.is_empty() {
                self.on_all_routes_routed();
                return;
            }

            let route = self.state.unrouted_routes.remove(0);
            self.state.current_route_id = Some(route);
            self.state.current_route_net_id = Some(self.problem.route_net[route as usize]);
            self.route_attempt_count_by_route_id[route as usize] += 1;
            if !self.start_outside_in_route_search(route) {
                self.failed = true;
                self.error = Some(format!(
                    "Route {route} has an endpoint without an incident region"
                ));
                return;
            }
        }

        let Some(search) = self.outside_in_route_search.as_ref() else {
            return;
        };
        let forward = search.expand_forward_next;
        let mut expanded = self.expand_outside_in_frontier(forward);
        if self.state.current_route_id.is_none() {
            return;
        }

        if !expanded {
            expanded = self.expand_outside_in_frontier(!forward);
            if self.state.current_route_id.is_none() {
                return;
            }
        }

        let search = self
            .outside_in_route_search
            .as_mut()
            .expect("active outside in search");
        search.expand_forward_next = !forward;
        if search.best_joined_candidate.is_some() {
            search.remaining_post_meeting_expansions =
                Some(search.remaining_post_meeting_expansions.unwrap_or(1) - 1);
            if search.remaining_post_meeting_expansions.unwrap_or(0) <= 0 {
                self.commit_best_outside_in_join();
                return;
            }
        }

        let exhausted =
            !expanded && search.forward.queue.length() == 0 && search.reverse.queue.length() == 0;
        let distance_hit = search.distance_limit_hit;
        if exhausted {
            if self.commit_best_outside_in_join() {
                return;
            }

            self.outside_in_route_search = None;
            if distance_hit {
                self.fall_back_to_one_sided_route_search();
            } else {
                self.on_out_of_candidates();
            }
        }

        self.publish_outside_in_stats();
    }

    pub fn on_out_of_candidates(&mut self) {
        if self.defer_out_of_candidates {
            self.pending_out_of_candidates = true;
            return;
        }

        self.deferred_section_callbacks = false;
        self.distance_aware.core.on_out_of_candidates();
        self.deferred_section_callbacks = true;
        self.partial_rip_route_plans.clear();
        self.outside_in_route_search = None;
        self.one_sided_fallback_route_id = None;
        self.sync_partial_rip_endpoints();
    }

    pub fn try_final_acceptance(&mut self) {
        self.deferred_section_callbacks = false;
        self.distance_aware.core.try_final_acceptance();
        self.deferred_section_callbacks = true;
    }

    pub fn solve(&mut self) {
        if !self.is_setup {
            self.distance_aware.setup();
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

    pub fn should_replace_best_solved_state(&self, summary: &CompletedRoundSummary) -> bool {
        let Some(best) = &self.best_solved_round_summary else {
            return true;
        };
        let compare = || {
            if summary.max_region_cost != best.max_region_cost {
                summary.max_region_cost - best.max_region_cost
            } else {
                summary.total_region_cost - best.total_region_cost
            }
        };
        if !self.use_complexity_aware_selection {
            return compare() < 0.0;
        }

        let Some(quality) = &self.partial_rip_quality_baseline_summary else {
            return compare() < 0.0;
        };
        let baseline = self
            .first_completed_round_summary
            .as_ref()
            .unwrap_or(quality);
        let max = baseline.max_region_cost
            * (1.0
                + self
                    .options
                    .partial_rip_max_region_cost_growth_ratio
                    .max(0.0));
        let total = baseline.total_region_cost
            * (1.0
                + self
                    .options
                    .partial_rip_max_total_cost_growth_ratio
                    .max(0.0));
        let eligible = summary.max_region_cost <= max && summary.total_region_cost <= total;
        let best_eligible = best.max_region_cost <= max && best.total_region_cost <= total;
        if eligible != best_eligible {
            return eligible;
        }

        if eligible && summary.segment_count != best.segment_count {
            return summary.segment_count < best.segment_count;
        }

        compare() < 0.0
    }

    pub fn on_all_routes_routed(&mut self) {
        if !self.options.partial_rip_enabled {
            self.deferred_section_callbacks = false;
            self.distance_aware.core.on_all_routes_routed();
            self.deferred_section_callbacks = true;
            return;
        }

        let attempts = self
            .options
            .rip_threshold_ramp_attempts
            .min(self.options.partial_rip_max_attempts);
        let ramp = self.options.rip_threshold_ramp_attempts.max(0.0);
        let progress = if ramp <= 0.0 {
            1.0
        } else {
            (self.state.rip_count as f64 / ramp).min(1.0)
        };
        let threshold = self.options.rip_threshold_start
            + (self.options.rip_threshold_end - self.options.rip_threshold_start) * progress;
        let mut costs = vec![0.0; self.topology.region_count];
        let mut hot = vec![];
        let mut round = CompletedRoundSummary {
            max_region_cost: 0.0,
            total_region_cost: 0.0,
            rip_count: self.state.rip_count,
            segment_count: 0,
            max_region_segment_count: 0,
            squared_region_segment_count: 0,
        };

        for (region, stored_cost) in costs[..self.topology.region_count].iter_mut().enumerate() {
            let cost = self.state.region_intersection_caches[region].existing_region_cost;
            *stored_cost = cost;
            round.max_region_cost = round.max_region_cost.max(cost);
            round.total_region_cost += cost;
            let count = self.state.region_segments[region].len();
            round.segment_count += count;
            round.max_region_segment_count = round.max_region_segment_count.max(count);
            round.squared_region_segment_count += count * count;
            if cost > threshold {
                hot.push(region as i32);
            }
        }

        self.completed_round_summaries.push(round.clone());
        if self.first_completed_round_summary.is_none() {
            self.first_completed_round_summary = Some(round.clone());
        }

        if self.partial_rip_quality_baseline_summary.is_none()
            && self.state.rip_count as f64
                >= self.options.partial_rip_warmup_full_rip_attempts.max(0.0)
        {
            self.partial_rip_quality_baseline_summary = Some(round.clone());
        }

        if self.should_replace_best_solved_state(&round) {
            self.replace_best_solved_state(RegionCostSummary {
                max_region_cost: round.max_region_cost,
                total_region_cost: round.total_region_cost,
            });
            self.best_solved_round_summary = Some(round.clone());
        }

        let first = self
            .first_completed_round_summary
            .as_ref()
            .expect("first round");
        let baseline = self
            .partial_rip_quality_baseline_summary
            .as_ref()
            .unwrap_or(first);
        let ratio = self
            .options
            .partial_rip_target_max_cost_improvement_ratio
            .max(0.0);
        let target = baseline.max_region_cost * (1.0 - ratio);
        let target_total = baseline.total_region_cost
            * (1.0
                + self
                    .options
                    .partial_rip_max_total_cost_growth_ratio
                    .max(0.0));
        let reached = self.use_complexity_aware_selection
            && self.state.rip_count > baseline.rip_count
            && ratio > 0.0
            && round.max_region_cost <= target
            && round.total_region_cost <= target_total
            && round.segment_count <= baseline.segment_count;
        let values = json!({"currentRipThreshold":threshold,"hotRegionCount":hot.len(),"maxRegionCost":round.max_region_cost,"totalRegionCost":round.total_region_cost,"bestMaxRegionCost":self.best_solved_state_summary.as_ref().map(|s|s.max_region_cost),"bestTotalRegionCost":self.best_solved_state_summary.as_ref().map(|s|s.total_region_cost),"ripCount":self.state.rip_count,"completedRoundSummaries":self.completed_round_summaries,"firstMaxRegionCost":first.max_region_cost,"firstTotalRegionCost":first.total_region_cost,"firstSegmentCount":first.segment_count,"firstMaxRegionSegmentCount":first.max_region_segment_count,"firstSquaredRegionSegmentCount":first.squared_region_segment_count,"partialRipQualityBaselineRipCount":baseline.rip_count,"partialRipQualityBaselineMaxRegionCost":baseline.max_region_cost,"partialRipQualityBaselineTotalRegionCost":baseline.total_region_cost,"partialRipQualityBaselineSegmentCount":baseline.segment_count,"partialRipQualityBaselineMaxRegionSegmentCount":baseline.max_region_segment_count,"partialRipQualityBaselineSquaredRegionSegmentCount":baseline.squared_region_segment_count,"bestSolvedSegmentCount":self.best_solved_round_summary.as_ref().map(|s|s.segment_count),"bestSolvedMaxRegionSegmentCount":self.best_solved_round_summary.as_ref().map(|s|s.max_region_segment_count),"bestSolvedSquaredRegionSegmentCount":self.best_solved_round_summary.as_ref().map(|s|s.squared_region_segment_count),"partialRipTargetMaxRegionCost":target,"partialRipMaxTargetTotalRegionCost":target_total,"partialRipComplexityAwareSelection":self.use_complexity_aware_selection,"partialRipComplexitySelectionMinRouteCount":self.options.partial_rip_complexity_selection_min_route_count,"partialRipMaxRegionCostGrowthRatio":self.options.partial_rip_max_region_cost_growth_ratio,"partialRipTargetReached":self.partial_rip_target_reached||reached});
        if reached {
            self.partial_rip_target_reached = true;
        }

        self.merge_stats(values);
        self.publish_partial_rip_stats();
        if hot.is_empty() || reached || self.state.rip_count as f64 >= attempts {
            self.restore_best_solved_state();
            self.solved = true;
            return;
        }

        for (region, cost) in costs[..self.topology.region_count].iter().enumerate() {
            let addition = cost * self.options.rip_congestion_region_cost_factor;
            self.state.region_congestion_cost[region] += addition;
        }

        let warmup = (self.state.rip_count as f64)
            < self.options.partial_rip_warmup_full_rip_attempts.max(0.0);
        self.state.rip_count += 1;
        let partial = !warmup && self.prepare_partial_rip(&hot, &costs);
        if !partial {
            self.reset_routing_state_for_rerip();
        }

        let mode = if warmup {
            "warmup_full"
        } else if partial {
            "partial"
        } else {
            "full_fallback"
        };
        let values = json!({"ripCount":self.state.rip_count,"maxRegionCostBeforeRip":round.max_region_cost,"reripRegionCount":hot.len(),"reripMode":mode,"partialRipWarmupFullRipAttempts":self.options.partial_rip_warmup_full_rip_attempts});
        self.merge_stats(values);
        self.log_rip_event("hot_regions",round.max_region_cost,json!({"hotRegionCount":hot.len(),"currentRipThreshold":threshold,"reripMode":mode,"partialRouteCount":if partial{self.partial_rip_route_plans.len()}else{0}}));
    }
}
