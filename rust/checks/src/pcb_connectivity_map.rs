use crate::connectivity_map::ConnectivityMap;
use crate::find_connected_networks::find_connected_networks;
use crate::line_intersections::does_line_intersect_line;
use crate::types::{Id, Port, Trace};
use indexmap::IndexMap;

pub struct PcbConnectivityMap {
    trace_id_to_elm: IndexMap<Id, usize>,
    conn_map: ConnectivityMap,
}
impl PcbConnectivityMap {
    pub fn new(traces: &[Trace], ports: &[Port]) -> Self {
        let mut trace_id_to_elm = IndexMap::new();
        let mut port_id_to_elm = IndexMap::new();
        for (index, trace) in traces.iter().enumerate() {
            trace_id_to_elm.insert(trace.id.clone(), index);
        }
        for (index, port) in ports.iter().enumerate() {
            port_id_to_elm.insert(port.id.clone(), index);
        }
        let mut connections = Vec::new();
        for i in 0..trace_id_to_elm.len() {
            for j in i + 1..trace_id_to_elm.len() {
                let (id1, index1) = trace_id_to_elm.get_index(i).unwrap();
                let (id2, index2) = trace_id_to_elm.get_index(j).unwrap();
                if are_pcb_traces_connected(&traces[*index1], &traces[*index2]) {
                    connections.push([id1.clone(), id2.clone()]);
                }
            }
        }
        for port_index in port_id_to_elm.values() {
            let port = &ports[*port_index];
            for trace_index in trace_id_to_elm.values() {
                let trace = &traces[*trace_index];
                for point in &trace.route {
                    if point.wire {
                        if point.start_port == port.id {
                            connections.push([port.id.clone(), trace.id.clone()]);
                        } else if point.end_port == port.id {
                            connections.push([trace.id.clone(), port.id.clone()]);
                        }
                    }
                }
            }
        }
        Self {
            trace_id_to_elm,
            conn_map: ConnectivityMap::new(find_connected_networks(&connections)),
        }
    }
    pub fn get_all_traces_connected_to_trace(&self, id: &Id) -> Vec<usize> {
        match self.conn_map.get_net_connected_to_id(id) {
            Some(net) => self
                .conn_map
                .get_ids_connected_to_net(net)
                .into_iter()
                .flatten()
                .filter_map(|id| self.trace_id_to_elm.get(id).copied())
                .collect(),
            None => Vec::new(),
        }
    }
}
fn are_pcb_traces_connected(trace1: &Trace, trace2: &Trace) -> bool {
    for i in 0..trace1.route.len().saturating_sub(1) {
        let a = &trace1.route[i];
        let b = &trace1.route[i + 1];
        if !a.wire {
            continue;
        }
        if !b.wire {
            continue;
        }
        for j in 0..trace2.route.len().saturating_sub(1) {
            let c = &trace2.route[j];
            let d = &trace2.route[j + 1];
            if !c.wire {
                continue;
            }
            if !d.wire {
                continue;
            }
            if does_line_intersect_line(
                [a.position, b.position],
                [c.position, d.position],
                (a.width + c.width) / 2.0,
            ) {
                return true;
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::RoutePoint;
    use serde_json::json;

    #[test]
    fn duplicate_ids_keep_first_map_order_and_last_geometry_without_layer_filter() {
        let make = |index, id: &str, x: f64, y: f64| Trace {
            index,
            id: Id::String(id.into()),
            source_id: Id::Missing,
            route: vec![
                RoutePoint::read(
                    &json!({"route_type":"wire","x":x,"y":y,"width":0.2,"layer":"top"}),
                ),
                RoutePoint::read(
                    &json!({"route_type":"wire","x":x+1.0,"y":y,"width":0.2,"layer":"bottom"}),
                ),
            ],
        };
        let traces = vec![
            make(0, "constructor", 100.0, 100.0),
            make(1, "b", 0.5, 0.0),
            make(2, "constructor", 0.0, 0.0),
            make(3, "__proto__", 0.75, 0.0),
        ];
        let map = PcbConnectivityMap::new(&traces, &[]);
        assert_eq!(
            map.get_all_traces_connected_to_trace(&Id::String("constructor".into())),
            vec![2, 1, 3]
        );
        assert!(
            map.get_all_traces_connected_to_trace(&Id::String("__proto__".into()))
                .is_empty()
        );
    }
}
