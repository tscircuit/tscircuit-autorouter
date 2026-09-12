use crate::get_pcb_port_ids_connected_to_traces::get_pcb_port_ids_connected_to_trace;
use crate::is_point_in_pad::{is_point_in_pad, Pad};
use crate::pcb_connectivity_map::PcbConnectivityMap;
use crate::types::{encoded_number, point, Id, Math, Point, Port, RoutePoint, Trace};
use indexmap::{IndexMap, IndexSet};
use serde::Serialize;
use serde_json::{json, Value};

#[cfg_attr(feature = "wasm-types", derive(tsify::Tsify))]
#[cfg_attr(feature = "wasm-types", tsify(rename = "NativeContiguityError"))]
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorDescriptor {
    #[cfg_attr(feature = "wasm-types", tsify(type = "'misalignedVia' | 'missingConnection' | 'disconnectedEndpoint'"))]
    pub kind: &'static str,
    pub trace_index: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_trace_index: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub point_index: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port_index: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pad_index: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub center_point_index: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "wasm-types", tsify(type = "{ x: number | { $traceNumber: string }; y: number | { $traceNumber: string } }"))]
    pub center: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "wasm-types", tsify(type = "'start' | 'end'"))]
    pub endpoint: Option<&'static str>,
}
impl ErrorDescriptor {
    fn new(kind: &'static str, trace: &Trace, source: Option<usize>) -> Self {
        Self { kind, trace_index: trace.index, source_trace_index: source, point_index: None, port_index: None, pad_index: None, center_point_index: None, center: None, endpoint: None }
    }
}
struct SourceTrace { index: usize, id: Id, connected_ports: Vec<Id> }
struct IndexedPad { index: usize, pad: Pad }
type PadMap = IndexMap<Id, Vec<IndexedPad>>;

fn point_in_pads(point: Point, pads: &[IndexedPad], math: Math) -> Result<bool, String> {
    for pad in pads {
        if is_point_in_pad(point, &pad.pad, math)? { return Ok(true); }
    }
    Ok(false)
}
fn route_point_connects_to_another_expected_port(point: &RoutePoint, expected: &[&Port], missing: &Id, pads: &PadMap, math: Math) -> Result<bool, String> {
    if !point.wire { return Ok(false); }
    for port in expected {
        if !port.id.truthy() || &port.id == missing { continue; }
        if let Some(port_pads) = pads.get(&port.id) {
            if point_in_pads(point.position, port_pads, math)? { return Ok(true); }
        }
    }
    Ok(false)
}
fn get_missing_connection_error_center(trace: &Trace, port: &Port, expected: &[&Port], pads: &PadMap, math: Math) -> Result<(Option<usize>, Option<Value>), String> {
    let first = &trace.route[0];
    let last_index = trace.route.len() - 1;
    let last = &trace.route[last_index];
    let location = if first.references(&port.id) && first.wire { Some(0) }
    else if last.references(&port.id) && last.wire { Some(last_index) }
    else if route_point_connects_to_another_expected_port(first, expected, &port.id, pads, math)? && last.wire { Some(last_index) }
    else if route_point_connects_to_another_expected_port(last, expected, &port.id, pads, math)? && first.wire { Some(0) }
    else if first.wire && last.wire {
        if (math.hypot)(first.position.x - port.position.x, first.position.y - port.position.y) <= (math.hypot)(last.position.x - port.position.x, last.position.y - port.position.y) { Some(0) } else { Some(last_index) }
    } else if first.wire { Some(0) }
    else if last.wire { Some(last_index) }
    else { None };
    Ok(match location {
        Some(index) => (Some(index), None),
        None => (None, Some(json!({"x":encoded_number((first.center.x + last.center.x) / 2.0), "y":encoded_number((first.center.y + last.center.y) / 2.0)}))),
    })
}

pub fn check(circuit_json: &[Value], math: Math) -> Result<Vec<ErrorDescriptor>, String> {
    let mut ports = Vec::new();
    let mut traces = Vec::new();
    let mut sources = Vec::new();
    let mut smt_pads = Vec::new();
    let mut plated_holes = Vec::new();
    for (index, element) in circuit_json.iter().enumerate() {
        match element.get("type").and_then(Value::as_str) {
            Some("pcb_port") => ports.push(Port { index, id: Id::read(element.get("pcb_port_id")), source_id: Id::read(element.get("source_port_id")), position: point(element) }),
            Some("pcb_trace") => {
                let route = element.get("route").and_then(Value::as_array).ok_or_else(|| "PCB trace route must be an array".to_string())?;
                traces.push(Trace { index, id: Id::read(element.get("pcb_trace_id")), source_id: Id::read(element.get("source_trace_id")), route: route.iter().map(RoutePoint::read).collect() });
            }
            Some("source_trace") => sources.push(SourceTrace { index, id: Id::read(element.get("source_trace_id")), connected_ports: element.get("connected_source_port_ids").and_then(Value::as_array).map(|values| values.iter().map(|v| Id::read(Some(v))).collect()).unwrap_or_default() }),
            Some("pcb_smtpad") => smt_pads.push(index),
            Some("pcb_plated_hole") => plated_holes.push(index),
            _ => {}
        }
    }
    let connectivity = PcbConnectivityMap::new(&traces, &ports);
    let mut pads = PadMap::new();
    for index in smt_pads.into_iter().chain(plated_holes) {
        let element = &circuit_json[index];
        let id = Id::read(element.get("pcb_port_id"));
        if id.truthy() { pads.entry(id).or_default().push(IndexedPad { index, pad: Pad::read(element) }); }
    }
    let mut checked_sources = IndexSet::new();
    let mut errors = Vec::new();
    for trace in &traces {
        if trace.route.is_empty() { continue; }
        let first = &trace.route[0];
        let last = trace.route.last().unwrap();
        let source = sources.iter().find(|source| source.id == trace.source_id);
        let source_index = source.map(|s| s.index);
        let expected: Vec<&Port> = match source {
            Some(source) => ports.iter().filter(|port| source.connected_ports.contains(&port.source_id)).collect(),
            None => Vec::new(),
        };
        for i in 1..trace.route.len().saturating_sub(1) {
            let previous = &trace.route[i - 1];
            let current = &trace.route[i];
            let next = &trace.route[i + 1];
            if current.via && previous.wire && next.wire {
                let prev_aligned = (previous.position.x - current.position.x).abs() < 0.01 && (previous.position.y - current.position.y).abs() < 0.01;
                let next_aligned = (next.position.x - current.position.x).abs() < 0.01 && (next.position.y - current.position.y).abs() < 0.01;
                if !prev_aligned || !next_aligned {
                    let mut error = ErrorDescriptor::new("misalignedVia", trace, source_index);
                    error.point_index = Some(i);
                    errors.push(error);
                }
            }
        }
        if let Some(source) = source {
            if !expected.is_empty() && !checked_sources.insert(source.id.clone()) { continue; }
        }
        for port in &expected {
            if !port.id.truthy() { continue; }
            let Some(port_pads) = pads.get(&port.id) else { continue; };
            if port_pads.is_empty() { continue; }
            let mut connected = false;
            let mut candidates = connectivity.get_all_traces_connected_to_trace(&trace.id);
            candidates.extend(traces.iter().enumerate().filter(|(_, candidate)| source.is_some_and(|s| candidate.source_id == s.id)).map(|(index, _)| index));
            for candidate_index in candidates {
                let candidate = &traces[candidate_index];
                if candidate.id == trace.id { continue; }
                if !candidate.source_id.truthy() { continue; }
                let candidate_source = sources.iter().find(|s| s.id == candidate.source_id);
                if source.is_none() || (candidate.source_id != source.unwrap().id && !candidate_source.is_some_and(|s| s.connected_ports.contains(&port.source_id))) { continue; }
                if get_pcb_port_ids_connected_to_trace(candidate).contains(&port.id) {
                    connected = true;
                    break;
                }
                if let Some(point) = candidate.route.first() {
                    if point.wire && point_in_pads(point.position, port_pads, math)? { connected = true; break; }
                }
                if let Some(point) = candidate.route.last() {
                    if point.wire && point_in_pads(point.position, port_pads, math)? { connected = true; break; }
                }
            }
            if connected { continue; }
            let first_connected = first.wire && point_in_pads(first.position, port_pads, math)?;
            let last_connected = last.wire && point_in_pads(last.position, port_pads, math)?;
            if !first_connected && !last_connected {
                let (center_point_index, center) = get_missing_connection_error_center(trace, port, &expected, &pads, math)?;
                let mut error = ErrorDescriptor::new("missingConnection", trace, source_index);
                error.port_index = Some(port.index);
                error.pad_index = Some(port_pads[0].index);
                error.center_point_index = center_point_index;
                error.center = center;
                errors.push(error);
            }
        }
        if expected.is_empty() {
            let mut first_connected = false;
            let mut last_connected = false;
            let same = first.wire && last.wire && (first.position.x - last.position.x).abs() < 0.01 && (first.position.y - last.position.y).abs() < 0.01;
            for port_pads in pads.values() {
                if first.wire && point_in_pads(first.position, port_pads, math)? { first_connected = true; }
                if last.wire && point_in_pads(last.position, port_pads, math)? { last_connected = true; }
            }
            if !first_connected && first.wire {
                let mut error = ErrorDescriptor::new("disconnectedEndpoint", trace, source_index);
                error.endpoint = Some("start"); error.point_index = Some(0);
                errors.push(error);
            }
            if !last_connected && last.wire && !(same && !first_connected) {
                let mut error = ErrorDescriptor::new("disconnectedEndpoint", trace, source_index);
                error.endpoint = Some("end"); error.point_index = Some(trace.route.len() - 1);
                errors.push(error);
            }
        }
    }
    Ok(errors)
}
