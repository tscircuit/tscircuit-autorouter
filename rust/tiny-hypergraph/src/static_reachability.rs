use crate::core::{
    TinyHyperGraphProblem, TinyHyperGraphProblemSetup, TinyHyperGraphSolver, TinyHyperGraphTopology,
};
use crate::types::{NetId, PortId, RegionId, RouteId};
use serde_json::Value;
use std::collections::HashSet;

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticallyUnroutableRouteSummary {
    pub route_id: RouteId,
    pub connection_id: String,
    pub start_port_id: PortId,
    pub end_port_id: PortId,
    pub start_region_id: Option<String>,
    pub end_region_id: Option<String>,
    pub point_ids: Vec<String>,
}

pub struct StaticReachabilityContext<'a> {
    pub topology: &'a TinyHyperGraphTopology,
    pub problem: &'a TinyHyperGraphProblem,
    pub problem_setup: &'a TinyHyperGraphProblemSetup,
    pub port_assignment: &'a [i32],
    pub route_ids: &'a [RouteId],
    pub max_precheck_hops: f64,
    pub get_starting_next_region_id: &'a dyn Fn(RouteId, PortId) -> Option<RegionId>,
    pub get_route_summary: &'a dyn Fn(RouteId) -> StaticallyUnroutableRouteSummary,
}

fn get_route_metadata_from_problem(
    problem: &TinyHyperGraphProblem,
    route_id: RouteId,
) -> Option<&Value> {
    problem
        .route_metadata
        .as_ref()
        .and_then(|metadata| metadata.get(route_id as usize))
}

fn get_route_point_ids(metadata: Option<&Value>) -> Vec<String> {
    metadata
        .and_then(|m| m.get("simpleRouteConnection"))
        .and_then(|c| c.get("pointsToConnect"))
        .and_then(Value::as_array)
        .map(|points| {
            points
                .iter()
                .filter_map(|p| p.get("pointId").and_then(Value::as_str).map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

fn get_default_route_connection_id(problem: &TinyHyperGraphProblem, route_id: RouteId) -> String {
    get_route_metadata_from_problem(problem, route_id)
        .and_then(|m| m.get("connectionId"))
        .and_then(Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| format!("route-{route_id}"))
}

fn is_port_endpoint_reserved_for_static_reachability(
    setup: &TinyHyperGraphProblemSetup,
    net: NetId,
    port: PortId,
) -> bool {
    let Some(reservations) = setup.port_endpoint_net_ids.get(port as usize) else {
        return false;
    };

    for reserved_net_id in reservations {
        if *reserved_net_id != net {
            return true;
        }
    }

    false
}

fn is_region_blocked_for_static_reachability(
    problem: &TinyHyperGraphProblem,
    net: NetId,
    region: RegionId,
) -> bool {
    let reserved = problem.region_net_id[region as usize];
    reserved != -1 && reserved != net
}

fn has_static_reachability_path(
    context: &StaticReachabilityContext<'_>,
    route_id: RouteId,
) -> bool {
    let topology = context.topology;
    let problem = context.problem;
    let net = problem.route_net[route_id as usize];
    let start = problem.route_start_port[route_id as usize];
    let goal = problem.route_end_port[route_id as usize];
    if start == goal {
        return true;
    }

    let Some(start_region) = (context.get_starting_next_region_id)(route_id, start) else {
        return false;
    };
    let mut queue = vec![(start, start_region)];
    let mut seen =
        HashSet::from([start as i64 * topology.region_count as i64 + start_region as i64]);
    let mut queue_index = 0;

    while queue_index < queue.len() {
        let (port, region) = queue[queue_index];
        queue_index += 1;
        if is_region_blocked_for_static_reachability(problem, net, region) {
            continue;
        }

        let Some(neighbors) = topology.region_incident_ports.get(region as usize) else {
            continue;
        };

        for &neighbor in neighbors {
            let assigned = context.port_assignment[neighbor as usize];
            if is_port_endpoint_reserved_for_static_reachability(
                context.problem_setup,
                net,
                neighbor,
            ) {
                continue;
            }

            if neighbor == goal {
                if assigned != -1 && assigned != net {
                    continue;
                }

                return true;
            }

            if neighbor == port {
                continue;
            }

            if assigned != -1 && assigned != net {
                continue;
            }

            if problem.port_section_mask[neighbor as usize] == 0 {
                continue;
            }

            let incident = topology.incident_port_region.get(neighbor as usize);
            let next = incident
                .and_then(|regions| {
                    if regions.first() == Some(&region) {
                        regions.get(1)
                    } else {
                        regions.first()
                    }
                })
                .copied();
            let Some(next) = next else {
                continue;
            };
            if is_region_blocked_for_static_reachability(problem, net, next) {
                continue;
            }

            let hop = neighbor as i64 * topology.region_count as i64 + next as i64;
            if seen.contains(&hop) {
                continue;
            }

            if seen.len() as f64 >= context.max_precheck_hops {
                return true;
            }

            seen.insert(hop);
            queue.push((neighbor, next));
        }
    }

    false
}

pub fn create_statically_unroutable_route_summary(
    problem: &TinyHyperGraphProblem,
    route_id: RouteId,
    get_route_metadata: &dyn Fn(RouteId) -> Option<Value>,
    get_route_connection_id: &dyn Fn(RouteId) -> String,
) -> StaticallyUnroutableRouteSummary {
    let override_metadata = get_route_metadata(route_id);
    let metadata = override_metadata
        .as_ref()
        .or_else(|| get_route_metadata_from_problem(problem, route_id));
    StaticallyUnroutableRouteSummary {
        route_id,
        connection_id: get_route_connection_id(route_id),
        start_port_id: problem.route_start_port[route_id as usize],
        end_port_id: problem.route_end_port[route_id as usize],
        start_region_id: metadata
            .and_then(|m| m.get("startRegionId"))
            .and_then(Value::as_str)
            .map(str::to_owned),
        end_region_id: metadata
            .and_then(|m| m.get("endRegionId"))
            .and_then(Value::as_str)
            .map(str::to_owned),
        point_ids: get_route_point_ids(metadata),
    }
}

pub fn get_statically_unroutable_routes(
    context: &StaticReachabilityContext<'_>,
) -> Vec<StaticallyUnroutableRouteSummary> {
    let mut seen = HashSet::new();
    context
        .route_ids
        .iter()
        .copied()
        .filter(|route| seen.insert(*route))
        .filter(|route| !has_static_reachability_path(context, *route))
        .map(context.get_route_summary)
        .collect()
}

pub fn get_statically_unroutable_routes_for_solver(
    solver: &TinyHyperGraphSolver,
) -> Vec<StaticallyUnroutableRouteSummary> {
    let route_ids = &solver.state.unrouted_routes;
    get_statically_unroutable_routes(&StaticReachabilityContext {
        topology: &solver.topology,
        problem: &solver.problem,
        problem_setup: solver
            .problem_setup
            .as_ref()
            .expect("problem setup initialized"),
        port_assignment: &solver.state.port_assignment,
        route_ids: &route_ids,
        max_precheck_hops: solver
            .options
            .static_reachability_precheck_max_hops
            .max(0.0),
        get_starting_next_region_id: &|route, start| {
            solver.get_starting_next_region_id(route, start)
        },
        get_route_summary: &|route| {
            create_statically_unroutable_route_summary(
                &solver.problem,
                route,
                &|r| solver.get_route_metadata(r).cloned(),
                &|r| solver.get_route_connection_id(r),
            )
        },
    })
}

pub fn get_static_reachability_error(routes: &[StaticallyUnroutableRouteSummary]) -> String {
    let labels = routes
        .iter()
        .take(5)
        .map(|route| {
            let point_path = if route.point_ids.len() >= 2 {
                format!("{}->{}", route.point_ids[0], route.point_ids[1])
            } else {
                format!("{}->{}", route.start_port_id, route.end_port_id)
            };
            format!("{} ({point_path})", route.connection_id)
        })
        .collect::<Vec<_>>()
        .join(", ");
    let remaining = if routes.len() > 5 {
        format!("{labels}, +{} more", routes.len() - 5)
    } else {
        labels
    };
    format!(
        "Static reachability precheck failed: {} route(s) have no legal path under the current reservation and start-region rules {remaining}",
        routes.len()
    )
}
