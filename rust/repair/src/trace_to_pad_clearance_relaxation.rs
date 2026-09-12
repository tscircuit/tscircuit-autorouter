use serde_json::Value;
use crate::types::Routes;
use crate::internal_types::{MutableRoute, Point, RoutePoint};
use crate::net_utils::{RepairConnectivityMap, get_root_connection_name, obstacle_shares_net, shares_net};
use crate::solver_helpers::RepairMath;
use autorouting_drc::math_utils::{point_to_segment_closest_point, point_to_segment_distance, segment_to_box_min_distance, segment_to_segment_min_distance};

const CLEARANCE_EPSILON: f64 = 1e-6;
const RELAXATION_CLEARANCE_SLACK: f64 = 0.006;
const RELAXATION_ITERATIONS: usize = 160;
const RELAXATION_PASSES: usize = 4;
const MAX_NUDGE_DISTANCE: f64 = 0.5;
const CANDIDATE_SCALES: [f64; 6] = [1.0, 0.5, 0.25, 0.1, 0.05, 0.025];

struct ClearanceBlocker<'a> {
    obstacle: Option<&'a Value>,
    center: Point,
    diameter: f64,
    z_layers: Vec<f64>,
}

fn point(value: &Value) -> Point {
    Point { x: value["x"].as_f64().expect("Point x required"), y: value["y"].as_f64().expect("Point y required") }
}

fn distance(a: Point, b: Point) -> f64 {
    let dx = a.x - b.x;
    let dy = a.y - b.y;
    (dx * dx + dy * dy).sqrt()
}

fn get_trace_half_width(srj: &Value, route: &MutableRoute) -> f64 {
    route.trace_thickness.unwrap_or_else(|| srj["minTraceWidth"].as_f64().unwrap()) / 2.0
}

fn get_trace_clearance(srj: &Value) -> f64 {
    srj["minTraceToPadEdgeClearance"].as_f64().unwrap_or(0.1)
}

fn get_route_via_diameter(srj: &Value, route: &MutableRoute) -> f64 {
    route.via_diameter.unwrap_or_else(|| srj["minViaDiameter"].as_f64().unwrap_or(0.3))
}

fn get_route_via_centers(route: &MutableRoute) -> Vec<Point> {
    let mut centers = Vec::new();
    let add = |center: Point, centers: &mut Vec<Point>| {
        if !centers.iter().any(|p| distance(*p, center) < CLEARANCE_EPSILON) { centers.push(center); }
    };
    for via in &route.vias { add(point(via), &mut centers); }
    for pair in route.route.windows(2) {
        let start = pair[0].borrow(); let end = pair[1].borrow();
        if start.z == end.z || distance(start.point(), end.point()) >= CLEARANCE_EPSILON { continue; }
        add(start.point(), &mut centers);
    }
    centers
}

fn normalize_vector(vector: Point) -> Point {
    let magnitude = distance(Point { x: 0.0, y: 0.0 }, vector);
    if magnitude < CLEARANCE_EPSILON { return Point { x: 0.0, y: 0.0 }; }
    Point { x: vector.x / magnitude, y: vector.y / magnitude }
}

fn limit_vector(vector: Point, maximum: f64) -> Point {
    let magnitude = distance(Point { x: 0.0, y: 0.0 }, vector);
    if magnitude <= maximum || magnitude < CLEARANCE_EPSILON { return vector; }
    let scale = maximum / magnitude;
    Point { x: vector.x * scale, y: vector.y * scale }
}

fn get_obstacle_z_layers(obstacle: &Value, count: usize) -> Vec<f64> {
    if let Some(layers) = obstacle["zLayers"].as_array().filter(|layers| !layers.is_empty()) {
        return layers.iter().map(|z| z.as_f64().unwrap()).collect();
    }
    let layers = obstacle["layers"].as_array().expect("Obstacle layers required");
    let result: Vec<_> = (0..count).filter(|z| {
        let name = if *z == 0 { "top".to_owned() } else if *z == count - 1 { "bottom".to_owned() } else { format!("inner{z}") };
        layers.iter().any(|layer| layer.as_str() == Some(name.as_str()))
    }).map(|z| z as f64).collect();
    if result.is_empty() { (0..count).map(|z| z as f64).collect() } else { result }
}

fn routes_are_connected(left: &MutableRoute, right: &MutableRoute, conn: Option<&RepairConnectivityMap>) -> bool {
    shares_net(get_root_connection_name(left), Some(get_root_connection_name(right)), conn)
        || shares_net(get_root_connection_name(left), Some(&right.connection_name), conn)
        || shares_net(&left.connection_name, Some(get_root_connection_name(right)), conn)
        || shares_net(&left.connection_name, Some(&right.connection_name), conn)
}

fn is_same_net_obstacle(route: &MutableRoute, obstacle: &Value, conn: Option<&RepairConnectivityMap>) -> bool {
    obstacle_shares_net(get_root_connection_name(route), obstacle, conn) || obstacle_shares_net(&route.connection_name, obstacle, conn)
}

fn endpoint_can_slide_within_same_net_copper(srj: &Value, route: &MutableRoute, point: &RoutePoint, conn: Option<&RepairConnectivityMap>) -> bool {
    if point.metadata["pcb_port_id"].as_str().is_some_and(|id| !id.is_empty()) { return false; }
    srj["obstacles"].as_array().unwrap().iter().any(|obstacle| {
        let center = self::point(&obstacle["center"]);
        let half_width = obstacle["width"].as_f64().unwrap() / 2.0;
        let half_height = obstacle["height"].as_f64().unwrap() / 2.0;
        is_same_net_obstacle(route, obstacle, conn) && get_obstacle_z_layers(obstacle, srj["layerCount"].as_u64().unwrap() as usize).contains(&point.z)
            && point.x >= center.x - half_width - CLEARANCE_EPSILON && point.x <= center.x + half_width + CLEARANCE_EPSILON
            && point.y >= center.y - half_height - CLEARANCE_EPSILON && point.y <= center.y + half_height + CLEARANCE_EPSILON
    })
}

fn get_clearance_blockers_for_route<'a>(srj: &'a Value, routes: &[MutableRoute], index: usize, conn: Option<&RepairConnectivityMap>) -> Vec<ClearanceBlocker<'a>> {
    let route = &routes[index];
    let mut blockers = Vec::new();
    let count = srj["layerCount"].as_u64().unwrap() as usize;
    for obstacle in srj["obstacles"].as_array().unwrap() {
        if obstacle["isCopperPour"].as_bool() == Some(true) || is_same_net_obstacle(route, obstacle, conn) { continue; }
        blockers.push(ClearanceBlocker { obstacle: Some(obstacle), center: point(&obstacle["center"]), diameter: 0.0, z_layers: get_obstacle_z_layers(obstacle, count) });
    }
    for (other_index, other) in routes.iter().enumerate() {
        if other_index == index || routes_are_connected(route, other, conn) { continue; }
        for center in get_route_via_centers(other) {
            blockers.push(ClearanceBlocker { obstacle: None, center, diameter: get_route_via_diameter(srj, other), z_layers: (0..count).map(|z| z as f64).collect() });
        }
    }
    blockers
}

fn signed_clearance(srj: &Value, route: &MutableRoute, start: &RoutePoint, end: &RoutePoint, blocker: &ClearanceBlocker) -> f64 {
    if !blocker.z_layers.contains(&start.z) { return f64::INFINITY; }
    let half_width = get_trace_half_width(srj, route);
    if let Some(obstacle) = blocker.obstacle {
        segment_to_box_min_distance(&start.point(), &end.point(), &blocker.center, obstacle["width"].as_f64().unwrap(), obstacle["height"].as_f64().unwrap())
            - (get_trace_clearance(srj) + half_width + RELAXATION_CLEARANCE_SLACK)
    } else {
        point_to_segment_distance(&blocker.center, &start.point(), &end.point())
            - (get_trace_clearance(srj) + half_width + blocker.diameter / 2.0 + RELAXATION_CLEARANCE_SLACK)
    }
}

fn push_direction(start: Point, end: Point, blocker: &ClearanceBlocker) -> Point {
    let closest = point_to_segment_closest_point(&blocker.center, &start, &end);
    let mut direction = normalize_vector(Point { x: closest.x - blocker.center.x, y: closest.y - blocker.center.y });
    if direction.x.abs() < CLEARANCE_EPSILON && direction.y.abs() < CLEARANCE_EPSILON {
        let dx = end.x - start.x; let dy = end.y - start.y;
        let midpoint = Point { x: (start.x + end.x) / 2.0, y: (start.y + end.y) / 2.0 };
        let normal = normalize_vector(Point { x: -dy, y: dx });
        let opposite = Point { x: -normal.x, y: -normal.y };
        direction = if distance(Point { x: midpoint.x + normal.x, y: midpoint.y + normal.y }, blocker.center)
            >= distance(Point { x: midpoint.x + opposite.x, y: midpoint.y + opposite.y }, blocker.center) { normal } else { opposite };
    }
    direction
}

fn is_fixed_route_point(srj: &Value, route: &MutableRoute, index: usize, conn: Option<&RepairConnectivityMap>) -> bool {
    if index == 0 || index >= route.route.len().saturating_sub(1) {
        return route.route.get(index).is_none_or(|point| !endpoint_can_slide_within_same_net_copper(srj, route, &point.borrow(), conn));
    }
    let point = route.route[index].borrow();
    if point.metadata["insideJumperPad"].as_bool() == Some(true) { return true; }
    if route.route[index - 1].borrow().z != point.z || route.route[index + 1].borrow().z != point.z { return true; }
    route.vias.iter().any(|via| distance(self::point(via), point.point()) < CLEARANCE_EPSILON)
}

fn route_clearance_penalty(srj: &Value, route: &MutableRoute, blockers: &[ClearanceBlocker]) -> f64 {
    let mut penalty = 0.0;
    for pair in route.route.windows(2) {
        let start = pair[0].borrow(); let end = pair[1].borrow();
        if start.z != end.z || distance(start.point(), end.point()) < CLEARANCE_EPSILON { continue; }
        for blocker in blockers {
            let signed = signed_clearance(srj, route, &start, &end, blocker);
            if signed >= 0.0 { continue; }
            penalty += signed * signed;
            if let Some(obstacle) = blocker.obstacle {
                let pad_distance = segment_to_box_min_distance(&start.point(), &end.point(), &blocker.center, obstacle["width"].as_f64().unwrap(), obstacle["height"].as_f64().unwrap());
                if pad_distance < CLEARANCE_EPSILON { penalty += 0.01 / (point_to_segment_distance(&blocker.center, &start.point(), &end.point()) + 0.01); }
            }
        }
    }
    penalty
}

fn other_trace_penalty(srj: &Value, route: &MutableRoute, others: &[&MutableRoute], conn: Option<&RepairConnectivityMap>) -> f64 {
    let mut penalty = 0.0;
    for pair in route.route.windows(2) {
        let start = pair[0].borrow(); let end = pair[1].borrow();
        if start.z != end.z || distance(start.point(), end.point()) < CLEARANCE_EPSILON { continue; }
        for other in others {
            if routes_are_connected(route, other, conn) { continue; }
            for other_pair in other.route.windows(2) {
                let a = other_pair[0].borrow(); let b = other_pair[1].borrow();
                if a.z != start.z || b.z != start.z || distance(a.point(), b.point()) < CLEARANCE_EPSILON { continue; }
                let clearance = segment_to_segment_min_distance(&start.point(), &end.point(), &a.point(), &b.point()) - get_trace_half_width(srj, route) - get_trace_half_width(srj, other);
                let violation = get_trace_clearance(srj) + RELAXATION_CLEARANCE_SLACK - clearance;
                if violation > 0.0 { penalty += violation * violation; }
            }
            for via in get_route_via_centers(other) {
                let clearance = point_to_segment_distance(&via, &start.point(), &end.point()) - get_trace_half_width(srj, route) - get_route_via_diameter(srj, other) / 2.0;
                let violation = get_trace_clearance(srj) + RELAXATION_CLEARANCE_SLACK - clearance;
                if violation > 0.0 { penalty += violation * violation; }
            }
        }
    }
    penalty
}

fn compute_nudge_forces(srj: &Value, route: &MutableRoute, blockers: &[ClearanceBlocker], others: &[&MutableRoute], conn: Option<&RepairConnectivityMap>) -> Vec<Point> {
    let mut forces = vec![Point { x: 0.0, y: 0.0 }; route.route.len()];
    for index in 0..route.route.len().saturating_sub(1) {
        let start = route.route[index].borrow(); let end = route.route[index + 1].borrow();
        if start.z != end.z || distance(start.point(), end.point()) < CLEARANCE_EPSILON { continue; }
        for blocker in blockers {
            let signed = signed_clearance(srj, route, &start, &end, blocker);
            if signed >= 0.0 { continue; }
            let direction = push_direction(start.point(), end.point(), blocker);
            if direction.x.abs() < CLEARANCE_EPSILON && direction.y.abs() < CLEARANCE_EPSILON { continue; }
            let start_movable = !is_fixed_route_point(srj, route, index, conn);
            let end_movable = !is_fixed_route_point(srj, route, index + 1, conn);
            if !start_movable && !end_movable { continue; }
            let violation = -signed;
            let sw = if start_movable && end_movable { 0.5 } else if start_movable { 1.0 } else { 0.0 };
            let ew = if start_movable && end_movable { 0.5 } else if end_movable { 1.0 } else { 0.0 };
            forces[index].x += direction.x * violation * sw; forces[index].y += direction.y * violation * sw;
            forces[index + 1].x += direction.x * violation * ew; forces[index + 1].y += direction.y * violation * ew;
        }
        for other in others {
            if routes_are_connected(route, other, conn) { continue; }
            for pair in other.route.windows(2) {
                let a = pair[0].borrow(); let b = pair[1].borrow();
                if a.z != start.z || b.z != start.z || distance(a.point(), b.point()) < CLEARANCE_EPSILON { continue; }
                let clearance = segment_to_segment_min_distance(&start.point(), &end.point(), &a.point(), &b.point()) - get_trace_half_width(srj, route) - get_trace_half_width(srj, other);
                let violation = srj["minTraceToPadEdgeClearance"].as_f64().unwrap() + RELAXATION_CLEARANCE_SLACK - clearance;
                if violation <= 0.0 { continue; }
                let midpoint = Point { x: (start.x + end.x) / 2.0, y: (start.y + end.y) / 2.0 };
                let closest = point_to_segment_closest_point(&midpoint, &a.point(), &b.point());
                let mut direction = normalize_vector(Point { x: midpoint.x - closest.x, y: midpoint.y - closest.y });
                if direction.x.abs() < CLEARANCE_EPSILON && direction.y.abs() < CLEARANCE_EPSILON {
                    direction = normalize_vector(Point { x: -(end.y - start.y), y: end.x - start.x });
                }
                let start_movable = !is_fixed_route_point(srj, route, index, conn);
                let end_movable = !is_fixed_route_point(srj, route, index + 1, conn);
                if !start_movable && !end_movable { continue; }
                let sw = if start_movable && end_movable { 0.5 } else if start_movable { 1.0 } else { 0.0 };
                let ew = if start_movable && end_movable { 0.5 } else if end_movable { 1.0 } else { 0.0 };
                forces[index].x += direction.x * violation * sw; forces[index].y += direction.y * violation * sw;
                forces[index + 1].x += direction.x * violation * ew; forces[index + 1].y += direction.y * violation * ew;
            }
        }
    }
    forces
}

fn apply_nudge_forces(srj: &Value, route: &MutableRoute, forces: &[Point], scale: f64, conn: Option<&RepairConnectivityMap>) -> MutableRoute {
    let result = route.clone();
    for (index, point) in result.route.iter().enumerate() {
        if is_fixed_route_point(srj, route, index, conn) { continue; }
        let force = limit_vector(forces.get(index).copied().unwrap_or(Point { x: 0.0, y: 0.0 }), MAX_NUDGE_DISTANCE);
        let mut point = point.borrow_mut();
        point.x += force.x * scale; point.y += force.y * scale;
    }
    result
}

fn route_stays_inside_bounds(srj: &Value, route: &MutableRoute) -> bool {
    let b = &srj["bounds"];
    route.route.iter().all(|point| {
        let p = point.borrow();
        p.x >= b["minX"].as_f64().unwrap() - CLEARANCE_EPSILON && p.x <= b["maxX"].as_f64().unwrap() + CLEARANCE_EPSILON
            && p.y >= b["minY"].as_f64().unwrap() - CLEARANCE_EPSILON && p.y <= b["maxY"].as_f64().unwrap() + CLEARANCE_EPSILON
    })
}

fn nudge_route(srj: &Value, routes: &[MutableRoute], index: usize, conn: Option<&RepairConnectivityMap>) -> Option<MutableRoute> {
    let blockers = get_clearance_blockers_for_route(srj, routes, index, conn);
    let others: Vec<_> = routes.iter().enumerate().filter(|(i, _)| *i != index).map(|(_, r)| r).collect();
    let mut nudged = routes[index].clone();
    let mut penalty = route_clearance_penalty(srj, &nudged, &blockers) + other_trace_penalty(srj, &nudged, &others, conn);
    let mut changed = false;
    for _ in 0..RELAXATION_ITERATIONS {
        if penalty <= CLEARANCE_EPSILON { break; }
        let forces = compute_nudge_forces(srj, &nudged, &blockers, &others, conn);
        if forces.iter().all(|force| distance(*force, Point { x: 0.0, y: 0.0 }) < 1e-9) { break; }
        let mut accepted = None;
        let mut accepted_penalty = penalty;
        for scale in CANDIDATE_SCALES {
            let candidate = apply_nudge_forces(srj, &nudged, &forces, scale, conn);
            let candidate_penalty = route_clearance_penalty(srj, &candidate, &blockers) + other_trace_penalty(srj, &candidate, &others, conn);
            if candidate_penalty < penalty - 1e-6 && route_stays_inside_bounds(srj, &candidate) { accepted = Some(candidate); accepted_penalty = candidate_penalty; break; }
        }
        let Some(candidate) = accepted else { break; };
        nudged = candidate; penalty = accepted_penalty; changed = true;
    }
    changed.then_some(nudged)
}

pub fn apply_trace_to_pad_clearance_relaxation(srj: &Value, routes: &Routes, conn: Option<&RepairConnectivityMap>, _math: RepairMath) -> Routes {
    if srj.get("minTraceToPadEdgeClearance").is_none_or(Value::is_null) || srj["minTraceToPadEdgeClearance"].as_f64().is_some_and(|n| n <= 0.0) { return routes.clone(); }
    let mut relaxed = (**routes).clone();
    let mut changed = false;
    for _ in 0..RELAXATION_PASSES {
        for index in 0..relaxed.len() {
            if let Some(nudged) = nudge_route(srj, &relaxed, index, conn) { relaxed[index] = nudged; changed = true; }
        }
    }
    if changed { Routes::new(relaxed) } else { routes.clone() }
}
