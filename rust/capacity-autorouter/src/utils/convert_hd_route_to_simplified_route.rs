use crate::solvers::trace_width_solver::is_obstacle_connected_to_route::are_ids_connected;
use high_density_repair03::drc::simplified_trace::SimplifiedRoutePoint;
use high_density_repair03::solvers::global_drc_force_improve_solver::internal_types::{
    MutableRoute, RoutePoint,
};
use high_density_repair03::solvers::global_drc_force_improve_solver::net_utils::RepairConnectivityMap;
use math_utils::{js_max, js_min};
use serde_json::{Value, json};

pub struct ConvertOptions<'a> {
    pub connection_points: &'a [Value],
    pub terminal_via_attach_tolerance: f64,
    pub default_via_hole_diameter: Option<f64>,
    pub obstacles: &'a [Value],
    pub connected_multilayer_obstacles: Option<&'a [Value]>,
    pub conn_map: Option<&'a RepairConnectivityMap>,
}

pub fn number(v: &Value) -> f64 {
    v.as_f64().expect("Required number")
}

pub fn layer(z: f64, count: usize) -> String {
    if z == 0.0 {
        "top".to_owned()
    } else if z == (count - 1) as f64 {
        "bottom".to_owned()
    } else {
        format!("inner{}", math_utils::js_number_to_string(z))
    }
}

fn distance(a: (f64, f64), b: (f64, f64)) -> f64 {
    let dx = a.0 - b.0;
    let dy = a.1 - b.1;
    (dx * dx + dy * dy).sqrt()
}

pub fn is_multilayer(obstacle: &Value) -> bool {
    obstacle
        .get("__zLayers")
        .filter(|v| !v.is_null())
        .or_else(|| obstacle.get("layers"))
        .and_then(Value::as_array)
        .is_some_and(|a| a.len() > 1)
}

fn inside(point: &RoutePoint, obstacle: &Value) -> bool {
    let cx = number(&obstacle["center"]["x"]);
    let cy = number(&obstacle["center"]["y"]);
    let w = number(&obstacle["width"]) / 2.0;
    let h = number(&obstacle["height"]) / 2.0;
    let closest = (
        js_max(cx - w, js_min(cx + w, point.x)),
        js_max(cy - h, js_min(cy + h, point.y)),
    );
    distance((point.x, point.y), closest) <= 1e-6
}

pub(crate) fn obstacle_connected_to_mutable_route(
    obstacle: &Value,
    route: &MutableRoute,
    conn_map: Option<&RepairConnectivityMap>,
) -> bool {
    let name = route.connection_name.as_str();
    let root = route.root_connection_name.as_deref();
    obstacle["connectedTo"]
        .as_array()
        .expect("Obstacle connectedTo")
        .iter()
        .filter_map(Value::as_str)
        .any(|id| {
            id == name
                || Some(id) == root
                || (conn_map.is_some()
                    && (are_ids_connected(name, id, conn_map)
                        || root.is_some_and(|root| are_ids_connected(root, id, conn_map))))
        })
}

fn through(
    route: &MutableRoute,
    start: &RoutePoint,
    end: &RoutePoint,
    opts: &ConvertOptions,
) -> bool {
    if start.metadata["toNextSegmentType"] == "through_obstacle" {
        return true;
    }
    if let Some(obstacles) = opts.connected_multilayer_obstacles {
        return obstacles.iter().any(|o| inside(start, o) && inside(end, o));
    }
    opts.obstacles.iter().any(|o| {
        is_multilayer(o)
            && inside(start, o)
            && inside(end, o)
            && obstacle_connected_to_mutable_route(o, route, opts.conn_map)
    })
}

fn width(point: &RoutePoint, route: &MutableRoute) -> Option<f64> {
    point
        .metadata
        .get("traceThickness")
        .filter(|v| !v.is_null())
        .unwrap_or(&route.metadata["traceThickness"])
        .as_f64()
}

fn wire(x: f64, y: f64, width: Option<f64>, layer: String) -> SimplifiedRoutePoint {
    SimplifiedRoutePoint::Wire {
        x,
        y,
        width,
        layer,
        start_pcb_port_id: None,
        end_pcb_port_id: None,
    }
}

fn nearest_terminal<'a>(
    endpoint: &RoutePoint,
    endpoint_layer: &str,
    opts: &'a ConvertOptions,
) -> Option<&'a Value> {
    let mut nearest: Option<(&Value, f64)> = None;
    for point in opts.connection_points {
        if point.get("layer").is_none()
            || point["terminalVia"].is_null()
            || point["terminalVia"] == false
            || point["layer"] != endpoint_layer
        {
            continue;
        }
        let d = distance(
            (number(&point["x"]), number(&point["y"])),
            (endpoint.x, endpoint.y),
        );
        if d > opts.terminal_via_attach_tolerance {
            continue;
        }
        if nearest.is_none_or(|(_, best)| d < best) {
            nearest = Some((point, d));
        }
    }
    nearest.map(|(point, _)| point)
}

fn terminal_via(
    point: &Value,
    route: &MutableRoute,
    opts: &ConvertOptions,
) -> SimplifiedRoutePoint {
    SimplifiedRoutePoint::Via {
        x: number(&point["x"]),
        y: number(&point["y"]),
        from_layer: point["layer"].as_str().expect("Terminal layer").to_owned(),
        to_layer: point["terminalVia"]["toLayer"]
            .as_str()
            .expect("Terminal via layer")
            .to_owned(),
        via_diameter: point["terminalVia"]
            .get("viaDiameter")
            .filter(|v| !v.is_null())
            .unwrap_or(&route.metadata["viaDiameter"])
            .as_f64(),
        via_hole_diameter: opts.default_via_hole_diameter,
    }
}

fn terminal_is_attached(wire: &SimplifiedRoutePoint, point: &Value) -> bool {
    match wire {
        SimplifiedRoutePoint::Wire { x, y, layer, .. } => {
            point["layer"] == layer.as_str()
                && distance((*x, *y), (number(&point["x"]), number(&point["y"]))) <= 1e-3
        }
        _ => false,
    }
}

fn attach_terminal_vias(
    result: Vec<SimplifiedRoutePoint>,
    hd: &MutableRoute,
    count: usize,
    opts: &ConvertOptions,
) -> Vec<SimplifiedRoutePoint> {
    if result.is_empty()
        || hd.route.is_empty()
        || opts.connection_points.is_empty()
        || !opts
            .connection_points
            .iter()
            .any(|p| p.get("layer").is_some() && p["terminalVia"].is_object())
    {
        return result;
    }
    let (linear, jumpers): (Vec<_>, Vec<_>) = result.into_iter().partition(
        |p| !matches!(p, SimplifiedRoutePoint::Other(value) if value["route_type"] == "jumper"),
    );
    if linear.is_empty() {
        return jumpers;
    }
    let start = hd.route[0].borrow();
    let end = hd.route.last().unwrap().borrow();
    let mut before = Vec::new();
    let mut after = Vec::new();
    if let Some(p) = nearest_terminal(&start, &layer(start.z, count), opts) {
        before.push(terminal_via(p, hd, opts));
        if !terminal_is_attached(&linear[0], p) {
            before.push(wire(
                number(&p["x"]),
                number(&p["y"]),
                width(&start, hd),
                p["layer"].as_str().unwrap().to_owned(),
            ));
        }
    }
    if let Some(p) = nearest_terminal(&end, &layer(end.z, count), opts) {
        if !terminal_is_attached(linear.last().unwrap(), p) {
            after.push(wire(
                number(&p["x"]),
                number(&p["y"]),
                width(&end, hd),
                p["layer"].as_str().unwrap().to_owned(),
            ));
        }
        after.push(terminal_via(p, hd, opts));
    }
    before.extend(linear);
    before.extend(after);
    before.extend(jumpers);
    before
}

pub fn route_point_to_value(point: &SimplifiedRoutePoint) -> Value {
    match point {
        SimplifiedRoutePoint::Wire {
            x,
            y,
            width,
            layer,
            start_pcb_port_id,
            end_pcb_port_id,
        } => {
            let mut value = json!({"route_type":"wire","x":x,"y":y,"width":width,"layer":layer});
            if let Some(id) = start_pcb_port_id {
                value["start_pcb_port_id"] = json!(id);
            }
            if let Some(id) = end_pcb_port_id {
                value["end_pcb_port_id"] = json!(id);
            }
            value
        }
        SimplifiedRoutePoint::Via {
            x,
            y,
            from_layer,
            to_layer,
            via_diameter,
            via_hole_diameter,
        } => {
            let mut value = json!({"route_type":"via","x":x,"y":y,"from_layer":from_layer,"to_layer":to_layer,"via_diameter":via_diameter});
            if let Some(diameter) = via_hole_diameter {
                value["via_hole_diameter"] = json!(diameter);
            }
            value
        }
        SimplifiedRoutePoint::Other(value) => value.clone(),
    }
}

pub fn convert_hd_route_to_simplified_route(
    hd: &Value,
    count: usize,
    opts: &ConvertOptions,
) -> Vec<Value> {
    let route = MutableRoute::from_value(hd);
    convert_mutable_hd_route_to_simplified_route(&route, count, opts)
        .iter()
        .map(route_point_to_value)
        .collect()
}

pub fn convert_mutable_hd_route_to_simplified_route(
    hd: &MutableRoute,
    count: usize,
    opts: &ConvertOptions,
) -> Vec<SimplifiedRoutePoint> {
    let points = &hd.route;
    let mut result = Vec::new();
    if points.is_empty() {
        return result;
    }
    let mut current: Vec<usize> = Vec::new();
    let mut z = points[0].borrow().z;
    for (index, point) in points.iter().enumerate() {
        let point = point.borrow();
        let next_z = point.z;
        if next_z != z {
            let previous = current.last().copied();
            let current_layer = layer(z, count);
            let next_layer = layer(next_z, count);
            for &index in &current {
                let p = points[index].borrow();
                result.push(wire(p.x, p.y, width(&p, hd), current_layer.clone()));
            }
            if previous.is_some_and(|index| through(hd, &points[index].borrow(), &point, opts)) {
                let p = points[previous.unwrap()].borrow();
                let mut segment = json!({"route_type":"through_obstacle","start":{"x":p.x,"y":p.y},"end":{"x":point.x,"y":point.y},"from_layer":current_layer,"to_layer":next_layer,"width":width(&p,hd)});
                if let Some(meta) = p
                    .metadata
                    .get("toNextSegmentCircuitJsonMetadata")
                    .filter(|v| !v.is_null() && **v != false)
                {
                    segment["circuitJsonMetadata"] = meta.clone();
                }
                result.push(SimplifiedRoutePoint::Other(segment));
            } else if hd.vias.iter().any(|v| {
                (number(&v["x"]) - point.x).abs() < 0.001
                    && (number(&v["y"]) - point.y).abs() < 0.001
            }) {
                result.push(SimplifiedRoutePoint::Via {
                    x: point.x,
                    y: point.y,
                    from_layer: current_layer,
                    to_layer: next_layer,
                    via_diameter: hd.metadata["viaDiameter"].as_f64(),
                    via_hole_diameter: opts.default_via_hole_diameter,
                });
            }
            current = vec![index];
            z = next_z;
        } else if current.last().is_none_or(|&index| {
            let previous = points[index].borrow();
            !((previous.x - point.x).abs() <= 1e-12 && (previous.y - point.y).abs() <= 1e-12)
        }) {
            current.push(index);
        }
    }
    for index in current {
        let p = points[index].borrow();
        result.push(wire(p.x, p.y, width(&p, hd), layer(z, count)));
    }
    if let Some(jumpers) = hd.metadata["jumpers"].as_array() {
        for jumper in jumpers {
            result.push(SimplifiedRoutePoint::Other(json!({"route_type":"jumper","start":jumper["start"],"end":jumper["end"],"footprint":jumper["footprint"],"layer":layer(points[0].borrow().z,count)})));
        }
    }
    attach_terminal_vias(result, hd, count, opts)
}
