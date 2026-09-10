use crate::core::{TinyHyperGraphProblem, TinyHyperGraphSolver};
use crate::types::{PortId, RegionId, RouteId};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TinyHyperGraphInitialAssignment {
    pub route_id: RouteId,
    pub region_id: RegionId,
    pub from_port_id: PortId,
    pub to_port_id: PortId,
}

#[derive(Clone, Debug)]
pub struct InitialAssignmentSummary {
    pub initial_assignment_count: usize,
    pub initially_routed_route_count: usize,
}

fn assert_assignments_connect_route(
    problem: &TinyHyperGraphProblem,
    route_id: RouteId,
    assignments: &[TinyHyperGraphInitialAssignment],
) -> () {
    let start = problem.route_start_port[route_id as usize];
    let end = problem.route_end_port[route_id as usize];
    let mut adjacent: HashMap<PortId, HashSet<PortId>> = HashMap::new();

    for assignment in assignments {
        adjacent
            .entry(assignment.from_port_id)
            .or_default()
            .insert(assignment.to_port_id);
        adjacent
            .entry(assignment.to_port_id)
            .or_default()
            .insert(assignment.from_port_id);
    }

    let mut visited = HashSet::new();
    let mut pending = vec![start];

    while let Some(port) = pending.pop() {
        if !visited.insert(port) {
            continue;
        }

        if let Some(neighbors) = adjacent.get(&port) {
            pending.extend(neighbors);
        }
    }

    assert!(
        visited.contains(&end),
        "Initial assignments for route {route_id} do not connect {start} to {end}"
    );
    assert!(
        !assignments
            .iter()
            .any(|a| !visited.contains(&a.from_port_id) || !visited.contains(&a.to_port_id)),
        "Initial assignments for route {route_id} contain disconnected segments"
    );
}

pub fn apply_initial_assignments(
    solver: &mut TinyHyperGraphSolver,
) -> Option<InitialAssignmentSummary> {
    let assignments = solver
        .problem
        .initial_assignments
        .clone()
        .unwrap_or_default();
    if assignments.is_empty() {
        return None;
    }

    let mut by_route: HashMap<RouteId, Vec<TinyHyperGraphInitialAssignment>> = HashMap::new();
    let mut route_order = Vec::new();

    for assignment in &assignments {
        let TinyHyperGraphInitialAssignment {
            route_id,
            region_id,
            from_port_id,
            to_port_id,
        } = *assignment;
        assert!(
            route_id >= 0 && (route_id as usize) < solver.problem.route_count,
            "Initial assignment references invalid route {route_id}"
        );
        assert!(
            region_id >= 0 && (region_id as usize) < solver.topology.region_count,
            "Initial assignment references invalid region {region_id}"
        );

        for port_id in [from_port_id, to_port_id] {
            assert!(
                port_id >= 0 && (port_id as usize) < solver.topology.port_count,
                "Initial assignment references invalid port {port_id}"
            );
            assert!(
                solver.topology.incident_port_region[port_id as usize].contains(&region_id),
                "Initial assignment port {port_id} is not incident to region {region_id}"
            );
        }

        if !by_route.contains_key(&route_id) {
            route_order.push(route_id);
        }

        by_route
            .entry(route_id)
            .or_default()
            .push(assignment.clone());
    }

    for route_id in &route_order {
        assert_assignments_connect_route(&solver.problem, *route_id, &by_route[route_id]);
    }

    for assignment in &assignments {
        let TinyHyperGraphInitialAssignment {
            route_id,
            region_id,
            from_port_id,
            to_port_id,
        } = *assignment;
        let net = solver.problem.route_net[route_id as usize];

        for port in [from_port_id, to_port_id] {
            let assigned = solver.state.port_assignment[port as usize];
            assert!(
                assigned == -1 || assigned == net,
                "Initial assignment port {port} is assigned to multiple nets"
            );
            solver.state.port_assignment[port as usize] = net;
        }

        solver.state.current_route_net_id = Some(net);
        solver.state.region_segments[region_id as usize].push((route_id, from_port_id, to_port_id));
        solver.append_segment_to_region_cache(region_id, from_port_id, to_port_id);
    }

    solver.state.current_route_net_id = None;
    solver
        .state
        .unrouted_routes
        .retain(|route_id| !by_route.contains_key(route_id));

    for route_id in &route_order {
        solver.route_success_count_by_route_id[*route_id as usize] = 1;
    }

    Some(InitialAssignmentSummary {
        initial_assignment_count: assignments.len(),
        initially_routed_route_count: route_order.len(),
    })
}
