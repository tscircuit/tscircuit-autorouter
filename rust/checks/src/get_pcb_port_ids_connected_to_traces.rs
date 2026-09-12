use crate::types::{Id, RoutePoint, Trace};
use indexmap::IndexSet;

pub fn get_pcb_port_ids_connected_to_route_point(point: &RoutePoint) -> Vec<&Id> {
    if !point.wire { return Vec::new(); }
    [&point.start_port, &point.end_port].into_iter().filter(|id| id.truthy()).collect()
}
pub fn get_pcb_port_ids_connected_to_trace(trace: &Trace) -> IndexSet<&Id> {
    let mut connected_ports = IndexSet::new();
    for point in &trace.route {
        for port in get_pcb_port_ids_connected_to_route_point(point) {
            connected_ports.insert(port);
        }
    }
    connected_ports
}
