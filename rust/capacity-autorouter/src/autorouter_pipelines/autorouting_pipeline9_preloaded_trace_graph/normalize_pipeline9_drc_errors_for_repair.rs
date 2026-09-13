use indexmap::{IndexMap, IndexSet};
use serde_json::{Value, json};

pub fn string_array(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

pub fn via_ids(error: &Value) -> Vec<String> {
    let mut ids = IndexSet::new();
    if let Some(id) = error["pcb_via_id"].as_str() {
        ids.insert(id.to_owned());
    }
    ids.extend(string_array(&error["pcb_via_ids"]));
    ids.into_iter().collect()
}

pub fn trace_id_by_via_id(circuit: &[Value]) -> IndexMap<String, String> {
    circuit
        .iter()
        .filter_map(|element| {
            if element["type"] != "pcb_via" {
                return None;
            }
            Some((
                element["pcb_via_id"].as_str()?.to_owned(),
                element["pcb_trace_id"].as_str()?.to_owned(),
            ))
        })
        .collect()
}

pub fn normalize_pipeline9_drc_errors_for_repair(
    errors: &[Value],
    circuit: &[Value],
    new_ids: &IndexSet<String>,
) -> Vec<Value> {
    let via_map = trace_id_by_via_id(circuit);
    errors
        .iter()
        .map(|error| {
            let primary = error["pcb_trace_id"].as_str();
            let explicit = string_array(&error["pcb_trace_ids"]);
            let vias = via_ids(error);
            if let (Some(primary), Some(error_id)) = (
                primary.filter(|s| !s.is_empty()),
                error["pcb_trace_error_id"].as_str(),
            ) {
                let encoded = error_id.strip_prefix(&format!("overlap_{primary}_"));
                let encoded_is_via = encoded.is_some_and(|id| {
                    vias.iter().any(|v| v == id)
                        || (via_map.contains_key(id) && !explicit.iter().any(|v| v == id))
                });
                let other = explicit
                    .iter()
                    .find(|id| id.as_str() != primary && new_ids.contains(*id))
                    .map(String::as_str)
                    .or_else(|| encoded.filter(|id| !id.is_empty() && !encoded_is_via));
                if let Some(other) = other.filter(|id| {
                    !new_ids.contains(primary) && vias.is_empty() && new_ids.contains(*id)
                }) {
                    let ids: IndexSet<_> = [other.to_owned(), primary.to_owned()]
                        .into_iter()
                        .chain(explicit.iter().cloned())
                        .collect();
                    let mut result = error.clone();
                    result["pcb_trace_id"] = json!(other);
                    result["pcb_trace_ids"] = json!(ids);
                    result["pcb_trace_error_id"] = json!(format!("overlap_{other}_{primary}"));
                    return result;
                }
            }
            let mapped: IndexSet<_> = vias
                .iter()
                .filter_map(|id| via_map.get(id))
                .filter(|id| !id.is_empty())
                .cloned()
                .collect();
            let via_traces: Vec<_> = if !mapped.is_empty() {
                mapped.into_iter().collect()
            } else {
                explicit
                    .iter()
                    .filter(|id| Some(id.as_str()) != primary)
                    .cloned()
                    .collect()
            };
            let movable = via_traces.iter().find(|id| new_ids.contains(*id)).cloned();
            let mut result = error.clone();
            if let Some(movable) =
                movable.filter(|_| primary.is_none_or(|id| id.is_empty() || !new_ids.contains(id)))
            {
                let ids: IndexSet<_> = std::iter::once(movable.clone())
                    .chain(primary.filter(|id| !id.is_empty()).map(str::to_owned))
                    .chain(explicit)
                    .chain(via_traces)
                    .collect();
                result["pcb_trace_id"] = json!(movable);
                result["pcb_trace_ids"] = json!(ids);
                if let Some(via) = vias.first() {
                    result["pcb_via_id"] = json!(via);
                } else {
                    result.as_object_mut().unwrap().shift_remove("pcb_via_id");
                }
                result["pcb_via_ids"] = json!(vias);
            } else if !vias.is_empty() {
                let ids: IndexSet<_> = primary
                    .filter(|id| !id.is_empty())
                    .map(str::to_owned)
                    .into_iter()
                    .chain(explicit)
                    .chain(via_traces)
                    .collect();
                result["pcb_trace_ids"] = json!(ids);
                result["pcb_via_id"] = json!(vias[0]);
                result["pcb_via_ids"] = json!(vias);
            }
            result
        })
        .collect()
}
