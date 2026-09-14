use crate::core::{TinyHyperGraphProblem, TinyHyperGraphTopology};
use crate::types::RouteId;

#[derive(Clone, Debug)]
pub struct OrderedBusTrace {
    pub route_id: RouteId,
    pub order_index: usize,
    pub signed_index_from_center: i32,
    pub distance_from_center: usize,
    pub score: f64,
    pub connection_id: String,
}

#[derive(Clone, Debug)]
pub struct BusTraceOrder {
    pub traces: Vec<OrderedBusTrace>,
    pub center_trace_index: usize,
    pub center_trace_route_id: RouteId,
    pub normal_x: f64,
    pub normal_y: f64,
}
const EPSILON: f64 = 1e-9;

fn get_connection_id(problem: &TinyHyperGraphProblem, route_id: RouteId) -> String {
    problem
        .route_metadata
        .as_ref()
        .and_then(|m| m.get(route_id as usize))
        .and_then(|m| m.get("connectionId"))
        .and_then(|v| v.as_str())
        .map(str::to_owned)
        .unwrap_or_else(|| format!("route-{route_id}"))
}

pub fn derive_bus_trace_order(
    topology: &TinyHyperGraphTopology,
    problem: &TinyHyperGraphProblem,
) -> BusTraceOrder {
    assert!(
        problem.route_count > 0,
        "Bus solver requires at least one route"
    );
    let (mut sx, mut sy, mut ex, mut ey) = (0.0, 0.0, 0.0, 0.0);

    for r in 0..problem.route_count {
        let s = problem.route_start_port[r] as usize;
        let e = problem.route_end_port[r] as usize;
        sx += topology.port_x[s];
        sy += topology.port_y[s];
        ex += topology.port_x[e];
        ey += topology.port_y[e];
    }

    let n = problem.route_count as f64;
    sx /= n;
    sy /= n;
    ex /= n;
    ey /= n;
    let (mut dx, mut dy) = (ex - sx, ey - sy);
    let length = dx.hypot(dy);
    if length <= EPSILON {
        dx = 1.0;
        dy = 0.0;
    } else {
        dx /= length;
        dy /= length;
    }

    let (normal_x, normal_y) = (-dy, dx);
    let raw: Vec<_> = (0..problem.route_count)
        .map(|r| {
            let s = problem.route_start_port[r] as usize;
            let e = problem.route_end_port[r] as usize;
            (
                r as RouteId,
                get_connection_id(problem, r as RouteId),
                (topology.port_x[s] - sx) * normal_x + (topology.port_y[s] - sy) * normal_y,
                (topology.port_x[e] - ex) * normal_x + (topology.port_y[e] - ey) * normal_y,
            )
        })
        .collect();
    let correlation: f64 = raw.iter().map(|t| t.2 * t.3).sum();
    let multiplier = if correlation < 0.0 { -1.0 } else { 1.0 };
    let mut ordered: Vec<_> = raw
        .into_iter()
        .map(|(r, id, s, e)| (r, id, (s + e * multiplier) / 2.0))
        .collect();
    ordered.sort_by(|l, r| l.2.total_cmp(&r.2).then_with(|| l.1.cmp(&r.1)));
    let center_trace_index = (ordered.len() - 1) / 2;
    let traces: Vec<_> = ordered
        .into_iter()
        .enumerate()
        .map(|(i, (route_id, connection_id, score))| OrderedBusTrace {
            route_id,
            connection_id,
            score,
            order_index: i,
            signed_index_from_center: i as i32 - center_trace_index as i32,
            distance_from_center: i.abs_diff(center_trace_index),
        })
        .collect();
    BusTraceOrder {
        center_trace_route_id: traces[center_trace_index].route_id,
        traces,
        center_trace_index,
        normal_x,
        normal_y,
    }
}
