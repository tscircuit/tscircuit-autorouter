use crate::core::TinyHyperGraphSolver;
use crate::graphics::GraphicsObject;
use crate::layer_labels::get_z_layer_label;
use crate::types::{PortId, RouteId};
use serde_json::{Value, json};
use std::collections::HashSet;

const PORT_LAYER_COORDINATE_OFFSET: f64 = 0.005;
const STATIC_REACHABILITY_TRACE_STROKE: &str = "rgba(220, 38, 38, 0.98)";
const STATIC_REACHABILITY_TRACE_FILL: &str = "rgba(220, 38, 38, 0.18)";
const STATIC_REACHABILITY_TRACE_DASH: &str = "8 4";
const STATIC_REACHABILITY_TRACE_RADIUS: f64 = 0.12;

fn format_label(lines: &[Option<String>]) -> String {
    lines
        .iter()
        .filter_map(Option::as_ref)
        .filter(|line| !line.is_empty())
        .cloned()
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn get_statically_unroutable_route_ids(
    solver: &TinyHyperGraphSolver,
) -> Option<HashSet<RouteId>> {
    let routes = solver.get_statically_unroutable_routes();
    if routes.is_empty() {
        return None;
    }

    Some(routes.iter().map(|route| route.route_id).collect())
}

fn get_port_render_point(solver: &TinyHyperGraphSolver, port: PortId) -> Value {
    let i = port as usize;
    let offset = solver.topology.port_z[i] as f64 * PORT_LAYER_COORDINATE_OFFSET;
    json!({ "x": solver.topology.port_x[i] + offset, "y": solver.topology.port_y[i] + offset })
}

fn get_port_visualization_layer(solver: &TinyHyperGraphSolver, port: PortId) -> String {
    get_z_layer_label(&[json!(solver.topology.port_z[port as usize])])
        .unwrap_or_else(|| "z0".into())
}

fn get_port_identifier_label(solver: &TinyHyperGraphSolver, port: PortId) -> String {
    let metadata = solver
        .topology
        .port_metadata
        .as_ref()
        .and_then(|m| m.get(port as usize));
    let raw = metadata
        .and_then(|m| {
            m.get("serializedPortId")
                .filter(|v| !v.is_null())
                .or_else(|| m.get("portId"))
        })
        .filter(|v| !v.is_null());
    let id = raw
        .map(|v| {
            v.as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| v.to_string())
        })
        .unwrap_or_else(|| format!("port-{port}"));
    format!("port: {id}")
}

fn get_port_z_label(solver: &TinyHyperGraphSolver, port: PortId) -> String {
    format!("z: {}", solver.topology.port_z[port as usize])
}

fn get_port_pair_z_label(solver: &TinyHyperGraphSolver, p1: PortId, p2: PortId) -> String {
    let start = solver.topology.port_z[p1 as usize];
    let end = solver.topology.port_z[p2 as usize];
    if start == end {
        format!("z: {start}")
    } else {
        format!("z: {start} -> {end}")
    }
}

fn get_route_endpoint_z_label(solver: &TinyHyperGraphSolver, route: RouteId) -> String {
    get_port_pair_z_label(
        solver,
        solver.problem.route_start_port[route as usize],
        solver.problem.route_end_port[route as usize],
    )
}

fn get_route_net_label(solver: &TinyHyperGraphSolver, route: RouteId) -> String {
    format!("net: {}", solver.problem.route_net[route as usize])
}

pub fn visualize_static_reachability_failure(
    solver: &TinyHyperGraphSolver,
    graphics: &mut GraphicsObject,
) -> () {
    for route in solver.get_statically_unroutable_routes() {
        let start_point = get_port_render_point(solver, route.start_port_id);
        let end_point = get_port_render_point(solver, route.end_port_id);
        let label = format_label(&[
            Some(format!(
                "static reachability failed: {}",
                route.connection_id
            )),
            Some(get_route_net_label(solver, route.route_id)),
            route
                .start_region_id
                .as_ref()
                .filter(|id| !id.is_empty())
                .map(|id| format!("startRegionId: {id}")),
            route
                .end_region_id
                .as_ref()
                .filter(|id| !id.is_empty())
                .map(|id| format!("endRegionId: {id}")),
            if route.point_ids.len() >= 2 {
                Some(format!("points: {}", route.point_ids.join(" -> ")))
            } else {
                None
            },
            Some(get_route_endpoint_z_label(solver, route.route_id)),
        ]);
        graphics["lines"].as_array_mut().unwrap().push(json!({
            "points": [start_point, end_point], "strokeColor": STATIC_REACHABILITY_TRACE_STROKE,
            "strokeDash": STATIC_REACHABILITY_TRACE_DASH, "label": label,
        }));

        for (port, endpoint) in [(route.start_port_id, "start"), (route.end_port_id, "end")] {
            graphics["circles"].as_array_mut().unwrap().push(json!({
                "center": get_port_render_point(solver, port), "radius": STATIC_REACHABILITY_TRACE_RADIUS,
                "fill": STATIC_REACHABILITY_TRACE_FILL, "stroke": STATIC_REACHABILITY_TRACE_STROKE,
                "layer": get_port_visualization_layer(solver, port),
                "label": format_label(&[Some(label.clone()), Some(format!("endpoint: {endpoint}")),
                    Some(get_port_identifier_label(solver, port)), Some(get_port_z_label(solver, port))]),
            }));
        }
    }
}
