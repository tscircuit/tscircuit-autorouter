use crate::core::TinyHyperGraphSolver;
use crate::graphics::GraphicsObject;
use crate::layer_labels::{get_available_z_from_mask, get_z_layer_label};
use crate::types::{PortId, RegionId, RouteId};
use crate::visualize_static_reachability_failure::{
    get_statically_unroutable_route_ids, visualize_static_reachability_failure,
};
use serde_json::{Value, json};
use std::collections::{BTreeSet, HashMap, HashSet};

const BOTTOM_LAYER_TRACE_COLOR: &str = "rgba(52, 152, 219, 0.95)";
const BOTTOM_LAYER_TRACE_DASH: &str = "3 2";
const TRANSITION_CROSSING_COLOR: &str = "rgba(22, 160, 133, 0.95)";
const TRANSITION_CROSSING_DASH: &str = "2 4 2";
const REGION_RECT_GAP: f64 = 0.05;
const PORT_LAYER_COORDINATE_OFFSET: f64 = 0.005;
const HOT_REGION_FILL: RgbaColor = RgbaColor {
    r: 255.0,
    g: 64.0,
    b: 64.0,
    a: 0.72,
};
const NEVER_ROUTED_ENDPOINT_STROKE: &str = "rgba(220, 38, 38, 0.98)";
const NEVER_ROUTED_ENDPOINT_FILL: &str = "rgba(220, 38, 38, 0.12)";
const NEVER_ROUTED_ENDPOINT_RADIUS: f64 = 1.0;
const NEVER_ROUTED_ENDPOINT_DASH: &str = "10 6";
const NON_CENTER_BUS_TRACE_OPACITY: f64 = 0.5;

#[derive(Clone, Copy)]
struct RgbaColor {
    r: f64,
    g: f64,
    b: f64,
    a: f64,
}

#[derive(Clone, Debug, Default)]
pub struct TinyHyperGraphVisualizationOptions {
    pub highlight_section_mask: bool,
    pub section_port_mask: Option<Vec<i32>>,
    pub show_initial_route_hints: Option<bool>,
    pub show_only_section_ports_on_idle: bool,
    // Explicit counterparts of the source's bus solver duck typing.
    pub center_route_id: Option<RouteId>,
    pub additional_region_labels: Option<HashMap<RegionId, String>>,
    pub show_unassigned_ports_in_visualization: bool,
}

#[derive(Clone, Copy)]
struct Bounds {
    min_x: f64,
    max_x: f64,
    min_y: f64,
    max_y: f64,
}

fn format_label(lines: &[Option<String>]) -> String {
    lines
        .iter()
        .filter_map(Option::as_ref)
        .filter(|line| !line.is_empty())
        .cloned()
        .collect::<Vec<_>>()
        .join("\n")
}

#[expect(
    clippy::manual_clamp,
    reason = "Preserve the existing min/max behavior for NaN inputs."
)]
fn clamp01(value: f64) -> f64 {
    value.max(0.0).min(1.0)
}

fn mix_color_channel(from: f64, to: f64, amount: f64) -> f64 {
    (from + (to - from) * amount + 0.5).floor()
}

fn mix_color(base: RgbaColor, overlay: RgbaColor, amount: f64) -> RgbaColor {
    RgbaColor {
        r: mix_color_channel(base.r, overlay.r, amount),
        g: mix_color_channel(base.g, overlay.g, amount),
        b: mix_color_channel(base.b, overlay.b, amount),
        a: ((base.a + (overlay.a - base.a) * amount) * 1000.0).round() / 1000.0,
    }
}

fn to_rgba_string(color: RgbaColor) -> String {
    format!("rgba({}, {}, {}, {})", color.r, color.g, color.b, color.a)
}

fn get_route_label(solver: &TinyHyperGraphSolver, route: RouteId) -> String {
    let metadata = solver
        .problem
        .route_metadata
        .as_ref()
        .and_then(|m| m.get(route as usize));
    metadata
        .and_then(|m| {
            m.get("connectionId")
                .filter(|v| !v.is_null())
                .or_else(|| m.get("mutuallyConnectedNetworkId"))
        })
        .filter(|v| !v.is_null())
        .map(|v| {
            v.as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| v.to_string())
        })
        .unwrap_or_else(|| format!("route-{route}"))
}

fn get_route_color(solver: &TinyHyperGraphSolver, route: RouteId, alpha: f64) -> String {
    let hash_source = format!(
        "{}:{}",
        solver.problem.route_net[route as usize],
        get_route_label(solver, route)
    );
    let mut hash = 0.0_f64;

    for code in hash_source.encode_utf16() {
        // Only the shift coerces to int32 in JavaScript; keep the sum as a Number.
        let int_hash = (hash.trunc().rem_euclid(4294967296.0) as u32) as i32;
        hash = code as f64 * 17777.0 + (int_hash.wrapping_shl(5) as f64 - hash);
    }

    format!("hsla({}, 70%, 50%, {alpha})", hash.abs() % 360.0)
}

fn is_bus_visualization_solver(options: &TinyHyperGraphVisualizationOptions) -> bool {
    options.center_route_id.is_some()
}

fn should_show_bus_unassigned_ports(options: &TinyHyperGraphVisualizationOptions) -> bool {
    is_bus_visualization_solver(options) && options.show_unassigned_ports_in_visualization
}

fn get_route_opacity(options: &TinyHyperGraphVisualizationOptions, route: RouteId) -> f64 {
    match options.center_route_id {
        None => 1.0,
        Some(center) if center == route => 1.0,
        Some(_) => NON_CENTER_BUS_TRACE_OPACITY,
    }
}

fn scale_color_alpha(color: &str, opacity: f64) -> String {
    if !(color.starts_with("rgba(") || color.starts_with("hsla(")) || !color.ends_with(')') {
        return color.into();
    }

    let Some(comma) = color.rfind(',') else {
        return color.into();
    };
    let text = color[comma + 1..color.len() - 1].trim();
    if text.is_empty() || !text.chars().all(|c| c.is_ascii_digit() || c == '.') {
        return color.into();
    }

    let Ok(alpha) = text.parse::<f64>() else {
        return color.into();
    };
    let scaled = (clamp01(alpha * opacity) * 1000.0).round() / 1000.0;
    format!("{}, {scaled})", &color[..comma])
}

fn get_rendered_route_color(
    solver: &TinyHyperGraphSolver,
    options: &TinyHyperGraphVisualizationOptions,
    route: RouteId,
    alpha: f64,
) -> String {
    get_route_color(solver, route, alpha * get_route_opacity(options, route))
}

fn get_route_net_label(solver: &TinyHyperGraphSolver, route: RouteId) -> String {
    format!("net: {}", solver.problem.route_net[route as usize])
}

fn get_region_bounds(solver: &TinyHyperGraphSolver, region: RegionId) -> Bounds {
    let i = region as usize;
    let metadata = solver
        .topology
        .region_metadata
        .as_ref()
        .and_then(|m| m.get(i));
    if let Some(polygon) = metadata
        .and_then(|m| m.get("polygon"))
        .and_then(Value::as_array)
        .filter(|p| p.len() >= 3)
    {
        return Bounds {
            min_x: polygon
                .iter()
                .map(|p| p["x"].as_f64().unwrap())
                .fold(f64::INFINITY, f64::min),
            max_x: polygon
                .iter()
                .map(|p| p["x"].as_f64().unwrap())
                .fold(f64::NEG_INFINITY, f64::max),
            min_y: polygon
                .iter()
                .map(|p| p["y"].as_f64().unwrap())
                .fold(f64::INFINITY, f64::min),
            max_y: polygon
                .iter()
                .map(|p| p["y"].as_f64().unwrap())
                .fold(f64::NEG_INFINITY, f64::max),
        };
    }

    if let Some(bounds) = metadata.and_then(|m| m.get("bounds"))
        && let (Some(min_x), Some(max_x), Some(min_y), Some(max_y)) = (
            bounds["minX"].as_f64(),
            bounds["maxX"].as_f64(),
            bounds["minY"].as_f64(),
            bounds["maxY"].as_f64(),
        )
    {
        return Bounds {
            min_x,
            max_x,
            min_y,
            max_y,
        };
    }

    let width = solver.topology.region_width[i];
    let height = solver.topology.region_height[i];
    let x = solver.topology.region_center_x[i];
    let y = solver.topology.region_center_y[i];
    Bounds {
        min_x: x - width / 2.0,
        max_x: x + width / 2.0,
        min_y: y - height / 2.0,
        max_y: y + height / 2.0,
    }
}

fn get_region_center(solver: &TinyHyperGraphSolver, region: RegionId) -> Value {
    json!({"x": solver.topology.region_center_x[region as usize], "y": solver.topology.region_center_y[region as usize]})
}

fn get_region_visualization_layer(solver: &TinyHyperGraphSolver, region: RegionId) -> String {
    let i = region as usize;
    let metadata = solver
        .topology
        .region_metadata
        .as_ref()
        .and_then(|m| m.get(i));
    if let Some(layers) = metadata
        .and_then(|m| m.get("availableZ"))
        .and_then(Value::as_array)
        && let Some(layer) = get_z_layer_label(layers)
    {
        return layer;
    }

    let mask = solver
        .topology
        .region_available_z_mask
        .as_ref()
        .and_then(|m| m.get(i))
        .copied()
        .unwrap_or(0);
    let mask_layers: Vec<_> = get_available_z_from_mask(mask)
        .into_iter()
        .map(|z| json!(z))
        .collect();
    if !mask_layers.is_empty() {
        return get_z_layer_label(&mask_layers).unwrap_or_else(|| "z0".into());
    }

    let incident: Vec<_> = solver
        .topology
        .region_incident_ports
        .get(i)
        .into_iter()
        .flatten()
        .map(|port| json!(solver.topology.port_z[*port as usize]))
        .collect();
    get_z_layer_label(&incident).unwrap_or_else(|| "z0".into())
}

fn get_region_cost_label(
    solver: &TinyHyperGraphSolver,
    region: RegionId,
    options: &TinyHyperGraphVisualizationOptions,
) -> String {
    let i = region as usize;
    let cache = solver.state.region_intersection_caches.get(i);
    let cost = cache.map(|c| c.existing_region_cost).unwrap_or(0.0);
    let congestion = solver
        .state
        .region_congestion_cost
        .get(i)
        .copied()
        .unwrap_or(0.0);
    let net = solver.problem.region_net_id[i];
    let net_label = if net == -1 {
        "free".into()
    } else {
        net.to_string()
    };
    format_label(&[
        Some(format!("region: region-{region}")),
        Some(format!("net: {net_label}")),
        options
            .additional_region_labels
            .as_ref()
            .and_then(|labels| labels.get(&region))
            .cloned()
            .or_else(|| solver.get_additional_region_label(region)),
        Some(format!("cost: {cost:.3}")),
        Some(format!("congestion: {congestion:.3}")),
        Some(format!(
            "same layer X: {}",
            cache
                .map(|c| c.existing_same_layer_intersections)
                .unwrap_or(0)
        )),
        Some(format!(
            "trans X: {}",
            cache
                .map(|c| c.existing_crossing_layer_intersections)
                .unwrap_or(0)
        )),
        Some(format!(
            "entry exit X: {}",
            cache
                .map(|c| c.existing_entry_exit_layer_changes)
                .unwrap_or(0)
        )),
    ])
}

fn get_base_region_fill_color(solver: &TinyHyperGraphSolver, region: RegionId) -> RgbaColor {
    let metadata = solver
        .topology
        .region_metadata
        .as_ref()
        .and_then(|m| m.get(region as usize));
    if metadata
        .and_then(|m| m.get("isConnectionRegion"))
        .and_then(Value::as_bool)
        == Some(true)
    {
        return RgbaColor {
            r: 255.0,
            g: 100.0,
            b: 255.0,
            a: 0.6,
        };
    }

    if metadata
        .and_then(|m| m.get("isThroughJumper"))
        .and_then(Value::as_bool)
        == Some(true)
    {
        return RgbaColor {
            r: 100.0,
            g: 200.0,
            b: 100.0,
            a: 0.5,
        };
    }

    if metadata
        .and_then(|m| m.get("isPad"))
        .and_then(Value::as_bool)
        == Some(true)
    {
        return RgbaColor {
            r: 255.0,
            g: 200.0,
            b: 100.0,
            a: 0.5,
        };
    }

    if metadata
        .and_then(|m| m.get("layer"))
        .and_then(Value::as_str)
        == Some("bottom")
    {
        return RgbaColor {
            r: 52.0,
            g: 152.0,
            b: 219.0,
            a: 0.08,
        };
    }

    RgbaColor {
        r: 200.0,
        g: 200.0,
        b: 255.0,
        a: 0.1,
    }
}

fn get_region_rect_fill(solver: &TinyHyperGraphSolver, region: RegionId) -> String {
    let base = get_base_region_fill_color(solver, region);
    let cost = clamp01(
        solver
            .state
            .region_intersection_caches
            .get(region as usize)
            .map(|c| c.existing_region_cost)
            .unwrap_or(0.0),
    );
    to_rgba_string(mix_color(base, HOT_REGION_FILL, cost.powf(0.8)))
}

fn get_port_point(solver: &TinyHyperGraphSolver, port: PortId) -> (f64, f64) {
    (
        solver.topology.port_x[port as usize],
        solver.topology.port_y[port as usize],
    )
}

fn get_port_render_point(solver: &TinyHyperGraphSolver, port: PortId) -> Value {
    let (x, y) = get_port_point(solver, port);
    let offset = solver.topology.port_z[port as usize] as f64 * PORT_LAYER_COORDINATE_OFFSET;
    json!({ "x": x + offset, "y": y + offset })
}
use get_port_render_point as get_port_circle_center;

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

fn get_port_connection_label(solver: &TinyHyperGraphSolver, port: PortId) -> String {
    let incident = solver.topology.incident_port_region.get(port as usize);
    let r1 = incident
        .and_then(|r| r.first())
        .map(i32::to_string)
        .unwrap_or_else(|| "?".into());
    let r2 = incident
        .and_then(|r| r.get(1))
        .map(i32::to_string)
        .unwrap_or_else(|| "?".into());
    format!("connects: region-{r1} <-> region-{r2}")
}

fn get_port_net_label(
    solver: &TinyHyperGraphSolver,
    port: PortId,
    route: Option<RouteId>,
) -> Option<String> {
    if let Some(route) = route {
        return Some(format!("net: {}", solver.problem.route_net[route as usize]));
    }

    let assigned = solver.state.port_assignment[port as usize];
    if assigned >= 0 {
        return Some(format!("net: {assigned}"));
    }

    let mut nets = BTreeSet::new();

    for route in 0..solver.problem.route_count {
        if solver.problem.route_start_port[route] == port
            || solver.problem.route_end_port[route] == port
        {
            nets.insert(solver.problem.route_net[route]);
        }
    }

    if nets.is_empty() {
        return None;
    }

    Some(format!(
        "net: {}",
        nets.iter()
            .map(i32::to_string)
            .collect::<Vec<_>>()
            .join(", ")
    ))
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

fn get_port_label(solver: &TinyHyperGraphSolver, port: PortId, route: Option<RouteId>) -> String {
    format_label(&[
        Some(get_port_identifier_label(solver, port)),
        Some(get_port_connection_label(solver, port)),
        get_port_net_label(solver, port, route),
    ])
}

fn get_highlighted_section_port_mask<'a>(
    solver: &'a TinyHyperGraphSolver,
    options: &'a TinyHyperGraphVisualizationOptions,
) -> Option<&'a [i32]> {
    if !options.highlight_section_mask {
        return None;
    }

    let mask = options
        .section_port_mask
        .as_ref()
        .unwrap_or(&solver.problem.port_section_mask);
    if mask.len() != solver.topology.port_count {
        return None;
    }

    let section_count = mask.iter().filter(|v| **v == 1).count();
    if section_count == 0 || section_count == mask.len() {
        return None;
    }

    Some(mask)
}

fn get_section_region_ids(solver: &TinyHyperGraphSolver, mask: &[i32]) -> Vec<RegionId> {
    let mut regions = Vec::new();
    let mut seen = HashSet::new();

    for (port, &in_section) in mask.iter().enumerate() {
        if in_section != 1 {
            continue;
        }

        for &region in solver
            .topology
            .incident_port_region
            .get(port)
            .into_iter()
            .flatten()
        {
            if seen.insert(region) {
                regions.push(region);
            }
        }
    }

    regions
}

fn get_segment_style(
    solver: &TinyHyperGraphSolver,
    options: &TinyHyperGraphVisualizationOptions,
    route: RouteId,
    p1: PortId,
    p2: PortId,
) -> Value {
    let z1 = solver.topology.port_z[p1 as usize];
    let z2 = solver.topology.port_z[p2 as usize];
    if z1 != z2 {
        return json!({"strokeColor": scale_color_alpha(TRANSITION_CROSSING_COLOR, get_route_opacity(options, route)), "strokeDash": TRANSITION_CROSSING_DASH});
    }

    if z1 > 0 {
        return json!({"strokeColor": scale_color_alpha(BOTTOM_LAYER_TRACE_COLOR, get_route_opacity(options, route)), "strokeDash": BOTTOM_LAYER_TRACE_DASH});
    }

    json!({"strokeColor": get_rendered_route_color(solver, options, route, 0.8)})
}

fn push_solved_region_segments(
    solver: &TinyHyperGraphSolver,
    graphics: &mut GraphicsObject,
    options: &TinyHyperGraphVisualizationOptions,
) {
    for (region, segments) in solver.state.region_segments.iter().enumerate() {
        for &(route, p1, p2) in segments {
            let mut line = json!({"points": [get_port_render_point(solver,p1), get_port_render_point(solver,p2)],
                "label": format_label(&[Some(format!("route: {}", get_route_label(solver,route))), Some(format!("region: region-{region}")), Some(get_port_pair_z_label(solver,p1,p2))]),
                "layer": get_port_visualization_layer(solver,p1)});
            line.as_object_mut().unwrap().extend(
                get_segment_style(solver, options, route, p1, p2)
                    .as_object()
                    .unwrap()
                    .clone(),
            );
            graphics["lines"].as_array_mut().unwrap().push(line);
        }
    }
}

fn push_route_port_z_points(
    solver: &TinyHyperGraphSolver,
    graphics: &mut GraphicsObject,
    options: &TinyHyperGraphVisualizationOptions,
) {
    let mut seen = HashSet::new();

    for segments in &solver.state.region_segments {
        for &(route, p1, p2) in segments {
            for port in [p1, p2] {
                if !seen.insert((route, port)) {
                    continue;
                }

                let point = get_port_render_point(solver, port);
                graphics["points"].as_array_mut().unwrap().push(json!({"x": point["x"], "y": point["y"],
                    "color": get_rendered_route_color(solver,options,route,1.0), "layer": get_port_visualization_layer(solver,port),
                    "label": format_label(&[Some(format!("route: {}",get_route_label(solver,route))), Some(get_port_identifier_label(solver,port)),
                        get_port_net_label(solver,port,Some(route)), Some(get_port_z_label(solver,port))])}));
            }
        }
    }
}

fn is_route_endpoint_port(solver: &TinyHyperGraphSolver, port: PortId) -> bool {
    for route in 0..solver.problem.route_count {
        if solver.problem.route_start_port[route] == port
            || solver.problem.route_end_port[route] == port
        {
            return true;
        }
    }

    false
}

fn push_unassigned_port_circles(solver: &TinyHyperGraphSolver, graphics: &mut GraphicsObject) {
    for i in 0..solver.topology.port_count {
        let port = i as i32;
        if solver.state.port_assignment[i] >= 0 || is_route_endpoint_port(solver, port) {
            continue;
        }

        graphics["circles"].as_array_mut().unwrap().push(json!({"center": get_port_circle_center(solver,port), "radius":0.04,
            "fill": if solver.topology.port_z[i]>0 {"rgba(52, 152, 219, 0.2)"} else {"rgba(128, 128, 128, 0.2)"},
            "stroke": if solver.topology.port_z[i]>0 {"rgba(52, 152, 219, 0.6)"} else {"rgba(128, 128, 128, 0.6)"},
            "layer":get_port_visualization_layer(solver,port),
            "label":format_label(&[Some(get_port_label(solver,port,None)),Some(get_port_z_label(solver,port)),Some("state: unassigned".into())])}));
    }
}

fn push_initial_route_hints(
    solver: &TinyHyperGraphSolver,
    graphics: &mut GraphicsObject,
    routes: Option<&HashSet<RouteId>>,
    options: &TinyHyperGraphVisualizationOptions,
) {
    for i in 0..solver.problem.route_count {
        let route = i as i32;
        if routes.is_some_and(|set| !set.contains(&route)) {
            continue;
        }

        let start = solver.problem.route_start_port[i];
        let end = solver.problem.route_end_port[i];
        let p1 = get_port_render_point(solver, start);
        let p2 = get_port_render_point(solver, end);
        let label = format_label(&[
            Some(get_route_label(solver, route)),
            Some(get_route_endpoint_z_label(solver, route)),
        ]);
        graphics["lines"].as_array_mut().unwrap().push(json!({"points":[p1,p2],"strokeColor":get_rendered_route_color(solver,options,route,0.8),
            "strokeDash":"3 3","layer":get_port_visualization_layer(solver,start),"label":label}));
        graphics["points"].as_array_mut().unwrap().push(json!({"x":(p1["x"].as_f64().unwrap()+p2["x"].as_f64().unwrap())/2.0,
            "y":(p1["y"].as_f64().unwrap()+p2["y"].as_f64().unwrap())/2.0,"color":get_rendered_route_color(solver,options,route,1.0),
            "layer":get_port_visualization_layer(solver,start),"label":label}));
    }
}

fn push_route_endpoints(
    solver: &TinyHyperGraphSolver,
    graphics: &mut GraphicsObject,
    routes: Option<&HashSet<RouteId>>,
    options: &TinyHyperGraphVisualizationOptions,
) {
    for i in 0..solver.problem.route_count {
        let route = i as i32;
        if routes.is_some_and(|set| !set.contains(&route)) {
            continue;
        }

        for (port, endpoint) in [
            (solver.problem.route_start_port[i], "start"),
            (solver.problem.route_end_port[i], "end"),
        ] {
            let point = get_port_render_point(solver, port);
            graphics["points"].as_array_mut().unwrap().push(json!({"x":point["x"],"y":point["y"],"color":get_rendered_route_color(solver,options,route,0.8),
                "layer":get_port_visualization_layer(solver,port),"label":format_label(&[Some(format!("route: {}",get_route_label(solver,route))),
                    Some(get_route_net_label(solver,route)),Some(format!("endpoint: {endpoint}")),Some(get_port_identifier_label(solver,port)),Some(get_port_z_label(solver,port))])}));
        }
    }
}

fn push_active_route(
    solver: &TinyHyperGraphSolver,
    graphics: &mut GraphicsObject,
    options: &TinyHyperGraphVisualizationOptions,
) {
    let Some(route) = solver.state.current_route_id else {
        return;
    };
    if solver.solved {
        return;
    }

    let start = solver.problem.route_start_port[route as usize];
    let end = solver.problem.route_end_port[route as usize];
    graphics["lines"].as_array_mut().unwrap().push(json!({"points":[get_port_render_point(solver,start),get_port_render_point(solver,end)],
        "strokeColor":get_rendered_route_color(solver,options,route,0.8),"strokeDash":"10 5",
        "label":format_label(&[Some(get_route_label(solver,route)),Some(get_route_endpoint_z_label(solver,route))])}));
}

fn push_candidates(
    solver: &TinyHyperGraphSolver,
    graphics: &mut GraphicsObject,
    options: &TinyHyperGraphVisualizationOptions,
) {
    if solver.solved {
        return;
    }

    let route = solver.state.current_route_id;
    let mut candidates = solver.state.candidate_queue.to_array();
    candidates.sort_by(|left, right| {
        left.f
            .partial_cmp(&right.f)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    candidates.truncate(10);

    for (i, candidate) in candidates.iter().enumerate() {
        let point = get_port_render_point(solver, candidate.port_id);
        graphics["points"].as_array_mut().unwrap().push(json!({"x":point["x"],"y":point["y"],"color":if i==0 {"green"} else {"rgba(128, 128, 128, 0.25)"},
            "layer":get_port_visualization_layer(solver,candidate.port_id),"label":format_label(&[Some(get_port_label(solver,candidate.port_id,route)),
                Some(get_port_z_label(solver,candidate.port_id)),Some(format!("g: {:.2}",candidate.g)),Some(format!("h: {:.2}",candidate.h)),Some(format!("f: {:.2}",candidate.f))])}));
    }

    let Some(next) = candidates.first() else {
        return;
    };
    let mut path = Vec::new();
    let mut cursor = Some(next);

    while let Some(candidate) = cursor {
        path.push(get_port_render_point(solver, candidate.port_id));
        cursor = candidate.prev_candidate.as_deref();
    }

    path.reverse();
    if path.len() > 1 {
        graphics["lines"].as_array_mut().unwrap().push(json!({"points":path,
            "strokeColor":route.map(|r|get_rendered_route_color(solver,options,r,0.8)).unwrap_or_else(||"rgba(0, 160, 120, 0.9)".into())}));
    }
}

fn push_section_mask_overlay(
    solver: &TinyHyperGraphSolver,
    graphics: &mut GraphicsObject,
    mask: &[i32],
    options: &TinyHyperGraphVisualizationOptions,
) {
    let stroke = "rgba(245, 158, 11, 0.95)";
    let fill = "rgba(245, 158, 11, 0.08)";

    for region in get_section_region_ids(solver, mask) {
        let polygon = solver
            .topology
            .region_metadata
            .as_ref()
            .and_then(|m| m.get(region as usize))
            .and_then(|m| m.get("polygon"))
            .and_then(Value::as_array)
            .filter(|p| p.len() >= 3);
        let bounds = get_region_bounds(solver, region);
        let layer = get_region_visualization_layer(solver, region);
        let label = format_label(&[
            Some("section region".into()),
            Some(get_region_cost_label(solver, region, options)),
        ]);
        if let Some(polygon) = polygon {
            graphics["polygons"].as_array_mut().unwrap().push(json!({"points":polygon,"fill":fill,"stroke":stroke,"strokeWidth":2,"layer":layer,"label":label}));
        } else {
            graphics["rects"].as_array_mut().unwrap().push(json!({"center":get_region_center(solver,region),
                "width":(bounds.max_x-bounds.min_x-REGION_RECT_GAP).max(0.05),"height":(bounds.max_y-bounds.min_y-REGION_RECT_GAP).max(0.05),
                "fill":fill,"stroke":stroke,"layer":layer,"label":label}));
        }
    }

    for (i, &in_section) in mask.iter().enumerate() {
        if in_section != 1 {
            continue;
        }

        let port = i as i32;
        graphics["circles"].as_array_mut().unwrap().push(json!({"center":get_port_circle_center(solver,port),"radius":0.07,
            "fill":"rgba(251, 191, 36, 0.18)","stroke":stroke,"layer":get_port_visualization_layer(solver,port),
            "label":format_label(&[Some(get_port_label(solver,port,None)),Some(get_port_z_label(solver,port)),Some("section port".into())])}));
    }
}

fn push_never_successfully_routed_endpoints(
    solver: &TinyHyperGraphSolver,
    graphics: &mut GraphicsObject,
) {
    if !solver.failed {
        return;
    }

    for summary in solver.get_never_successfully_routed_routes() {
        let route = &summary.route;
        let label = format_label(&[
            Some(format!("never routed: {}", route.connection_id)),
            Some(format!("attempts: {}", summary.attempts)),
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
        ]);

        for (port, endpoint) in [(route.start_port_id, "start"), (route.end_port_id, "end")] {
            let point = get_port_circle_center(solver, port);
            graphics["lines"].as_array_mut().unwrap().push(json!({"points":[{"x":0,"y":0},point],"strokeColor":NEVER_ROUTED_ENDPOINT_STROKE,
                "strokeDash":NEVER_ROUTED_ENDPOINT_DASH,"layer":get_port_visualization_layer(solver,port),
                "label":format_label(&[Some(label.clone()),Some("origin guide".into()),Some(format!("endpoint: {endpoint}"))])}));
            graphics["circles"].as_array_mut().unwrap().push(json!({"center":point,"radius":NEVER_ROUTED_ENDPOINT_RADIUS,
                "fill":NEVER_ROUTED_ENDPOINT_FILL,"stroke":NEVER_ROUTED_ENDPOINT_STROKE,"layer":get_port_visualization_layer(solver,port),
                "label":format_label(&[Some(label.clone()),Some(format!("endpoint: {endpoint}")),Some(get_port_identifier_label(solver,port)),Some(get_port_z_label(solver,port))])}));
        }
    }
}

pub fn visualize_tiny_hyper_graph(
    solver: &TinyHyperGraphSolver,
    options: TinyHyperGraphVisualizationOptions,
) -> GraphicsObject {
    let mut graphics = json!({"arrows":[],"circles":[],"infiniteLines":[],"lines":[],"points":[],"polygons":[],"rects":[],"texts":[],
        "title":"Tiny HyperGraph","coordinateSystem":"cartesian"});
    let section_mask = get_highlighted_section_port_mask(solver, &options);
    let static_routes = get_statically_unroutable_route_ids(solver);

    for i in 0..solver.topology.region_count {
        let region = i as i32;
        let polygon = solver
            .topology
            .region_metadata
            .as_ref()
            .and_then(|m| m.get(i))
            .and_then(|m| m.get("polygon"))
            .and_then(Value::as_array)
            .filter(|p| p.len() >= 3);
        let bounds = get_region_bounds(solver, region);
        let layer = get_region_visualization_layer(solver, region);
        if let Some(polygon) = polygon {
            graphics["polygons"].as_array_mut().unwrap().push(json!({"points":polygon,"fill":to_rgba_string(get_base_region_fill_color(solver,region)),"layer":layer}));
        } else {
            graphics["rects"].as_array_mut().unwrap().push(json!({"center":get_region_center(solver,region),
                "width":(bounds.max_x-bounds.min_x-REGION_RECT_GAP).max(0.05),"height":(bounds.max_y-bounds.min_y-REGION_RECT_GAP).max(0.05),
                "fill":get_region_rect_fill(solver,region),"layer":layer,"label":get_region_cost_label(solver,region,&options)}));
        }
    }

    push_route_endpoints(solver, &mut graphics, static_routes.as_ref(), &options);
    if solver.iterations == 0 {
        for key in ["polygons", "rects"] {
            for shape in graphics[key].as_array_mut().unwrap() {
                shape["stroke"] = json!("rgba(128, 128, 128, 0.5)");
            }
        }
    }

    if solver.iterations == 0 {
        for i in 0..solver.topology.port_count {
            let is_section = section_mask.and_then(|m| m.get(i)).copied() == Some(1);
            if options.show_only_section_ports_on_idle && !is_section {
                continue;
            }

            let port = i as i32;
            graphics["circles"].as_array_mut().unwrap().push(json!({"center":get_port_circle_center(solver,port),"radius":0.05,
                "fill":if solver.topology.port_z[i]>0 {"rgba(52, 152, 219, 0.55)"} else {"rgba(128, 128, 128, 0.5)"},
                "layer":get_port_visualization_layer(solver,port),"label":format_label(&[Some(get_port_label(solver,port,None)),Some(get_port_z_label(solver,port))])}));
        }

        if static_routes.is_some() {
            visualize_static_reachability_failure(solver, &mut graphics);
        } else {
            let assigned: HashSet<_> = solver
                .state
                .region_segments
                .iter()
                .flatten()
                .map(|segment| segment.0)
                .collect();
            if !assigned.is_empty() {
                push_solved_region_segments(solver, &mut graphics, &options);
                push_route_port_z_points(solver, &mut graphics, &options);
            }

            if options.show_initial_route_hints != Some(false) {
                let mut pending: HashSet<_> =
                    solver.state.unrouted_routes.iter().copied().collect();
                if let Some(route) = solver.state.current_route_id {
                    pending.insert(route);
                }

                push_initial_route_hints(solver, &mut graphics, Some(&pending), &options);
            }
        }
    } else {
        push_solved_region_segments(solver, &mut graphics, &options);
        push_route_port_z_points(solver, &mut graphics, &options);
        if should_show_bus_unassigned_ports(&options) {
            push_unassigned_port_circles(solver, &mut graphics);
        }

        if !is_bus_visualization_solver(&options) {
            push_active_route(solver, &mut graphics, &options);
            push_candidates(solver, &mut graphics, &options);
        }
    }

    if let Some(mask) = section_mask {
        push_section_mask_overlay(solver, &mut graphics, mask, &options);
    }

    push_never_successfully_routed_endpoints(solver, &mut graphics);
    let pending =
        solver.state.unrouted_routes.len() + usize::from(solver.state.current_route_id.is_some());
    let mut title = vec![
        "Tiny HyperGraph".into(),
        format!("iter={}", solver.iterations),
        format!("pending={pending}"),
    ];
    if let Some(mask) = section_mask {
        title.push(format!(
            "sectionPorts={}",
            mask.iter().filter(|v| **v == 1).count()
        ));
    }

    if let Some(routes) = static_routes {
        title.push(format!("staticReachabilityFailed={}", routes.len()));
    }

    title.push(
        if solver.failed {
            "failed"
        } else if solver.solved {
            "solved"
        } else {
            "running"
        }
        .into(),
    );
    graphics["title"] = json!(title.join(" | "));
    graphics
}
pub use visualize_tiny_hyper_graph as visualize_tiny_graph;
