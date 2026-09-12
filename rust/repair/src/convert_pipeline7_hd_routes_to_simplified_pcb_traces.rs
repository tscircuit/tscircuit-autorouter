use indexmap::IndexMap;
use serde_json::{Value,json};
use crate::convert_hd_route_to_simplified_route::{ConvertOptions,convert_mutable_hd_route_to_simplified_route,route_point_to_value,is_multilayer,obstacle_connected_to_mutable_route};
use crate::internal_types::MutableRoute;
use autorouting_drc::simplified_trace::SimplifiedTrace;
use crate::net_utils::RepairConnectivityMap;

pub struct ConvertedPipeline7Trace {
    pub trace: SimplifiedTrace,
    connection_index: usize,
}

pub struct Pipeline7Converter {
    prepared: Vec<(Value,Vec<Value>,Value)>,
    multilayer_obstacles: Vec<Value>,
    connected: IndexMap<(String,Option<String>),Vec<Value>>,
    pub layer_count: usize,
    pub default_via_hole_diameter: f64,
}
impl Pipeline7Converter {
    pub fn new(connections: &[Value], original: &[Value], obstacles: &[Value], layer_count: usize, default_via_hole_diameter: f64) -> Self {
        let mut net_names = IndexMap::new();
        for c in original { net_names.entry(c["name"].as_str().expect("Connection name").to_owned()).or_insert_with(|| c["__netConnectionName"].clone()); }
        let prepared = connections.iter().map(|connection| {
            let points = connection["pointsToConnect"].as_array().expect("Connection points"); assert_eq!(points.len(),2,"Pipeline7 output connection requires two points");
            let connects = points.iter().filter_map(|p|p["pointId"].as_str().filter(|s|!s.is_empty()).map(Value::from)).collect();
            let name = connection["name"].as_str().expect("Connection name");
            let output = connection.get("__netConnectionName").filter(|v|!v.is_null()).or_else(||net_names.get(name).filter(|v|!v.is_null())).or_else(||connection["__rootConnectionNames"].get(0).filter(|v|!v.is_null())).unwrap_or(&connection["name"]).clone();
            (connection.clone(),connects,output)
        }).collect();
        Self { prepared, multilayer_obstacles: obstacles.iter().filter(|o|is_multilayer(o)).cloned().collect(), connected: IndexMap::new(), layer_count, default_via_hole_diameter }
    }
    pub fn convert<'a>(&mut self, routes: impl IntoIterator<Item = &'a Value>, conn: Option<&RepairConnectivityMap>) -> Vec<Value> {
        let routes: Vec<_> = routes.into_iter().map(MutableRoute::from_value).collect();
        self.convert_typed(routes.iter(), conn).into_iter().map(|converted| {
            let (_, connects, output) = &self.prepared[converted.connection_index];
            json!({"type":"pcb_trace","pcb_trace_id":converted.trace.pcb_trace_id,
                "connection_name":output,"connectsTo":connects,
                "route":converted.trace.route.iter().map(route_point_to_value).collect::<Vec<_>>()})
        }).collect()
    }

    pub fn convert_typed<'a>(&mut self, routes: impl IntoIterator<Item = &'a MutableRoute>, conn: Option<&RepairConnectivityMap>) -> Vec<ConvertedPipeline7Trace> {
        let mut by_name: IndexMap<&str, Vec<&MutableRoute>> = IndexMap::new();
        for route in routes {
            by_name.entry(&route.connection_name).or_default().push(route);
        }
        let mut traces = Vec::new();
        for (connection_index, (connection, _, output)) in self.prepared.iter().enumerate() {
            let name = connection["name"].as_str().unwrap();
            let Some(routes) = by_name.get(name) else { continue; };
            for (index, route) in routes.iter().enumerate() {
                let key = (route.connection_name.clone(), route.root_connection_name.clone());
                let connected = self.connected.entry(key).or_insert_with(|| {
                    self.multilayer_obstacles.iter()
                        .filter(|o| obstacle_connected_to_mutable_route(o, route, conn))
                        .cloned().collect()
                });
                let converted = convert_mutable_hd_route_to_simplified_route(route, self.layer_count, &ConvertOptions {
                    connection_points: connection["pointsToConnect"].as_array().unwrap(),
                    terminal_via_attach_tolerance: 0.25,
                    default_via_hole_diameter: Some(self.default_via_hole_diameter),
                    obstacles: &[], connected_multilayer_obstacles: Some(connected), conn_map: conn,
                });
                traces.push(ConvertedPipeline7Trace {
                    connection_index,
                    trace: SimplifiedTrace {
                        pcb_trace_id: format!("{name}_{index}"),
                        connection_name: output.as_str().expect("Output connection name").to_owned(),
                        route: converted,
                    },
                });
            }
        }
        traces
    }
}
