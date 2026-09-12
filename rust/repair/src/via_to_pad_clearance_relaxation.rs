use std::collections::HashSet;
use serde_json::Value;
use crate::types::Routes;
use crate::internal_types::{MutableRoute, Point, ViaNode};
use crate::net_utils::{RepairConnectivityMap, obstacle_shares_net};
use crate::solver_helpers::{RepairMath, collect_via_nodes, get_obstacle_z_layers, RepairObstacle, get_rect_repulsion, materialize_routes};

const CLEARANCE_EPSILON: f64 = 1e-6;
const RELAXATION_CLEARANCE_SLACK: f64 = 0.006;
const RELAXATION_ITERATIONS: usize = 160;
const RELAXATION_PASSES: usize = 4;
const MAX_NUDGE_DISTANCE: f64 = 0.5;
const CANDIDATE_SCALES: [f64; 6] = [1.0, 0.5, 0.25, 0.1, 0.05, 0.025];

fn distance(left: Point, right: Point) -> f64 {
    let dx = left.x - right.x;
    let dy = left.y - right.y;
    (dx * dx + dy * dy).sqrt()
}

fn limit_vector(vector: Point, maximum: f64) -> Point {
    let magnitude = distance(Point { x: 0.0, y: 0.0 }, vector);
    if magnitude <= maximum || magnitude < CLEARANCE_EPSILON { return vector; }
    let scale = maximum / magnitude;
    Point { x: vector.x * scale, y: vector.y * scale }
}

fn get_via_pad_blockers<'a>(srj: &'a Value, routes: &[MutableRoute], via: &ViaNode, conn: Option<&RepairConnectivityMap>, math: RepairMath) -> Vec<&'a Value> {
    let Some(route) = routes.get(via.route_index) else { return Vec::new(); };
    let point = Point { x: via.x, y: via.y };
    let mut blockers = Vec::new();
    for obstacle in srj["obstacles"].as_array().expect("Obstacles required") {
        let same_net = obstacle_shares_net(&via.root_connection_name, obstacle, conn) || obstacle_shares_net(&route.connection_name, obstacle, conn);
        if obstacle["isCopperPour"].as_bool() == Some(true) || (same_net && point_obstacle_distance(point, obstacle, math) <= CLEARANCE_EPSILON) { continue; }
        let layers = get_obstacle_z_layers(obstacle, srj["layerCount"].as_u64().expect("Layer count required") as usize);
        if !via.z_layers.iter().any(|z| layers.contains(z)) { continue; }
        blockers.push(obstacle);
    }
    blockers
}

fn get_via_clearance_penalty(srj: &Value, routes: &[MutableRoute], via: &ViaNode, conn: Option<&RepairConnectivityMap>, math: RepairMath) -> f64 {
    let mut penalty = 0.0;
    let point = Point { x: via.x, y: via.y };
    for obstacle in get_via_pad_blockers(srj, routes, via, conn, math) {
        let clearance = point_obstacle_distance(point, obstacle, math) - (via.radius + srj["minViaEdgeToPadEdgeClearance"].as_f64().unwrap() + RELAXATION_CLEARANCE_SLACK);
        if clearance >= 0.0 { continue; }
        penalty += clearance * clearance;
        if point_obstacle_distance(point, obstacle, math) < CLEARANCE_EPSILON {
            let center = Point { x: obstacle["center"]["x"].as_f64().unwrap(), y: obstacle["center"]["y"].as_f64().unwrap() };
            penalty += 0.01 / (distance(point, center) + 0.01);
        }
    }
    penalty
}

fn get_route_via_clearance_penalty(srj: &Value, routes: &[MutableRoute], index: usize, conn: Option<&RepairConnectivityMap>, math: RepairMath) -> f64 {
    collect_via_nodes(routes, srj["minViaDiameter"].as_f64().unwrap_or(0.3)).iter().filter(|via| via.route_index == index)
        .fold(0.0, |penalty, via| penalty + get_via_clearance_penalty(srj, routes, via, conn, math))
}

fn compute_via_nudge_forces(srj: &Value, routes: &[MutableRoute], index: usize, conn: Option<&RepairConnectivityMap>, math: RepairMath) -> Vec<Point> {
    let Some(route) = routes.get(index) else { return Vec::new(); };
    let mut forces = vec![Point { x: 0.0, y: 0.0 }; route.route.len()];
    let vias = collect_via_nodes(routes, srj["minViaDiameter"].as_f64().unwrap_or(0.3));
    for via in vias.iter().filter(|via| via.route_index == index) {
        if !via.movable { continue; }
        for obstacle in get_via_pad_blockers(srj, routes, via, conn, math) {
            let required = via.radius + srj["minViaEdgeToPadEdgeClearance"].as_f64().unwrap() + RELAXATION_CLEARANCE_SLACK;
            let Some((direction, penetration)) = rect_repulsion(Point { x: via.x, y: via.y }, obstacle, required, math) else { continue; };
            for &point_index in &via.point_indexes {
                forces[point_index].x += direction.x * penetration;
                forces[point_index].y += direction.y * penetration;
            }
        }
    }
    forces
}

fn apply_nudge_forces(srj: &Value, route: &MutableRoute, forces: &[Point], scale: f64) -> MutableRoute {
    let indices: HashSet<_> = collect_via_nodes(std::slice::from_ref(route), srj["minViaDiameter"].as_f64().unwrap_or(0.3)).into_iter()
        .filter(|via| via.movable).flat_map(|via| via.point_indexes).collect();
    let result = route.clone();
    for (index, point) in result.route.iter().enumerate() {
        if !indices.contains(&index) { continue; }
        let force = limit_vector(forces.get(index).copied().unwrap_or(Point { x: 0.0, y: 0.0 }), MAX_NUDGE_DISTANCE);
        let mut point = point.borrow_mut();
        point.x += force.x * scale;
        point.y += force.y * scale;
    }
    result
}

fn route_stays_inside_bounds(srj: &Value, route: &MutableRoute) -> bool {
    let bounds = &srj["bounds"];
    route.route.iter().all(|point| {
        let point = point.borrow();
        point.x >= bounds["minX"].as_f64().unwrap() - CLEARANCE_EPSILON && point.x <= bounds["maxX"].as_f64().unwrap() + CLEARANCE_EPSILON
            && point.y >= bounds["minY"].as_f64().unwrap() - CLEARANCE_EPSILON && point.y <= bounds["maxY"].as_f64().unwrap() + CLEARANCE_EPSILON
    })
}

fn nudge_route_vias(srj: &Value, routes: &mut [MutableRoute], index: usize, conn: Option<&RepairConnectivityMap>, math: RepairMath) -> bool {
    let mut penalty = get_route_via_clearance_penalty(srj, routes, index, conn, math);
    let mut changed = false;
    for _ in 0..RELAXATION_ITERATIONS {
        if penalty <= CLEARANCE_EPSILON { break; }
        let forces = compute_via_nudge_forces(srj, routes, index, conn, math);
        if forces.iter().all(|force| distance(*force, Point { x: 0.0, y: 0.0 }) < 1e-9) { break; }
        let mut accepted = None;
        let mut accepted_penalty = penalty;
        for scale in CANDIDATE_SCALES {
            let candidate = apply_nudge_forces(srj, &routes[index], &forces, scale);
            let original = std::mem::replace(&mut routes[index], candidate);
            let candidate_penalty = get_route_via_clearance_penalty(srj, routes, index, conn, math);
            let candidate = std::mem::replace(&mut routes[index], original);
            if candidate_penalty < penalty - 1e-6 && route_stays_inside_bounds(srj, &candidate) {
                accepted = Some(candidate); accepted_penalty = candidate_penalty; break;
            }
        }
        let Some(candidate) = accepted else { break; };
        routes[index] = candidate; penalty = accepted_penalty; changed = true;
    }
    changed
}

pub fn apply_via_to_pad_clearance_relaxation(srj: &Value, routes: &Routes, conn: Option<&RepairConnectivityMap>, math: RepairMath) -> Routes {
    if srj.get("minViaEdgeToPadEdgeClearance").is_none_or(Value::is_null) || srj["minViaEdgeToPadEdgeClearance"].as_f64().is_some_and(|n| n <= 0.0) { return routes.clone(); }
    let mut changed = false;
    let mut relaxed = (**routes).clone();
    for _ in 0..RELAXATION_PASSES {
        for index in 0..relaxed.len() { changed = nudge_route_vias(srj, &mut relaxed, index, conn, math) || changed; }
    }
    if changed { materialize_routes(&mut relaxed); Routes::new(relaxed) } else { routes.clone() }
}

fn point_obstacle_distance(point: Point, obstacle: &Value, math: RepairMath) -> f64 {
    let half_width = obstacle["width"].as_f64().unwrap() / 2.0;
    let half_height = obstacle["height"].as_f64().unwrap() / 2.0;
    let dx = ((point.x - obstacle["center"]["x"].as_f64().unwrap()).abs() - half_width).max(0.0);
    let dy = ((point.y - obstacle["center"]["y"].as_f64().unwrap()).abs() - half_height).max(0.0);
    (math.hypot)(dx, dy)
}

fn rect_repulsion(point: Point, obstacle: &Value, required: f64, math: RepairMath) -> Option<(Point, f64)> {
    let obstacle = RepairObstacle {
        center: Point { x: obstacle["center"]["x"].as_f64().unwrap(), y: obstacle["center"]["y"].as_f64().unwrap() },
        width: obstacle["width"].as_f64().unwrap(), height: obstacle["height"].as_f64().unwrap(),
        is_copper_pour: false, z_layers: Vec::new(), connected_to: Vec::new(), connected_to_net_ids: Vec::new(), interned_connected_to: Vec::new(),
    };
    get_rect_repulsion(point, &obstacle, required, math).map(|repulsion| (repulsion.direction, repulsion.penetration))
}
