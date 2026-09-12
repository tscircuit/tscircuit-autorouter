use autorouting_drc::simplified_trace::SimplifiedRoutePoint;
use serde_json::Value;
use crate::internal_types::{MutableRoute, RoutePoint};

fn layer_name(z: f64, layer_count: usize) -> String {
    if z == 0.0 { return "top".to_owned(); }
    if z == layer_count as f64 - 1.0 { return "bottom".to_owned(); }
    format!("inner{}", crate::filter_pipeline9_drc_errors_against_baseline::js_json(&Value::from(z)))
}

fn endpoint_port(point: &RoutePoint, connection_points: &[Value], layer_count: usize) -> Option<String> {
    if let Some(id) = point.metadata["pcb_port_id"].as_str().filter(|id| !id.is_empty()) { return Some(id.to_owned()); }
    let layer = layer_name(point.z, layer_count);
    connection_points.iter().find(|candidate| {
        candidate["pcb_port_id"].as_str().is_some_and(|id| !id.is_empty()) &&
        (candidate["x"].as_f64().expect("Connection point x") - point.x).abs() <= 1e-6 &&
        (candidate["y"].as_f64().expect("Connection point y") - point.y).abs() <= 1e-6 &&
        if candidate.get("layer").is_some() { candidate["layer"].as_str() == Some(&layer) }
        else { candidate["layers"].as_array().expect("Connection point layers").iter().any(|value| value.as_str() == Some(&layer)) }
    }).and_then(|point| point["pcb_port_id"].as_str().map(str::to_owned))
}

pub fn convert_hd_route_to_simplified_route(route: &MutableRoute, layer_count: usize, width: f64, via_diameter: Option<f64>, connection_points: &[Value]) -> Vec<SimplifiedRoutePoint> {
    if route.route.is_empty() { return Vec::new(); }
    let first = route.route[0].borrow();
    let last = route.route.last().unwrap().borrow();
    let start_port = endpoint_port(&first, connection_points, layer_count);
    let end_port = endpoint_port(&last, connection_points, layer_count);
    let mut result = vec![SimplifiedRoutePoint::Wire {
        x: first.x, y: first.y, width: Some(width), layer: layer_name(first.z, layer_count),
        start_pcb_port_id: start_port,
        end_pcb_port_id: if route.route.len() == 1 { end_port.clone() } else { None },
    }];
    for index in 1..route.route.len() {
        let previous = route.route[index - 1].borrow();
        let current = route.route[index].borrow();
        if previous.z != current.z && previous.x == current.x && previous.y == current.y {
            result.push(SimplifiedRoutePoint::Via {
                x: current.x, y: current.y, from_layer: layer_name(previous.z, layer_count), to_layer: layer_name(current.z, layer_count),
                via_diameter: via_diameter.filter(|value| *value != 0.0 && !value.is_nan()), via_hole_diameter: None,
            });
        }
        result.push(SimplifiedRoutePoint::Wire {
            x: current.x, y: current.y, width: Some(width), layer: layer_name(current.z, layer_count), start_pcb_port_id: None,
            end_pcb_port_id: if index == route.route.len() - 1 { end_port.clone() } else { None },
        });
    }
    result
}
