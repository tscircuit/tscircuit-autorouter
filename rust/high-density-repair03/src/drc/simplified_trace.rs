use serde_json::Value;

#[derive(Clone)]
pub struct SimplifiedTrace {
    pub pcb_trace_id: String,
    pub connection_name: String,
    pub route: Vec<SimplifiedRoutePoint>,
}

#[derive(Clone)]
pub enum SimplifiedRoutePoint {
    Wire {
        x: f64,
        y: f64,
        width: Option<f64>,
        layer: String,
        start_pcb_port_id: Option<String>,
        end_pcb_port_id: Option<String>,
    },
    Via {
        x: f64,
        y: f64,
        from_layer: String,
        to_layer: String,
        via_diameter: Option<f64>,
        via_hole_diameter: Option<f64>,
    },
    Other(Value),
}

impl SimplifiedTrace {
    pub fn from_value(trace: &Value) -> Self {
        let route = trace["route"]
            .as_array()
            .expect("Expected trace route array");
        let route = route
            .iter()
            .map(|point| match point["route_type"].as_str() {
                Some("wire") => SimplifiedRoutePoint::Wire {
                    x: point["x"].as_f64().expect("Expected wire x"),
                    y: point["y"].as_f64().expect("Expected wire y"),
                    width: optional_number(&point["width"]),
                    layer: point["layer"]
                        .as_str()
                        .expect("Expected wire layer")
                        .to_owned(),
                    start_pcb_port_id: point["start_pcb_port_id"].as_str().map(str::to_owned),
                    end_pcb_port_id: point["end_pcb_port_id"].as_str().map(str::to_owned),
                },
                Some("via") => SimplifiedRoutePoint::Via {
                    x: point["x"].as_f64().expect("Expected via x"),
                    y: point["y"].as_f64().expect("Expected via y"),
                    from_layer: point["from_layer"]
                        .as_str()
                        .expect("Expected via from_layer")
                        .to_owned(),
                    to_layer: point["to_layer"]
                        .as_str()
                        .expect("Expected via to_layer")
                        .to_owned(),
                    via_diameter: optional_number(&point["via_diameter"]),
                    via_hole_diameter: point["via_hole_diameter"].as_f64(),
                },
                _ => SimplifiedRoutePoint::Other(point.clone()),
            })
            .collect();
        Self {
            pcb_trace_id: trace["pcb_trace_id"]
                .as_str()
                .expect("Expected pcb_trace_id")
                .to_owned(),
            connection_name: trace["connection_name"]
                .as_str()
                .expect("Expected connection_name")
                .to_owned(),
            route,
        }
    }
}

fn optional_number(value: &Value) -> Option<f64> {
    if value.is_null() {
        None
    } else {
        Some(value.as_f64().expect("Expected numeric trace field"))
    }
}
