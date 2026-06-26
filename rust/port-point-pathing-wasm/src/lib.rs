use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};

#[derive(Deserialize)]
struct RegionInput {
    id: String,
    capacity_mesh_node_id: String,
    center_x: f64,
    center_y: f64,
    available_z: Vec<i32>,
    contains_obstacle: bool,
    contains_target: bool,
    target_connection_name: Option<String>,
    reserved_net_ids: Vec<String>,
}

#[derive(Deserialize)]
struct PortInput {
    id: String,
    region1_id: String,
    region2_id: String,
    x: f64,
    y: f64,
    z: i32,
    penalty: f64,
}

#[derive(Deserialize)]
struct ConnectionInput {
    id: String,
    net_id: String,
    start_region_id: String,
    end_region_id: String,
    start_terminal_port_id: String,
    end_terminal_port_id: String,
    start_x: f64,
    start_y: f64,
    start_z: i32,
    end_x: f64,
    end_y: f64,
    end_z: i32,
}

#[derive(Deserialize)]
struct PathingInput {
    regions: Vec<RegionInput>,
    ports: Vec<PortInput>,
    connections: Vec<ConnectionInput>,
}

#[derive(Clone, Serialize)]
struct SegmentOutput {
    connection_id: String,
    from_port_id: String,
    to_port_id: String,
}

#[derive(Serialize)]
struct RegionOutput {
    region_id: String,
    capacity_mesh_node_id: String,
    segments: Vec<SegmentOutput>,
}

#[derive(Serialize)]
struct PathingStats {
    routed_connection_count: usize,
    region_assignment_count: usize,
    routing_attempt_count: usize,
    selected_routing_order: String,
}

#[derive(Serialize)]
#[serde(tag = "ok")]
enum PathingResult {
    #[serde(rename = "true")]
    Success {
        regions: Vec<RegionOutput>,
        stats: PathingStats,
    },
    #[serde(rename = "false")]
    Error { error: String },
}

#[derive(Clone, Copy)]
struct PortEdge {
    port_index: usize,
    other_region_index: usize,
}

#[derive(Clone, Copy)]
struct PreviousHop {
    previous_state: SearchStateKey,
}

#[derive(Clone, Copy)]
struct QueueState {
    cost: f64,
    state: SearchStateKey,
}

impl PartialEq for QueueState {
    fn eq(&self, other: &Self) -> bool {
        self.cost == other.cost && self.state == other.state
    }
}

impl Eq for QueueState {}

impl PartialOrd for QueueState {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for QueueState {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .cost
            .partial_cmp(&self.cost)
            .unwrap_or(Ordering::Equal)
            .then_with(|| other.state.region_index.cmp(&self.state.region_index))
            .then_with(|| other.state.incoming_port.cmp(&self.state.incoming_port))
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
struct SearchStateKey {
    region_index: usize,
    incoming_port: i32,
}

#[derive(Clone, Copy)]
struct RoutePoint {
    x: f64,
    y: f64,
    z: i32,
}

#[derive(Clone)]
struct AssignedSegment {
    net_id: String,
    from: RoutePoint,
    to: RoutePoint,
}

struct RoutingOutput {
    order_name: String,
    segments_by_region_index: Vec<Vec<SegmentOutput>>,
}

#[derive(Clone, Copy)]
enum RoutingOrder {
    EasyFirst,
}

#[no_mangle]
pub extern "C" fn wasm_alloc(len: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(len);
    let ptr = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    ptr
}

#[no_mangle]
pub unsafe extern "C" fn wasm_dealloc(ptr: *mut u8, len: usize) {
    if len > 0 {
        drop(Vec::from_raw_parts(ptr, 0, len));
    }
}

#[no_mangle]
pub unsafe extern "C" fn solve_port_point_pathing_json(ptr: *mut u8, len: usize) -> u64 {
    let input_bytes = std::slice::from_raw_parts(ptr, len);
    let result = match std::str::from_utf8(input_bytes) {
        Ok(input_json) => solve_json(input_json),
        Err(error) => PathingResult::Error {
            error: format!("RustWasmPortPointPathingSolver: input is not UTF-8: {error}"),
        },
    };
    let output_json = serde_json::to_string(&result).unwrap_or_else(|error| {
        format!(
            "{{\"ok\":\"false\",\"error\":\"RustWasmPortPointPathingSolver: could not serialize result: {error}\"}}"
        )
    });
    let output_bytes = output_json.into_bytes();
    let output_len = output_bytes.len();
    let output_ptr = wasm_alloc(output_len);
    std::ptr::copy_nonoverlapping(output_bytes.as_ptr(), output_ptr, output_len);
    ((output_len as u64) << 32) | output_ptr as u64
}

fn solve_json(input_json: &str) -> PathingResult {
    let input: PathingInput = match serde_json::from_str(input_json) {
        Ok(input) => input,
        Err(error) => {
            return PathingResult::Error {
                error: format!("RustWasmPortPointPathingSolver: invalid JSON input: {error}"),
            };
        }
    };

    match solve_pathing(&input) {
        Ok((regions, stats)) => PathingResult::Success { regions, stats },
        Err(error) => PathingResult::Error { error },
    }
}

fn solve_pathing(input: &PathingInput) -> Result<(Vec<RegionOutput>, PathingStats), String> {
    let mut region_index_by_id = HashMap::<&str, usize>::new();
    for (region_index, region) in input.regions.iter().enumerate() {
        if region_index_by_id
            .insert(region.id.as_str(), region_index)
            .is_some()
        {
            return Err(format!(
                "RustWasmPortPointPathingSolver: duplicate region id {:?}",
                region.id
            ));
        }
    }

    let adjacency = build_adjacency(input, &region_index_by_id)?;
    let historical_region_congestion = vec![0.0; input.regions.len()];
    let historical_port_congestion = vec![0.0; input.ports.len()];
    let routing_output = solve_pathing_with_order(
        input,
        &region_index_by_id,
        &adjacency,
        RoutingOrder::EasyFirst,
        0,
        &historical_region_congestion,
        &historical_port_congestion,
    )?;
    let mut segments_by_region_index = routing_output.segments_by_region_index;
    let mut regions = Vec::new();
    let mut region_assignment_count = 0;
    for (region_index, region) in input.regions.iter().enumerate() {
        let segments = std::mem::take(&mut segments_by_region_index[region_index]);
        if segments.is_empty() {
            continue;
        }
        region_assignment_count += segments.len();
        regions.push(RegionOutput {
            region_id: region.id.clone(),
            capacity_mesh_node_id: region.capacity_mesh_node_id.clone(),
            segments,
        });
    }

    Ok((
        regions,
        PathingStats {
            routed_connection_count: input.connections.len(),
            region_assignment_count,
            routing_attempt_count: 1,
            selected_routing_order: routing_output.order_name,
        },
    ))
}

fn solve_pathing_with_order(
    input: &PathingInput,
    region_index_by_id: &HashMap<&str, usize>,
    adjacency: &[Vec<PortEdge>],
    order: RoutingOrder,
    pass_index: usize,
    historical_region_congestion: &[f64],
    historical_port_congestion: &[f64],
) -> Result<RoutingOutput, String> {
    let mut segments_by_region_index = Vec::<Vec<SegmentOutput>>::new();
    segments_by_region_index.resize_with(input.regions.len(), Vec::new);
    let mut assigned_segments_by_region_index = Vec::<Vec<AssignedSegment>>::new();
    assigned_segments_by_region_index.resize_with(input.regions.len(), Vec::new);
    let mut region_usage = vec![0usize; input.regions.len()];
    let mut port_usage = vec![0usize; input.ports.len()];
    let mut port_owner_net = vec![None::<String>; input.ports.len()];

    let ordered_connections = get_ordered_connections(input, order);

    for connection in ordered_connections {
        let start_region_index = get_region_index(
            &region_index_by_id,
            connection.start_region_id.as_str(),
            &connection.id,
            "start",
        )?;
        let end_region_index = get_region_index(
            &region_index_by_id,
            connection.end_region_id.as_str(),
            &connection.id,
            "end",
        )?;
        let path = find_region_path(
            input,
            connection,
            &adjacency,
            &region_usage,
            &port_usage,
            &port_owner_net,
            &assigned_segments_by_region_index,
            historical_region_congestion,
            historical_port_congestion,
            start_region_index,
            end_region_index,
        )?;
        append_connection_segments(
            input,
            connection,
            &path,
            &mut segments_by_region_index,
            &mut region_usage,
            &mut port_usage,
            &mut port_owner_net,
            &mut assigned_segments_by_region_index,
        )?;
    }

    Ok(RoutingOutput {
        order_name: format!("{}:pass-{}", order.name(), pass_index + 1),
        segments_by_region_index,
    })
}

fn get_ordered_connections<'a>(
    input: &'a PathingInput,
    order: RoutingOrder,
) -> Vec<&'a ConnectionInput> {
    let mut ordered_connections: Vec<&ConnectionInput> = input.connections.iter().collect();
    match order {
        RoutingOrder::EasyFirst => ordered_connections.sort_by(compare_easy_first),
    }
    ordered_connections
}

fn compare_easy_first(left: &&ConnectionInput, right: &&ConnectionInput) -> Ordering {
    estimate_connection_difficulty(left)
        .partial_cmp(&estimate_connection_difficulty(right))
        .unwrap_or(Ordering::Equal)
        .then_with(|| left.id.cmp(&right.id))
}

impl RoutingOrder {
    fn name(self) -> &'static str {
        match self {
            RoutingOrder::EasyFirst => "easy-first",
        }
    }
}

fn estimate_connection_difficulty(connection: &ConnectionInput) -> f64 {
    let endpoint_distance = distance(
        connection.start_x,
        connection.start_y,
        connection.end_x,
        connection.end_y,
    );
    let layer_change = if connection.start_z == connection.end_z {
        0.0
    } else {
        25.0
    };
    endpoint_distance + layer_change
}

fn build_adjacency(
    input: &PathingInput,
    region_index_by_id: &HashMap<&str, usize>,
) -> Result<Vec<Vec<PortEdge>>, String> {
    let mut adjacency = Vec::<Vec<PortEdge>>::new();
    adjacency.resize_with(input.regions.len(), Vec::new);

    for (port_index, port) in input.ports.iter().enumerate() {
        let region1_index = get_region_index(
            region_index_by_id,
            port.region1_id.as_str(),
            &port.id,
            "port region1",
        )?;
        let region2_index = get_region_index(
            region_index_by_id,
            port.region2_id.as_str(),
            &port.id,
            "port region2",
        )?;

        adjacency[region1_index].push(PortEdge {
            port_index,
            other_region_index: region2_index,
        });
        adjacency[region2_index].push(PortEdge {
            port_index,
            other_region_index: region1_index,
        });
    }
    Ok(adjacency)
}

fn get_region_index(
    region_index_by_id: &HashMap<&str, usize>,
    region_id: &str,
    owner_id: &str,
    role: &str,
) -> Result<usize, String> {
    region_index_by_id.get(region_id).copied().ok_or_else(|| {
        format!(
            "RustWasmPortPointPathingSolver: {role} {:?} for {:?} not found",
            region_id, owner_id
        )
    })
}

fn find_region_path(
    input: &PathingInput,
    connection: &ConnectionInput,
    adjacency: &[Vec<PortEdge>],
    region_usage: &[usize],
    port_usage: &[usize],
    port_owner_net: &[Option<String>],
    assigned_segments_by_region_index: &[Vec<AssignedSegment>],
    historical_region_congestion: &[f64],
    historical_port_congestion: &[f64],
    start_region_index: usize,
    end_region_index: usize,
) -> Result<Vec<SearchStateKey>, String> {
    if start_region_index == end_region_index {
        return Ok(vec![SearchStateKey {
            region_index: start_region_index,
            incoming_port: -1,
        }]);
    }

    let mut heap = BinaryHeap::<QueueState>::new();
    let mut best_cost = HashMap::<SearchStateKey, f64>::new();
    let mut previous = HashMap::<SearchStateKey, PreviousHop>::new();
    let mut best_goal_state: Option<SearchStateKey> = None;
    let mut best_goal_cost = f64::INFINITY;
    let start_state = SearchStateKey {
        region_index: start_region_index,
        incoming_port: -1,
    };
    best_cost.insert(start_state, 0.0);
    heap.push(QueueState {
        cost: 0.0,
        state: start_state,
    });

    while let Some(state) = heap.pop() {
        if state.cost >= best_goal_cost {
            break;
        }
        if state.cost > *best_cost.get(&state.state).unwrap_or(&f64::INFINITY) {
            continue;
        }
        if state.state.region_index == end_region_index {
            let final_cost = compute_terminal_segment_cost(
                input,
                connection,
                state.state,
                assigned_segments_by_region_index,
            )?;
            if !final_cost.is_finite() {
                continue;
            }
            let goal_cost = state.cost + final_cost;
            if goal_cost < best_goal_cost {
                best_goal_cost = goal_cost;
                best_goal_state = Some(state.state);
            }
            continue;
        }

        for edge in &adjacency[state.state.region_index] {
            let edge_cost = compute_edge_cost(
                input,
                connection,
                state.state,
                *edge,
                region_usage,
                port_usage,
                port_owner_net,
                assigned_segments_by_region_index,
                historical_region_congestion,
                historical_port_congestion,
            );
            let Some(edge_cost) = edge_cost else {
                continue;
            };
            let next_cost = state.cost + edge_cost;
            let next_state = SearchStateKey {
                region_index: edge.other_region_index,
                incoming_port: edge.port_index as i32,
            };
            if next_cost < *best_cost.get(&next_state).unwrap_or(&f64::INFINITY) {
                best_cost.insert(next_state, next_cost);
                previous.insert(next_state, PreviousHop {
                    previous_state: state.state,
                });
                heap.push(QueueState {
                    cost: next_cost,
                    state: next_state,
                });
            }
        }
    }

    if let Some(goal_state) = best_goal_state {
        return reconstruct_path(connection, &previous, goal_state);
    }

    Err(format!(
        "RustWasmPortPointPathingSolver: no region path for connection {:?} from {:?} to {:?}",
        connection.id, connection.start_region_id, connection.end_region_id
    ))
}

fn compute_edge_cost(
    input: &PathingInput,
    connection: &ConnectionInput,
    state: SearchStateKey,
    edge: PortEdge,
    region_usage: &[usize],
    port_usage: &[usize],
    port_owner_net: &[Option<String>],
    assigned_segments_by_region_index: &[Vec<AssignedSegment>],
    historical_region_congestion: &[f64],
    historical_port_congestion: &[f64],
) -> Option<f64> {
    if port_owner_net[edge.port_index]
        .as_ref()
        .is_some_and(|net_id| net_id != &connection.net_id)
    {
        return None;
    }

    if state.incoming_port == edge.port_index as i32 {
        return None;
    }

    let current_region = &input.regions[state.region_index];
    let next_region = &input.regions[edge.other_region_index];
    if is_blocked_obstacle_region(current_region, connection)
        || is_blocked_obstacle_region(next_region, connection)
    {
        return None;
    }

    let port = &input.ports[edge.port_index];
    let from_point = get_route_point_for_state(input, connection, state)?;
    let to_point = RoutePoint {
        x: port.x,
        y: port.y,
        z: port.z,
    };
    let next_anchor = if next_region.id == connection.end_region_id {
        (connection.end_x, connection.end_y)
    } else {
        (next_region.center_x, next_region.center_y)
    };
    let current_distance = distance(from_point.x, from_point.y, port.x, port.y);
    let next_distance = distance(port.x, port.y, next_anchor.0, next_anchor.1);
    let current_layer_penalty = layer_penalty(current_region, port.z, from_point.z);
    let next_layer_penalty = layer_penalty(next_region, port.z, connection.end_z);
    let region_penalty = region_usage[edge.other_region_index] as f64 * 4.0
        + region_usage[state.region_index] as f64 * 1.0;
    let port_reuse_penalty = port_usage[edge.port_index] as f64 * 24.0;
    let historical_region_penalty = historical_region_congestion[edge.other_region_index] * 10.0
        + historical_region_congestion[state.region_index] * 2.0;
    let historical_port_penalty = historical_port_congestion[edge.port_index] * 36.0;
    let foreign_target_penalty = target_obstacle_trespass_penalty(current_region, connection) * 0.25
        + target_obstacle_trespass_penalty(next_region, connection);
    let interior_top_penalty = if from_point.z == 0
        && to_point.z == 0
        && state.incoming_port >= 0
        && next_region.id != connection.end_region_id
    {
        80.0
    } else {
        0.0
    };
    let candidate_segment = AssignedSegment {
        net_id: connection.net_id.clone(),
        from: from_point,
        to: to_point,
    };
    if has_blocking_same_layer_cross_net_intersection(
        &candidate_segment,
        &assigned_segments_by_region_index[state.region_index],
    ) {
        return None;
    }
    let crossing_penalty = compute_segment_conflict_cost(
        &candidate_segment,
        &assigned_segments_by_region_index[state.region_index],
    );

    Some(current_distance
        + next_distance
        + current_layer_penalty
        + next_layer_penalty
        + region_penalty
        + port_reuse_penalty
        + historical_region_penalty
        + historical_port_penalty
        + foreign_target_penalty
        + interior_top_penalty
        + crossing_penalty
        + port.penalty
        + 1.0)
}

fn is_blocked_obstacle_region(region: &RegionInput, connection: &ConnectionInput) -> bool {
    if region.id == connection.start_region_id || region.id == connection.end_region_id {
        return false;
    }

    if !region.contains_obstacle {
        return false;
    }

    !region.contains_target
}

fn target_obstacle_trespass_penalty(region: &RegionInput, connection: &ConnectionInput) -> f64 {
    if region.id == connection.start_region_id || region.id == connection.end_region_id {
        return 0.0;
    }
    if !region.contains_obstacle || !region.contains_target {
        return 0.0;
    }
    if region
        .reserved_net_ids
        .iter()
        .any(|net_id| net_id == &connection.net_id || net_id == &connection.id)
    {
        return 0.0;
    }
    if region.target_connection_name.as_ref().is_some_and(|target_connection_name| {
        target_connection_name == &connection.id || target_connection_name == &connection.net_id
    }) {
        return 0.0;
    }

    650.0
}

fn compute_terminal_segment_cost(
    input: &PathingInput,
    connection: &ConnectionInput,
    state: SearchStateKey,
    assigned_segments_by_region_index: &[Vec<AssignedSegment>],
) -> Result<f64, String> {
    let from_point = get_route_point_for_state(input, connection, state).ok_or_else(|| {
        format!(
            "RustWasmPortPointPathingSolver: missing incoming point for connection {:?}",
            connection.id
        )
    })?;
    let to_point = RoutePoint {
        x: connection.end_x,
        y: connection.end_y,
        z: connection.end_z,
    };
    let segment = AssignedSegment {
        net_id: connection.net_id.clone(),
        from: from_point,
        to: to_point,
    };
    if has_blocking_same_layer_cross_net_intersection(
        &segment,
        &assigned_segments_by_region_index[state.region_index],
    ) {
        return Ok(f64::INFINITY);
    }
    Ok(distance(from_point.x, from_point.y, to_point.x, to_point.y)
        + compute_segment_conflict_cost(
            &segment,
            &assigned_segments_by_region_index[state.region_index],
        )
        + if from_point.z == to_point.z { 0.0 } else { 12.0 })
}

fn get_route_point_for_state(
    input: &PathingInput,
    connection: &ConnectionInput,
    state: SearchStateKey,
) -> Option<RoutePoint> {
    if state.incoming_port < 0 {
        return Some(RoutePoint {
            x: connection.start_x,
            y: connection.start_y,
            z: connection.start_z,
        });
    }
    let port = input.ports.get(state.incoming_port as usize)?;
    Some(RoutePoint {
        x: port.x,
        y: port.y,
        z: port.z,
    })
}

fn compute_segment_conflict_cost(segment: &AssignedSegment, existing: &[AssignedSegment]) -> f64 {
    existing
        .iter()
        .map(|other| {
            if !segments_intersect(segment.from, segment.to, other.from, other.to) {
                return 0.0;
            }
            if segment.from.z == segment.to.z && other.from.z == other.to.z && segment.from.z == other.from.z {
                return if segment.net_id == other.net_id { 70.0 } else { 140.0 };
            }
            if segment.net_id == other.net_id {
                return 4.0;
            }
            8.0
        })
        .sum()
}

fn has_blocking_same_layer_cross_net_intersection(
    segment: &AssignedSegment,
    existing: &[AssignedSegment],
) -> bool {
    if segment.from.z != segment.to.z {
        return false;
    }

    existing.iter().any(|other| {
        other.net_id != segment.net_id
            && other.from.z == other.to.z
            && other.from.z == segment.from.z
            && same_layer_segments_conflict(segment.from, segment.to, other.from, other.to)
    })
}

fn same_layer_segments_conflict(a: RoutePoint, b: RoutePoint, c: RoutePoint, d: RoutePoint) -> bool {
    if shares_endpoint(a, c) || shares_endpoint(a, d) || shares_endpoint(b, c) || shares_endpoint(b, d) {
        return false;
    }

    if segments_intersect(a, b, c, d) {
        return true;
    }

    let o1 = orientation(a, b, c);
    let o2 = orientation(a, b, d);
    let o3 = orientation(c, d, a);
    let o4 = orientation(c, d, b);

    (o1.abs() < 1e-9 && point_on_segment(c, a, b))
        || (o2.abs() < 1e-9 && point_on_segment(d, a, b))
        || (o3.abs() < 1e-9 && point_on_segment(a, c, d))
        || (o4.abs() < 1e-9 && point_on_segment(b, c, d))
}

fn point_on_segment(point: RoutePoint, start: RoutePoint, end: RoutePoint) -> bool {
    point.x >= start.x.min(end.x) - 1e-9
        && point.x <= start.x.max(end.x) + 1e-9
        && point.y >= start.y.min(end.y) - 1e-9
        && point.y <= start.y.max(end.y) + 1e-9
}

fn segments_intersect(a: RoutePoint, b: RoutePoint, c: RoutePoint, d: RoutePoint) -> bool {
    if shares_endpoint(a, c) || shares_endpoint(a, d) || shares_endpoint(b, c) || shares_endpoint(b, d) {
        return false;
    }

    let o1 = orientation(a, b, c);
    let o2 = orientation(a, b, d);
    let o3 = orientation(c, d, a);
    let o4 = orientation(c, d, b);

    o1 * o2 < 0.0 && o3 * o4 < 0.0
}

fn shares_endpoint(a: RoutePoint, b: RoutePoint) -> bool {
    (a.x - b.x).abs() < 1e-9 && (a.y - b.y).abs() < 1e-9
}

fn orientation(a: RoutePoint, b: RoutePoint, c: RoutePoint) -> f64 {
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

fn distance(ax: f64, ay: f64, bx: f64, by: f64) -> f64 {
    let dx = ax - bx;
    let dy = ay - by;
    (dx * dx + dy * dy).sqrt()
}

fn layer_penalty(region: &RegionInput, port_z: i32, endpoint_z: i32) -> f64 {
    let port_layer_penalty = if region.available_z.contains(&port_z) { 0.0 } else { 80.0 };
    let endpoint_layer_penalty = if port_z == endpoint_z { 0.0 } else { 6.0 };
    port_layer_penalty + endpoint_layer_penalty
}

fn reconstruct_path(
    connection: &ConnectionInput,
    previous: &HashMap<SearchStateKey, PreviousHop>,
    goal_state: SearchStateKey,
) -> Result<Vec<SearchStateKey>, String> {
    let mut reversed = Vec::<SearchStateKey>::new();
    let mut current_state = goal_state;
    loop {
        reversed.push(current_state);
        if current_state.incoming_port < 0 {
            break;
        }
        let hop = previous.get(&current_state).ok_or_else(|| {
            format!(
                "RustWasmPortPointPathingSolver: broken predecessor chain for connection {:?}",
                connection.id
            )
        })?;
        current_state = hop.previous_state;
    }
    reversed.reverse();
    if reversed.first().is_some_and(|state| state.incoming_port >= 0) {
        return Err(format!(
            "RustWasmPortPointPathingSolver: broken predecessor root for connection {:?}",
            connection.id
        ));
    }
    Ok(reversed)
}

fn append_connection_segments(
    input: &PathingInput,
    connection: &ConnectionInput,
    path: &[SearchStateKey],
    segments_by_region_index: &mut [Vec<SegmentOutput>],
    region_usage: &mut [usize],
    port_usage: &mut [usize],
    port_owner_net: &mut [Option<String>],
    assigned_segments_by_region_index: &mut [Vec<AssignedSegment>],
) -> Result<(), String> {
    if path.is_empty() {
        return Err(format!(
            "RustWasmPortPointPathingSolver: empty path for connection {:?}",
            connection.id
        ));
    }

    for index in 0..path.len() {
        let state = path[index];
        let region_index = state.region_index;
        let (from_port_id, from_point) = if index == 0 {
            (
                connection.start_terminal_port_id.clone(),
                RoutePoint {
                    x: connection.start_x,
                    y: connection.start_y,
                    z: connection.start_z,
                },
            )
        } else {
            if state.incoming_port < 0 {
                return Err(format!(
                    "RustWasmPortPointPathingSolver: non-root path state missing incoming port for connection {:?}",
                    connection.id
                ));
            }
            let port = &input.ports[state.incoming_port as usize];
            (
                port.id.clone(),
                RoutePoint {
                    x: port.x,
                    y: port.y,
                    z: port.z,
                },
            )
        };
        let (to_port_id, to_point) = if index + 1 == path.len() {
            (
                connection.end_terminal_port_id.clone(),
                RoutePoint {
                    x: connection.end_x,
                    y: connection.end_y,
                    z: connection.end_z,
                },
            )
        } else {
            let next_state = path[index + 1];
            if next_state.incoming_port < 0 {
                return Err(format!(
                    "RustWasmPortPointPathingSolver: non-terminal path edge missing incoming port for connection {:?}",
                    connection.id
                ));
            }
            let port = &input.ports[next_state.incoming_port as usize];
            (
                port.id.clone(),
                RoutePoint {
                    x: port.x,
                    y: port.y,
                    z: port.z,
                },
            )
        };
        segments_by_region_index[region_index].push(SegmentOutput {
            connection_id: connection.id.clone(),
            from_port_id: from_port_id.clone(),
            to_port_id: to_port_id.clone(),
        });
        assigned_segments_by_region_index[region_index].push(AssignedSegment {
            net_id: connection.net_id.clone(),
            from: from_point,
            to: to_point,
        });
        region_usage[region_index] += 1;
        if state.incoming_port >= 0 {
            let port_index = state.incoming_port as usize;
            port_usage[port_index] += 1;
            if port_owner_net[port_index].is_none() {
                port_owner_net[port_index] = Some(connection.net_id.clone());
            }
        }
    }
    Ok(())
}
