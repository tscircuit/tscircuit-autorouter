use indexmap::{IndexMap, IndexSet};
use serde_json::{Value, json};

use json_bindings::js_json::js_json;

fn normalize_prepared_trace_ids(value: &str, aliases: &IndexMap<String, String>) -> String {
    let mut sorted: Vec<_> = aliases.iter().collect();
    sorted.sort_by_key(|entry| std::cmp::Reverse(entry.0.len()));
    let mut result = value.to_owned();
    for (prepared, original) in sorted {
        result = result.replace(prepared, original);
    }
    result
}

fn get_drc_error_identity(error: &Value, aliases: &IndexMap<String, String>) -> Option<String> {
    let error_type = error
        .get("type")
        .filter(|v| !v.is_null())
        .or_else(|| error.get("error_type").filter(|v| !v.is_null()))
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    if error_type == "pcb_via_clearance_error" {
        let mut ids = IndexSet::new();
        if let Some(id) = error["pcb_trace_id"].as_str() {
            ids.insert(normalize_prepared_trace_ids(id, aliases));
        }
        if let Some(values) = error["pcb_trace_ids"].as_array() {
            for id in values.iter().filter_map(Value::as_str) {
                ids.insert(normalize_prepared_trace_ids(id, aliases));
            }
        }
        let mut ids: Vec<_> = ids.into_iter().collect();
        ids.sort();
        let center = if error["center"].is_object() {
            &error["center"]
        } else {
            &error["pcb_center"]
        };
        let (Some(x), Some(y), Some(relation)) = (
            center["x"].as_f64(),
            center["y"].as_f64(),
            error["pcb_via_pair_net_relation"].as_str(),
        ) else {
            return None;
        };
        if ids.is_empty() {
            return None;
        }
        return Some(format!(
            "pcb_via_clearance_error:{}",
            js_json(&json!({"traceIds": ids, "center": {"x":x,"y":y}, "netRelation":relation}))
        ));
    }
    for key in [
        "pcb_trace_error_id",
        "pcb_error_id",
        "pcb_via_trace_clearance_error_id",
        "pcb_pad_trace_clearance_error_id",
    ] {
        if let Some(id) = error[key].as_str() {
            return Some(format!(
                "{error_type}:{}",
                normalize_prepared_trace_ids(id, aliases)
            ));
        }
    }
    let mut fields: Vec<_> = error
        .as_object()
        .expect("DRC error object")
        .iter()
        .filter(|(key, value)| {
            (key.ends_with("_id") || key.ends_with("_ids"))
                && (value.is_string() || value.is_array())
        })
        .collect();
    fields.sort_by(|a, b| a.0.cmp(b.0));
    let mut identity = serde_json::Map::new();
    for (key, value) in fields {
        identity.insert(
            key.clone(),
            value
                .as_str()
                .map(|s| Value::from(normalize_prepared_trace_ids(s, aliases)))
                .unwrap_or_else(|| value.clone()),
        );
    }
    Some(format!(
        "{error_type}:{}",
        js_json(&Value::Object(identity))
    ))
}

pub fn filter_pipeline9_drc_errors_against_baseline(
    errors: &[Value],
    baseline: &[Value],
    aliases: &IndexMap<String, String>,
) -> Vec<Value> {
    let baseline_ids: IndexSet<_> = baseline
        .iter()
        .filter(|error| {
            !error["pcb_trace_error_id"]
                .as_str()
                .is_some_and(|id| id.starts_with("missing_connection_"))
        })
        .filter_map(|error| get_drc_error_identity(error, &IndexMap::new()))
        .collect();
    errors
        .iter()
        .filter(|error| {
            get_drc_error_identity(error, aliases).is_none_or(|id| !baseline_ids.contains(&id))
        })
        .cloned()
        .collect()
}
