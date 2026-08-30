use crate::geometry::{point_within_bounds, route_point_distance, GeometryIndex};
use crate::protocol::{
    CandidateCost, CoreFailureCode, CoreResponse, RoutePoint, SearchRequest, Via, WorkCounters,
    CORE_PROTOCOL_VERSION,
};
use std::cmp::Ordering;
use std::collections::{BTreeMap, BinaryHeap};

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
struct NodeKey {
    layer_index: usize,
    x_index: i32,
    y_index: i32,
    direction: u8,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct SearchCost {
    via_count: u32,
    length_steps: u64,
    bend_count: u32,
}

impl Ord for SearchCost {
    fn cmp(&self, other: &Self) -> Ordering {
        (self.via_count, self.length_steps, self.bend_count).cmp(&(
            other.via_count,
            other.length_steps,
            other.bend_count,
        ))
    }
}

impl PartialOrd for SearchCost {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct QueueEntry {
    estimated_cost: SearchCost,
    deterministic_tie: u64,
    node: NodeKey,
}

impl Ord for QueueEntry {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .estimated_cost
            .cmp(&self.estimated_cost)
            .then_with(|| other.deterministic_tie.cmp(&self.deterministic_tie))
            .then_with(|| other.node.cmp(&self.node))
    }
}

impl PartialOrd for QueueEntry {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

pub fn search_region(request: &SearchRequest) -> CoreResponse {
    let geometry_index = GeometryIndex::new(&request.layer_names, &request.obstacles);
    let via_forbidden_index =
        GeometryIndex::new(&request.layer_names, &request.via_forbidden_obstacles);
    let start_layer = layer_index(request, &request.start.layer);
    let goal_layer = layer_index(request, &request.goal.layer);
    let start_grid = point_to_grid(request, request.start.x, request.start.y);
    let goal_grid = point_to_grid(request, request.goal.x, request.goal.y);
    let start_node = NodeKey {
        layer_index: start_layer,
        x_index: start_grid.0,
        y_index: start_grid.1,
        direction: 0,
    };
    let mut work = WorkCounters::default();
    let start_grid_point = grid_to_point(request, start_node);
    if !geometry_index.segment_is_clear(
        start_layer,
        (request.start.x, request.start.y),
        start_grid_point,
        request.trace_width_mm / 2.0,
        request.clearance_mm,
        &mut work,
    ) {
        return failed_response(
            request,
            CoreFailureCode::NoLegalPath,
            "the start terminal cannot legally reach the active search grid",
            work,
        );
    }

    let mut open = BinaryHeap::new();
    let initial_cost = SearchCost {
        via_count: 0,
        length_steps: 0,
        bend_count: 0,
    };
    open.push(QueueEntry {
        estimated_cost: with_heuristic(initial_cost, start_grid, goal_grid),
        deterministic_tie: deterministic_tie(start_node, request.deterministic_seed),
        node: start_node,
    });
    let mut best_cost = BTreeMap::from([(start_node, initial_cost)]);
    let mut parent = BTreeMap::new();
    let mut activation_index = 0_usize;
    let mut active_bounds = &request.active_bounds;
    let mut ring_expansions = 0_u32;

    let exhausted_budget = loop {
        if open.is_empty() || ring_expansions >= request.maximum_expansions {
            let ring_exhausted_budget = ring_expansions >= request.maximum_expansions;
            if let Some(next_bounds) = request.activation_bounds.get(activation_index) {
                active_bounds = next_bounds;
                activation_index += 1;
                ring_expansions = 0;
                work.activated_rings += 1;
                for (node, cost) in &best_cost {
                    open.push(QueueEntry {
                        estimated_cost: with_heuristic(
                            *cost,
                            (node.x_index, node.y_index),
                            goal_grid,
                        ),
                        deterministic_tie: deterministic_tie(
                            *node,
                            request.deterministic_seed,
                        ),
                        node: *node,
                    });
                }
                work.peak_open_set_size = work.peak_open_set_size.max(open.len() as u32);
                continue;
            }
            break ring_exhausted_budget;
        }
        let Some(entry) = open.pop() else {
            continue;
        };
        let Some(current_cost) = best_cost.get(&entry.node).copied() else {
            continue;
        };
        let expected_estimate = with_heuristic(
            current_cost,
            (entry.node.x_index, entry.node.y_index),
            goal_grid,
        );
        if entry.estimated_cost != expected_estimate {
            continue;
        }
        ring_expansions += 1;
        work.search_expansions += 1;

        if entry.node.layer_index == goal_layer
            && entry.node.x_index == goal_grid.0
            && entry.node.y_index == goal_grid.1
        {
            let grid_point = grid_to_point(request, entry.node);
            if geometry_index.segment_is_clear(
                goal_layer,
                grid_point,
                (request.goal.x, request.goal.y),
                request.trace_width_mm / 2.0,
                request.clearance_mm,
                &mut work,
            ) {
                return solved_response(request, entry.node, &parent, work);
            }
        }

        let neighbors = generate_neighbors(
            request,
            entry.node,
            request.deterministic_seed,
            active_bounds,
        );
        work.generated_neighbors += neighbors.len() as u32;
        for neighbor in neighbors {
            let candidate_cost = advance_cost(current_cost, entry.node, neighbor);
            if candidate_cost.via_count > request.maximum_vias {
                continue;
            }
            if !transition_is_clear(
                request,
                &geometry_index,
                &via_forbidden_index,
                entry.node,
                neighbor,
                &mut work,
            ) {
                continue;
            }
            let should_update = best_cost
                .get(&neighbor)
                .map(|known| candidate_cost < *known)
                .unwrap_or(true);
            if !should_update {
                continue;
            }
            best_cost.insert(neighbor, candidate_cost);
            parent.insert(neighbor, entry.node);
            open.push(QueueEntry {
                estimated_cost: with_heuristic(
                    candidate_cost,
                    (neighbor.x_index, neighbor.y_index),
                    goal_grid,
                ),
                deterministic_tie: deterministic_tie(neighbor, request.deterministic_seed),
                node: neighbor,
            });
            work.peak_open_set_size = work.peak_open_set_size.max(open.len() as u32);
        }
    };

    if exhausted_budget {
        failed_response(
            request,
            CoreFailureCode::SearchBudgetExhausted,
            "the deterministic search expansion budget was exhausted",
            work,
        )
    } else {
        failed_response(
            request,
            CoreFailureCode::NoLegalPath,
            "no legal path exists inside the active region envelope",
            work,
        )
    }
}

fn layer_index(request: &SearchRequest, layer_name: &str) -> usize {
    request
        .layer_names
        .iter()
        .position(|candidate| candidate == layer_name)
        .expect("validated layer name must exist")
}

fn point_to_grid(request: &SearchRequest, x: f64, y: f64) -> (i32, i32) {
    (
        ((x - request.active_bounds.min_x) / request.resolution_mm).round() as i32,
        ((y - request.active_bounds.min_y) / request.resolution_mm).round() as i32,
    )
}

fn grid_to_point(request: &SearchRequest, node: NodeKey) -> (f64, f64) {
    (
        request.active_bounds.min_x + node.x_index as f64 * request.resolution_mm,
        request.active_bounds.min_y + node.y_index as f64 * request.resolution_mm,
    )
}

fn generate_neighbors(
    request: &SearchRequest,
    node: NodeKey,
    seed: u32,
    active_bounds: &crate::protocol::Bounds,
) -> Vec<NodeKey> {
    let directions = [
        (1, 0, 1_u8),
        (0, 1, 3_u8),
        (-1, 0, 2_u8),
        (0, -1, 4_u8),
    ];
    let offset = (seed as usize) % directions.len();
    let mut neighbors = Vec::with_capacity(4 + request.legal_via_spans.len());
    for direction_index in 0..directions.len() {
        let (dx, dy, direction) = directions[(direction_index + offset) % directions.len()];
        let candidate = NodeKey {
            layer_index: node.layer_index,
            x_index: node.x_index + dx,
            y_index: node.y_index + dy,
            direction,
        };
        let point = grid_to_point(request, candidate);
        if point_within_bounds(point, active_bounds) {
            neighbors.push(candidate);
        }
    }
    let current_layer = &request.layer_names[node.layer_index];
    for span in &request.legal_via_spans {
        let target_layer = if &span.from_layer == current_layer {
            Some(&span.to_layer)
        } else if &span.to_layer == current_layer {
            Some(&span.from_layer)
        } else {
            None
        };
        if let Some(target_layer) = target_layer {
            neighbors.push(NodeKey {
                layer_index: layer_index(request, target_layer),
                x_index: node.x_index,
                y_index: node.y_index,
                direction: 5,
            });
        }
    }
    neighbors
}

fn advance_cost(current: SearchCost, from: NodeKey, to: NodeKey) -> SearchCost {
    let is_via = from.layer_index != to.layer_index;
    let changed_direction = from.direction != 0
        && from.direction != 5
        && to.direction != 5
        && from.direction != to.direction;
    SearchCost {
        via_count: current.via_count + u32::from(is_via),
        length_steps: current.length_steps + u64::from(!is_via),
        bend_count: current.bend_count + u32::from(changed_direction),
    }
}

fn with_heuristic(
    cost: SearchCost,
    point: (i32, i32),
    goal: (i32, i32),
) -> SearchCost {
    SearchCost {
        via_count: cost.via_count,
        length_steps: cost.length_steps
            + point.0.abs_diff(goal.0) as u64
            + point.1.abs_diff(goal.1) as u64,
        bend_count: cost.bend_count,
    }
}

fn deterministic_tie(node: NodeKey, seed: u32) -> u64 {
    let mut value = seed as u64 ^ 0x9e3779b97f4a7c15;
    for part in [
        node.layer_index as u64,
        node.x_index as i64 as u64,
        node.y_index as i64 as u64,
        node.direction as u64,
    ] {
        value ^= part
            .wrapping_add(0x9e3779b97f4a7c15)
            .wrapping_add(value << 6)
            .wrapping_add(value >> 2);
    }
    value
}

fn transition_is_clear(
    request: &SearchRequest,
    geometry_index: &GeometryIndex,
    via_forbidden_index: &GeometryIndex,
    from: NodeKey,
    to: NodeKey,
    work: &mut WorkCounters,
) -> bool {
    let from_point = grid_to_point(request, from);
    if from.layer_index == to.layer_index {
        let to_point = grid_to_point(request, to);
        return geometry_index.segment_is_clear(
            from.layer_index,
            from_point,
            to_point,
            request.trace_width_mm / 2.0,
            request.clearance_mm,
            work,
        );
    }
    let min_layer = from.layer_index.min(to.layer_index);
    let max_layer = from.layer_index.max(to.layer_index);
    geometry_index.via_is_clear(
        min_layer..=max_layer,
        from_point,
        request.via_pad_diameter_mm / 2.0,
        request.clearance_mm,
        work,
    ) && via_forbidden_index.via_is_clear(
        min_layer..=max_layer,
        from_point,
        request.via_pad_diameter_mm / 2.0,
        0.0,
        work,
    )
}

fn solved_response(
    request: &SearchRequest,
    goal: NodeKey,
    parent: &BTreeMap<NodeKey, NodeKey>,
    work: WorkCounters,
) -> CoreResponse {
    let mut nodes = vec![goal];
    let mut cursor = goal;
    while let Some(previous) = parent.get(&cursor).copied() {
        nodes.push(previous);
        cursor = previous;
    }
    nodes.reverse();
    let mut route = Vec::with_capacity(nodes.len() + 2);
    route.push(request.start.clone());
    for node in nodes {
        let point = grid_to_point(request, node);
        let route_point = RoutePoint {
            x: point.0,
            y: point.1,
            layer: request.layer_names[node.layer_index].clone(),
        };
        if route.last().map(|last| same_point(last, &route_point)).unwrap_or(false) {
            continue;
        }
        route.push(route_point);
    }
    if !route
        .last()
        .map(|last| same_point(last, &request.goal))
        .unwrap_or(false)
    {
        route.push(request.goal.clone());
    }
    let route = simplify_route(route);
    let vias = route
        .windows(2)
        .filter(|pair| pair[0].layer != pair[1].layer)
        .map(|pair| Via {
            x: pair[0].x,
            y: pair[0].y,
            from_layer: pair[0].layer.clone(),
            to_layer: pair[1].layer.clone(),
        })
        .collect::<Vec<_>>();
    let total_length_mm = route
        .windows(2)
        .filter(|pair| pair[0].layer == pair[1].layer)
        .map(|pair| route_point_distance(&pair[0], &pair[1]))
        .sum();
    let bend_count = count_bends(&route);
    CoreResponse::Solved {
        protocol_version: CORE_PROTOCOL_VERSION,
        region_id: request.region_id.clone(),
        route,
        cost: CandidateCost {
            via_count: vias.len() as u32,
            total_length_mm,
            bend_count,
        },
        vias,
        work,
    }
}

fn same_point(first: &RoutePoint, second: &RoutePoint) -> bool {
    first.x == second.x && first.y == second.y && first.layer == second.layer
}

fn simplify_route(route: Vec<RoutePoint>) -> Vec<RoutePoint> {
    let mut simplified: Vec<RoutePoint> = Vec::with_capacity(route.len());
    for point in route {
        let should_replace = if simplified.len() >= 2 {
            let first = &simplified[simplified.len() - 2];
            let second = &simplified[simplified.len() - 1];
            first.layer == second.layer
                && second.layer == point.layer
                && orientation(first, second, &point).abs() <= 1e-12
        } else {
            false
        };
        if should_replace {
            simplified.pop();
        }
        simplified.push(point);
    }
    simplified
}

fn orientation(first: &RoutePoint, second: &RoutePoint, third: &RoutePoint) -> f64 {
    (second.x - first.x) * (third.y - first.y)
        - (second.y - first.y) * (third.x - first.x)
}

fn count_bends(route: &[RoutePoint]) -> u32 {
    route
        .windows(3)
        .filter(|triple| {
            triple[0].layer == triple[1].layer
                && triple[1].layer == triple[2].layer
                && orientation(&triple[0], &triple[1], &triple[2]).abs() > 1e-12
        })
        .count() as u32
}

fn failed_response(
    request: &SearchRequest,
    code: CoreFailureCode,
    message: &str,
    work: WorkCounters,
) -> CoreResponse {
    CoreResponse::Failed {
        protocol_version: CORE_PROTOCOL_VERSION,
        region_id: request.region_id.clone(),
        code,
        message: message.into(),
        work,
    }
}
