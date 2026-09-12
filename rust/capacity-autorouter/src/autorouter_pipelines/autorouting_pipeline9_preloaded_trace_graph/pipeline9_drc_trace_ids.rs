use indexmap::{IndexMap,IndexSet};
use serde_json::{Value,json};
use crate::autorouter_pipelines::autorouting_pipeline9_preloaded_trace_graph::normalize_pipeline9_drc_errors_for_repair::{string_array,via_ids,trace_id_by_via_id};
use math_utils::js_number_to_string;

pub fn get_autorouting_via_elements(traces: &[Value]) -> Vec<Value> {
    get_autorouting_via_elements_from_traces(traces.iter())
}

pub fn get_autorouting_via_elements_from_traces<'a>(traces: impl Iterator<Item = &'a Value>) -> Vec<Value> {
    let mut locations=IndexSet::new(); let mut vias=Vec::new();
    for trace in traces { for p in trace["route"].as_array().expect("Trace route") {
        if p["route_type"]!="via" { continue; }
        let key=format!("{},{},{},{}",js_number_to_string(p["x"].as_f64().expect("Via x")),js_number_to_string(p["y"].as_f64().expect("Via y")),p["from_layer"].as_str().expect("Via layer"),p["to_layer"].as_str().expect("Via layer"));
        if locations.insert(key) { vias.push(json!({"type":"pcb_via","pcb_via_id":format!("via_{}",vias.len()),"pcb_trace_id":trace["pcb_trace_id"]})); }
    }} vias
}

pub fn add_autorouting_via_trace_ids(errors: &[Value], circuit: &[Value], evaluated: &IndexSet<String>) -> Vec<Value> {
    let by_via=trace_id_by_via_id(circuit);
    errors.iter().map(|error| {
        let explicit=via_ids(error); let primary=error["pcb_trace_id"].as_str().filter(|s|!s.is_empty());
        let encoded_pair=primary.and_then(|p|error["pcb_trace_error_id"].as_str().and_then(|id|id.strip_prefix(&format!("overlap_{p}_"))));
        let encoded_candidate=error["pcb_trace_error_id"].as_str().and_then(|id|id.rfind("_via_").map(|i|&id[i+1..])).filter(|id|id[4..].chars().all(|c|c.is_ascii_digit()) && id.len()>4);
        let mut vias:IndexSet<String>=explicit.iter().cloned().collect();
        if let Some(id)=encoded_candidate.filter(|id|explicit.is_empty() && by_via.contains_key(*id) && !encoded_pair.is_some_and(|p|!p.is_empty()&&evaluated.contains(p))) { vias.insert(id.to_owned()); }
        let traces:IndexSet<String>=error["pcb_trace_id"].as_str().map(str::to_owned).into_iter().chain(string_array(&error["pcb_trace_ids"])).chain(vias.iter().filter_map(|id|by_via.get(id)).filter(|s|!s.is_empty()).cloned()).collect();
        let mut result=error.clone(); if !vias.is_empty() { result["pcb_via_id"]=json!(vias.first().unwrap()); result["pcb_via_ids"]=json!(vias); if !traces.is_empty() { result["pcb_trace_ids"]=json!(traces); } } result
    }).collect()
}

pub fn remap_drc_trace_ids(errors: &[Value], mapping: &IndexMap<String,String>) -> Vec<Value> {
    errors.iter().map(|error| {
        let explicit=string_array(&error["pcb_trace_ids"]); let primary=error["pcb_trace_id"].as_str();
        let encoded=primary.filter(|s|!s.is_empty()).and_then(|p|error["pcb_trace_error_id"].as_str().and_then(|id|id.strip_prefix(&format!("overlap_{p}_"))));
        let vias=via_ids(error); let encoded_is_via=encoded.is_some_and(|id|vias.iter().any(|v|v==id));
        let mut groups:IndexMap<String,IndexSet<String>>=IndexMap::new();
        for id in primary.into_iter().chain(explicit.iter().map(String::as_str)).chain(encoded.filter(|_|!encoded_is_via)) { groups.entry(mapping.get(id).map(String::as_str).unwrap_or(id).to_owned()).or_default().insert(id.to_owned()); }
        let collapsed:Vec<_>=groups.into_iter().filter(|(_,ids)|ids.len()>1).map(|(id,ids)|json!({"solverTraceId":id,"evaluationTraceIds":ids})).collect();
        let mapped_primary=primary.filter(|s|!s.is_empty()).map(|id|mapping.get(id).map(String::as_str).unwrap_or(id));
        let mapped_explicit:Vec<_>=explicit.iter().map(|id|mapping.get(id).unwrap_or(id).clone()).collect();
        let mapped_encoded=encoded.filter(|s|!s.is_empty()).map(|id|if encoded_is_via {id} else {mapping.get(id).map(String::as_str).unwrap_or(id)});
        if mapped_primary==primary && mapped_explicit==explicit && mapped_encoded==encoded { return error.clone(); }
        let mut result=error.clone(); if primary.is_some_and(|s|!s.is_empty()) { result["pcb_trace_id"]=json!(mapped_primary); }
        if error["pcb_trace_ids"].is_array() { result["pcb_trace_ids"]=json!(mapped_explicit); }
        if let (Some(a),Some(b))=(mapped_primary.filter(|s|!s.is_empty()),mapped_encoded.filter(|s|!s.is_empty())) { result["pcb_trace_error_id"]=json!(format!("overlap_{a}_{b}")); }
        if !collapsed.is_empty() { result["__collapsed_trace_participants"]=json!(collapsed); } result
    }).collect()
}

pub fn get_autorouting_via_elements_from_typed_traces<'a>(traces: impl Iterator<Item = &'a high_density_repair03::drc::simplified_trace::SimplifiedTrace>) -> Vec<Value> {
    use high_density_repair03::drc::simplified_trace::SimplifiedRoutePoint;
    let mut locations = IndexSet::new();
    let mut vias = Vec::new();
    for trace in traces {
        for point in &trace.route {
            let SimplifiedRoutePoint::Via { x, y, from_layer, to_layer, .. } = point else { continue; };
            let key = format!("{},{},{},{}", js_number_to_string(*x), js_number_to_string(*y), from_layer, to_layer);
            if locations.insert(key) {
                vias.push(json!({"type":"pcb_via","pcb_via_id":format!("via_{}",vias.len()),"pcb_trace_id":trace.pcb_trace_id}));
            }
        }
    }
    vias
}
