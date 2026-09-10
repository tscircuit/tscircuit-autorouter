use crate::{
    core::*, find_distinct_owner_blocker_path::*,
    outside_in_partial_rip_tiny_hypergraph_solver::OutsideInPartialRipTinyHyperGraphSolver,
    types::*,
};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    hash::Hash,
    ops::{Deref, DerefMut},
};

#[derive(Clone, Debug)]
pub struct RelaxedSearchState {
    pub port_id: PortId,
    pub next_region_id: RegionId,
}

#[derive(Clone, Debug)]
pub enum SelectiveReripBlockerResource {
    Port {
        port_id: PortId,
        owners: Vec<RouteId>,
    },
    SameLayerIntersection {
        region_id: RegionId,
        from_port_id: PortId,
        to_port_id: PortId,
        owners: Vec<RouteId>,
    },
}

#[derive(Clone, Debug)]
pub struct RelaxedSearchHopData {
    pub resources: Vec<SelectiveReripBlockerResource>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FailedOwnerPairCount {
    pub failed_route_id: RouteId,
    pub owner_route_id: RouteId,
    pub count: usize,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectiveReripTinyHyperGraphStats {
    pub selective_rip_count: usize,
    pub selectively_ripped_route_count: usize,
    pub global_rerip_count: usize,
    pub global_rerip_reason: Option<String>,
    pub alternate_blocker_search_count: usize,
    pub alternate_owner_count: usize,
    pub failed_owner_pair_count: usize,
    pub max_failed_owner_pair_count: usize,
    pub failed_owner_pairs: Vec<FailedOwnerPairCount>,
    pub last_failed_route_id: Option<RouteId>,
    pub last_direct_owner_route_ids: Vec<RouteId>,
    pub last_repeated_owner_route_ids: Vec<RouteId>,
    pub last_alternate_owner_route_ids: Vec<RouteId>,
    pub last_ripped_route_ids: Vec<RouteId>,
    pub last_relaxed_search_expanded_label_count: usize,
    pub last_alternate_search_expanded_label_count: usize,
}

pub fn order_connections_by_net_cardinality<T: Clone, K: Eq + Hash>(
    connections: &[T],
    get_net_id: impl Fn(&T) -> K,
) -> Vec<T> {
    let mut counts = HashMap::new();

    for c in connections {
        *counts.entry(get_net_id(c)).or_insert(0usize) += 1;
    }

    let mut indexed: Vec<_> = connections.iter().enumerate().collect();
    indexed.sort_by(|(i, a), (j, b)| {
        counts[&get_net_id(b)]
            .cmp(&counts[&get_net_id(a)])
            .then(i.cmp(j))
    });
    indexed.into_iter().map(|(_, c)| c.clone()).collect()
}

pub fn select_owner_route_ids_to_rip(
    failed: RouteId,
    direct: &[RouteId],
    alternate: Option<&[RouteId]>,
) -> HashSet<RouteId> {
    let mut ripped: HashSet<_> = alternate.unwrap_or(direct).iter().copied().collect();
    ripped.remove(&failed);
    assert!(
        !ripped.is_empty(),
        "SelectiveReripTinyHyperGraphSolver: route {failed} has blocker resources but no distinct committed owner can be reripped"
    );
    ripped
}

pub fn order_routes_after_selective_rerip(
    failed: RouteId,
    pending: &[RouteId],
    ripped: &HashSet<RouteId>,
) -> Vec<RouteId> {
    let mut result = vec![failed];
    result.extend(
        pending
            .iter()
            .copied()
            .filter(|r| *r != failed && !ripped.contains(r)),
    );
    let mut ripped: Vec<_> = ripped.iter().copied().filter(|r| *r != failed).collect();
    ripped.sort();
    result.extend(ripped);
    result
}

pub struct SelectiveReripTinyHyperGraphSolver {
    pub outside_in: OutsideInPartialRipTinyHyperGraphSolver,
    pub failed_owner_pair_counts: HashMap<RouteId, HashMap<RouteId, usize>>,
    pub selective_rerip_stats: SelectiveReripTinyHyperGraphStats,
    pub selective_rerip_congestion_update_count: usize,
}

impl Deref for SelectiveReripTinyHyperGraphSolver {
    type Target = OutsideInPartialRipTinyHyperGraphSolver;

    fn deref(&self) -> &Self::Target {
        &self.outside_in
    }
}

impl DerefMut for SelectiveReripTinyHyperGraphSolver {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.outside_in
    }
}
type SearchResult =
    DistinctOwnerBlockerSearchResult<RelaxedSearchState, RouteId, RelaxedSearchHopData>;

impl SelectiveReripTinyHyperGraphSolver {
    pub fn new(
        topology: TinyHyperGraphTopology,
        problem: TinyHyperGraphProblem,
        options: Option<TinyHyperGraphSolverOptions>,
    ) -> Self {
        let mut outside_in =
            OutsideInPartialRipTinyHyperGraphSolver::new(topology, problem, options);
        outside_in.defer_out_of_candidates = true;
        Self {
            outside_in,
            failed_owner_pair_counts: HashMap::new(),
            selective_rerip_stats: Default::default(),
            selective_rerip_congestion_update_count: 0,
        }
    }

    pub fn get_selective_rerip_stats(&self) -> SelectiveReripTinyHyperGraphStats {
        self.selective_rerip_stats.clone()
    }

    pub fn step(&mut self) -> () {
        self.outside_in.step();
        if self.outside_in.pending_out_of_candidates {
            self.outside_in.pending_out_of_candidates = false;
            self.on_out_of_candidates();
        }
    }

    pub fn solve(&mut self) -> () {
        if !self.is_setup {
            self.outside_in.distance_aware.setup();
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

    pub fn global_rerip(&mut self) -> () {
        self.outside_in.defer_out_of_candidates = false;
        self.outside_in.on_out_of_candidates();
        self.outside_in.defer_out_of_candidates = true;
        self.publish_selective_rerip_stats();
    }

    pub fn on_out_of_candidates(&mut self) -> () {
        let failed=self.state.current_route_id.expect("SelectiveReripTinyHyperGraphSolver: candidate search exhausted without a current route");
        let direct = self.find_relaxed_blocker_path(&HashSet::new());
        let direct = match direct {
            SearchResult::Failure(f) => {
                let stats = &mut self.selective_rerip_stats;
                stats.global_rerip_count += 1;
                stats.global_rerip_reason = Some(
                    match f.reason {
                        DistinctOwnerBlockerSearchFailureReason::NoPath => "no_path",
                        DistinctOwnerBlockerSearchFailureReason::ExpansionLimit => {
                            "expansion_limit"
                        }
                    }
                    .into(),
                );
                stats.last_failed_route_id = Some(failed);
                stats.last_direct_owner_route_ids.clear();
                stats.last_repeated_owner_route_ids.clear();
                stats.last_alternate_owner_route_ids.clear();
                stats.last_ripped_route_ids.clear();
                stats.last_relaxed_search_expanded_label_count = f.expanded_label_count;
                stats.last_alternate_search_expanded_label_count = 0;
                self.global_rerip();
                return;
            }

            SearchResult::Success(s) if s.owners.is_empty() => {
                let stats = &mut self.selective_rerip_stats;
                stats.global_rerip_count += 1;
                stats.global_rerip_reason = Some("no_blocker_path".into());
                stats.last_failed_route_id = Some(failed);
                stats.last_direct_owner_route_ids.clear();
                stats.last_repeated_owner_route_ids.clear();
                stats.last_alternate_owner_route_ids.clear();
                stats.last_ripped_route_ids.clear();
                stats.last_relaxed_search_expanded_label_count = s.expanded_label_count;
                stats.last_alternate_search_expanded_label_count = 0;
                self.global_rerip();
                return;
            }

            SearchResult::Success(s) => s,
        };
        let mut direct_ids: Vec<_> = direct.owners.iter().copied().collect();
        direct_ids.sort();
        let mut repeated = vec![];

        for &owner in &direct_ids {
            if self.increment_failed_owner_pair(failed, owner) >= 2 {
                repeated.push(owner);
            }
        }

        let alternate = if !repeated.is_empty() {
            self.selective_rerip_stats.alternate_blocker_search_count += 1;
            match self.find_relaxed_blocker_path(&repeated.iter().copied().collect()) {
                SearchResult::Failure(f) => {
                    let stats = &mut self.selective_rerip_stats;
                    stats.global_rerip_count += 1;
                    stats.global_rerip_reason = Some(
                        match f.reason {
                            DistinctOwnerBlockerSearchFailureReason::NoPath => "no_path",
                            DistinctOwnerBlockerSearchFailureReason::ExpansionLimit => {
                                "expansion_limit"
                            }
                        }
                        .into(),
                    );
                    stats.last_failed_route_id = Some(failed);
                    stats.last_direct_owner_route_ids = direct_ids;
                    stats.last_repeated_owner_route_ids = repeated;
                    stats.last_alternate_owner_route_ids.clear();
                    stats.last_ripped_route_ids.clear();
                    stats.last_relaxed_search_expanded_label_count = direct.expanded_label_count;
                    stats.last_alternate_search_expanded_label_count = f.expanded_label_count;
                    self.global_rerip();
                    return;
                }

                SearchResult::Success(s) => Some(s),
            }
        } else {
            None
        };
        let alternate_ids = alternate.as_ref().map(|s| {
            let mut ids: Vec<_> = s.owners.iter().copied().collect();
            ids.sort();
            ids
        });
        let ripped = select_owner_route_ids_to_rip(failed, &direct_ids, alternate_ids.as_deref());
        self.clear_partial_rip_plans(&ripped);
        let alternate_only: Vec<_> = alternate_ids
            .as_ref()
            .into_iter()
            .flatten()
            .copied()
            .filter(|r| !direct.owners.contains(r))
            .collect();
        if self.selective_rerip_congestion_update_count < 1 {
            self.add_congestion_cost_for_selective_rerip();
            self.selective_rerip_congestion_update_count += 1;
        }

        self.rebuild_committed_state(&ripped);
        self.state.rip_count += 1;
        self.state.current_route_id = None;
        self.state.current_route_net_id = None;
        self.state.unrouted_routes =
            order_routes_after_selective_rerip(failed, &self.state.unrouted_routes, &ripped);
        self.state.candidate_queue.clear();
        self.reset_candidate_best_costs();
        self.state.goal_port_id = -1;
        let stats = &mut self.selective_rerip_stats;
        stats.selective_rip_count += 1;
        stats.selectively_ripped_route_count += ripped.len();
        stats.alternate_owner_count += alternate_only.len();
        stats.last_failed_route_id = Some(failed);
        stats.last_direct_owner_route_ids = direct_ids;
        stats.last_repeated_owner_route_ids = repeated;
        stats.last_alternate_owner_route_ids = alternate_only;
        stats.last_ripped_route_ids = ripped.iter().copied().collect();
        stats.last_ripped_route_ids.sort();
        stats.last_relaxed_search_expanded_label_count = direct.expanded_label_count;
        stats.last_alternate_search_expanded_label_count =
            alternate.map(|s| s.expanded_label_count).unwrap_or(0);
        self.publish_selective_rerip_stats();
    }

    pub fn add_congestion_cost_for_selective_rerip(&mut self) -> () {
        for region in 0..self.topology.region_count {
            let cost = self.state.region_intersection_caches[region].existing_region_cost
                * self.options.rip_congestion_region_cost_factor;
            self.state.region_congestion_cost[region] += cost;
        }
    }

    pub fn find_relaxed_blocker_path(&self, forbidden: &HashSet<RouteId>) -> SearchResult {
        let route = self.state.current_route_id.expect(
            "SelectiveReripTinyHyperGraphSolver: blocker search requires a current route and net",
        );
        let net = self.state.current_route_net_id.expect(
            "SelectiveReripTinyHyperGraphSolver: blocker search requires a current route and net",
        );
        let start = self.get_route_start_port_id(route);
        let goal = self.get_route_end_port_id(route);
        let region=self.get_starting_next_region_id(route,start).unwrap_or_else(||panic!("SelectiveReripTinyHyperGraphSolver: route {} has no starting region for blocker search",self.describe_route(route)));
        let owners = self.get_port_owners();
        find_distinct_owner_blocker_path(DistinctOwnerBlockerSearchOptions {
            start: RelaxedSearchState {
                port_id: start,
                next_region_id: region,
            },
            get_state_key: &|s: &RelaxedSearchState| self.get_hop_id(s.port_id, s.next_region_id),
            is_goal: &|s: &RelaxedSearchState| s.port_id == goal,
            get_hops: &|s| self.get_relaxed_search_hops(s, goal, net, &owners, forbidden),
            max_expanded_labels: Some(self.get_relaxed_search_expansion_limit()),
        })
    }

    pub fn get_relaxed_search_expansion_limit(&self) -> usize {
        let hops: usize = self
            .topology
            .incident_port_region
            .iter()
            .map(Vec::len)
            .sum();
        let scale = ((self.problem.route_count + 1) as f64)
            .log2()
            .ceil()
            .max(4.0) as usize;
        4096.max(hops * scale * 4)
    }

    pub fn get_relaxed_search_hops(
        &self,
        state: &RelaxedSearchState,
        goal: PortId,
        net: NetId,
        port_owners: &HashMap<PortId, HashSet<RouteId>>,
        forbidden: &HashSet<RouteId>,
    ) -> Vec<DistinctOwnerBlockerHop<RelaxedSearchState, RouteId, RelaxedSearchHopData>> {
        if self.is_region_reserved_for_different_net(state.next_region_id) {
            return vec![];
        }

        let mut hops = vec![];

        for &neighbor in &self.topology.region_incident_ports[state.next_region_id as usize] {
            if neighbor == state.port_id || self.is_port_reserved_for_different_net(neighbor) {
                continue;
            }

            if neighbor != goal && self.problem.port_section_mask[neighbor as usize] == 0 {
                continue;
            }

            let resources = self.get_hop_blocker_resources(
                state.next_region_id,
                state.port_id,
                neighbor,
                net,
                port_owners,
            );
            let mut owners = vec![];

            for resource in &resources {
                let list = match resource {
                    SelectiveReripBlockerResource::Port { owners, .. }
                    | SelectiveReripBlockerResource::SameLayerIntersection { owners, .. } => owners,
                };

                for &owner in list {
                    if !owners.contains(&owner) {
                        owners.push(owner);
                    }
                }
            }

            if owners.iter().any(|r| forbidden.contains(r)) {
                continue;
            }

            let mut next = state.next_region_id;
            if neighbor != goal {
                let incident = &self.topology.incident_port_region[neighbor as usize];
                let region = if incident.first() == Some(&state.next_region_id) {
                    incident.get(1)
                } else {
                    incident.first()
                };
                let Some(&region) = region else {
                    continue;
                };
                next = region;
                if self.is_region_reserved_for_different_net(next) {
                    continue;
                }
            }

            let dx = self.topology.port_x[state.port_id as usize]
                - self.topology.port_x[neighbor as usize];
            let dy = self.topology.port_y[state.port_id as usize]
                - self.topology.port_y[neighbor as usize];
            hops.push(DistinctOwnerBlockerHop {
                state: RelaxedSearchState {
                    port_id: neighbor,
                    next_region_id: next,
                },
                distance: dx.hypot(dy),
                owners: Some(owners),
                data: Some(RelaxedSearchHopData { resources }),
            });
        }

        hops
    }

    pub fn get_hop_blocker_resources(
        &self,
        region: RegionId,
        from: PortId,
        to: PortId,
        net: NetId,
        port_owners: &HashMap<PortId, HashSet<RouteId>>,
    ) -> Vec<SelectiveReripBlockerResource> {
        let mut resources = vec![];
        let assigned = self.state.port_assignment[to as usize];
        if assigned != -1 && assigned != net {
            let mut owners: Vec<_> = port_owners
                .get(&to)
                .into_iter()
                .flatten()
                .copied()
                .filter(|r| self.problem.route_net[*r as usize] != net)
                .collect();
            owners.sort();
            assert!(
                !owners.is_empty(),
                "SelectiveReripTinyHyperGraphSolver: port {to} is assigned to foreign net {assigned} without a committed route owner"
            );
            resources.push(SelectiveReripBlockerResource::Port {
                port_id: to,
                owners,
            });
        }

        let owners = self.get_hard_blocked_crossing_owners(region, from, to);
        if !owners.is_empty() {
            resources.push(SelectiveReripBlockerResource::SameLayerIntersection {
                region_id: region,
                from_port_id: from,
                to_port_id: to,
                owners,
            });
        }

        resources
    }

    pub fn get_port_owners(&self) -> HashMap<PortId, HashSet<RouteId>> {
        let mut owners: HashMap<_, HashSet<_>> = HashMap::new();

        for segments in &self.state.region_segments {
            for &(route, from, to) in segments {
                for port in [from, to] {
                    owners.entry(port).or_default().insert(route);
                }
            }
        }

        owners
    }

    pub fn get_hard_blocked_crossing_owners(
        &self,
        region: RegionId,
        from: PortId,
        to: PortId,
    ) -> Vec<RouteId> {
        if !self.is_known_single_layer_region(region) {
            return vec![];
        }

        let net = self.state.current_route_net_id.expect(
            "SelectiveReripTinyHyperGraphSolver: crossing ownership requires a current route net",
        );
        let mut owners = vec![];

        for &(owner, a, b) in &self.state.region_segments[region as usize] {
            if self.problem.route_net[owner as usize] == net {
                continue;
            }

            if self.segments_cross_on_same_layer(region, from, to, a, b) && !owners.contains(&owner)
            {
                owners.push(owner);
            }
        }

        owners
    }

    pub fn segments_cross_on_same_layer(
        &self,
        region: RegionId,
        a: PortId,
        b: PortId,
        c: PortId,
        d: PortId,
    ) -> bool {
        let first = self.populate_segment_geometry_scratch(region, a, b);
        let second = self.populate_segment_geometry_scratch(region, c, d);
        if first.layer_mask & second.layer_mask == 0 {
            return false;
        }

        if first.lesser_angle == second.lesser_angle
            || first.lesser_angle == second.greater_angle
            || first.greater_angle == second.lesser_angle
            || first.greater_angle == second.greater_angle
        {
            return false;
        }

        (first.lesser_angle < second.lesser_angle && second.lesser_angle < first.greater_angle)
            != (first.lesser_angle < second.greater_angle
                && second.greater_angle < first.greater_angle)
    }

    pub fn rebuild_committed_state(&mut self, ripped: &HashSet<RouteId>) -> () {
        for segments in &mut self.state.region_segments {
            segments.retain(|(r, _, _)| !ripped.contains(r));
        }

        self.state.port_assignment.fill(-1);
        self.state.region_intersection_caches = (0..self.topology.region_count)
            .map(|_| create_empty_region_intersection_cache())
            .collect();

        for region in 0..self.state.region_segments.len() {
            for (route, from, to) in self.state.region_segments[region].clone() {
                let net = self.problem.route_net[route as usize];
                self.state.current_route_net_id = Some(net);

                for port in [from, to] {
                    let assigned = self.state.port_assignment[port as usize];
                    assert!(
                        assigned == -1 || assigned == net,
                        "SelectiveReripTinyHyperGraphSolver: rebuilding committed routes found cross-net ownership at port {port} between net {assigned} and net {net}"
                    );
                    self.state.port_assignment[port as usize] = net;
                }

                self.append_segment_to_region_cache(region as i32, from, to);
            }
        }

        self.state.current_route_net_id = None;
    }

    pub fn increment_failed_owner_pair(&mut self, failed: RouteId, owner: RouteId) -> usize {
        let count = self
            .failed_owner_pair_counts
            .entry(failed)
            .or_default()
            .entry(owner)
            .or_default();
        *count += 1;
        *count
    }

    pub fn publish_selective_rerip_stats(&mut self) -> () {
        let mut pairs = vec![];

        for (&failed, owners) in &self.failed_owner_pair_counts {
            for (&owner, &count) in owners {
                pairs.push(FailedOwnerPairCount {
                    failed_route_id: failed,
                    owner_route_id: owner,
                    count,
                });
            }
        }

        pairs.sort_by_key(|p| (p.failed_route_id, p.owner_route_id));
        self.selective_rerip_stats.failed_owner_pair_count = pairs.len();
        self.selective_rerip_stats.max_failed_owner_pair_count =
            pairs.iter().map(|p| p.count).max().unwrap_or(0);
        self.selective_rerip_stats.failed_owner_pairs = pairs;
        let stats =
            serde_json::to_value(self.get_selective_rerip_stats()).expect("selective stats");
        self.merge_stats(stats);
    }

    pub fn describe_route(&self, route: RouteId) -> String {
        match self
            .problem
            .route_metadata
            .as_ref()
            .and_then(|m| m[route as usize].get("connectionId"))
        {
            Some(id) => format!(
                "{route} ({})",
                id.as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| id.to_string())
            ),
            None => route.to_string(),
        }
    }
}
