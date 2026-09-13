use crate::solvers::global_drc_force_improve_solver::internal_types::Point;
use crate::solvers::global_drc_force_improve_solver::solver_config::js_round;
use crate::solvers::global_drc_force_improve_solver::types::{DrcSnapshot, Routes};
use indexmap::IndexMap;
use serde_json::{Value, json};
use std::collections::HashSet;

pub fn get_drc_error_type(error: &Value) -> Option<&str> {
    error["type"]
        .as_str()
        .or_else(|| error["error_type"].as_str())
}

pub fn is_trace_obstacle_drc_error(error: &Value) -> bool {
    if get_drc_error_type(error) == Some("pcb_pad_trace_clearance_error") {
        return true;
    }
    let message = error["message"].as_str().unwrap_or("").to_lowercase();
    (message.contains("pcb_trace") || message.contains("pcb trace"))
        && ["pcb_smtpad", "pcb_plated_hole", "pcb_hole", "pcb_keepout"]
            .iter()
            .any(|kind| message.contains(kind))
}

fn message_number(message: &str, prefix: &str) -> Option<f64> {
    let mut remaining = message;
    while let Some(index) = remaining.find(prefix) {
        let candidate = &remaining[index + prefix.len()..];
        let bytes = candidate.as_bytes();
        let mut end = usize::from(bytes.first() == Some(&b'-'));
        let digit_start = end;
        while end < bytes.len() && bytes[end].is_ascii_digit() {
            end += 1;
        }
        if end > digit_start {
            if end + 1 < bytes.len() && bytes[end] == b'.' && bytes[end + 1].is_ascii_digit() {
                end += 1;
                while end < bytes.len() && bytes[end].is_ascii_digit() {
                    end += 1;
                }
            }
            if candidate[end..].starts_with("mm") {
                return candidate[..end].parse().ok();
            }
        }
        remaining = candidate;
    }
    None
}

pub fn get_drc_error_severity(error: &Value) -> f64 {
    let message = error["message"].as_str().unwrap_or("");
    let gap = message_number(message, "gap: ");
    let required = message_number(message, "required: ");
    if let (Some(gap), Some(required)) = (gap, required)
        && gap.is_finite()
        && required.is_finite()
    {
        return (required - gap).max(0.0);
    }
    if let Some(gap) = gap
        && gap.is_finite()
    {
        return (0.1 - gap).max(0.0);
    }
    1.0
}

fn js_number(value: Option<&Value>) -> f64 {
    match value {
        None => f64::NAN,
        Some(Value::Null) => 0.0,
        Some(Value::Bool(value)) => {
            if *value {
                1.0
            } else {
                0.0
            }
        }
        Some(Value::Number(value)) => value.as_f64().unwrap(),
        Some(Value::String(value)) if value.trim().is_empty() => 0.0,
        Some(Value::String(value)) => value.trim().parse().unwrap_or(f64::NAN),
        Some(Value::Array(value)) if value.is_empty() => 0.0,
        Some(Value::Array(value)) if value.len() == 1 => js_number(value.first()),
        _ => f64::NAN,
    }
}

pub fn get_topology_repair_drc_error_severity(error: &Value) -> f64 {
    let minimum = js_number(error.get("minimum_clearance"));
    let actual = js_number(error.get("worst_actual_clearance"));
    if minimum.is_finite() && actual.is_finite() {
        (minimum - actual).max(0.0)
    } else {
        get_drc_error_severity(error)
    }
}

pub fn get_drc_issue_score(errors: &[Value]) -> f64 {
    errors
        .iter()
        .fold(0.0, |score, error| score + get_drc_error_severity(error))
}

pub fn snapshot_from_result(
    srj: &Value,
    routes: &Routes,
    result: Value,
    topology: bool,
    legacy: bool,
) -> DrcSnapshot {
    let mut trace_route_index_by_id = IndexMap::new();
    let mut grouped: IndexMap<&str, Vec<usize>> = IndexMap::new();
    for (index, route) in routes.iter().enumerate() {
        grouped
            .entry(&route.connection_name)
            .or_default()
            .push(index);
    }
    for connection in srj["connections"]
        .as_array()
        .expect("Snapshot connections required")
    {
        let name = connection["name"]
            .as_str()
            .expect("Connection name required");
        if let Some(indices) = grouped.get(name) {
            for (offset, index) in indices.iter().enumerate() {
                trace_route_index_by_id.insert(format!("{name}_{offset}"), *index);
            }
        }
    }
    let raw = if result.is_array() {
        &result
    } else {
        &result["errors"]
    };
    let centered = if result.is_array() {
        &result
    } else {
        result
            .get("errorsWithCenters")
            .filter(|v| !v.is_null())
            .unwrap_or(raw)
    };
    let raw = raw.as_array().expect("DRC result errors required");
    let errors: Vec<Value> = centered
        .as_array()
        .expect("DRC centered errors required")
        .iter()
        .filter(|e| !legacy || !is_via_pad_drc_error(e))
        .cloned()
        .collect();
    let count = raw
        .iter()
        .filter(|e| !legacy || !is_via_pad_drc_error(e))
        .count();
    let severity = if topology {
        get_topology_repair_drc_error_severity
    } else {
        get_drc_error_severity
    };
    let issue_score = errors
        .iter()
        .fold(0.0, |score, error| score + severity(error));
    let legacy_issue_score = errors
        .iter()
        .filter(|e| !is_via_pad_drc_error(e))
        .fold(0.0, |score, error| score + severity(error));
    DrcSnapshot {
        errors,
        count,
        issue_score,
        legacy_issue_score,
        trace_route_index_by_id,
    }
}

pub fn get_error_center(error: &Value) -> Option<Point> {
    let center = error
        .get("center")
        .filter(|v| !v.is_null())
        .or_else(|| error.get("pcb_center"))?;
    Some(Point {
        x: center["x"].as_f64()?,
        y: center["y"].as_f64()?,
    })
}

pub fn get_centered_errors(errors: &[Value]) -> Vec<Value> {
    errors
        .iter()
        .filter(|error| get_error_center(error).is_some())
        .cloned()
        .collect()
}

pub fn get_targeted_clearance_sweep_errors(errors: &[Value], effort: f64) -> Vec<Value> {
    let max_errors = 2.0f64.max(js_round(12.0 * effort.max(1.0))) as usize;
    errors
        .iter()
        .filter(|error| get_drc_error_type(error) == Some("pcb_trace_error"))
        .take(max_errors)
        .cloned()
        .collect()
}

pub fn is_via_pad_drc_error(error: &Value) -> bool {
    get_drc_error_type(error) == Some("pcb_pad_pad_clearance_error")
        && error["pcb_via_ids"]
            .as_array()
            .is_some_and(|ids| ids.len() == 1)
}

pub fn get_via_drc_issue_count(snapshot: &DrcSnapshot, include_via_pad_errors: bool) -> usize {
    snapshot
        .errors
        .iter()
        .filter(|error| {
            (get_drc_error_type(error) == Some("pcb_via_clearance_error")
                || error["pcb_via_ids"].is_array())
                && (include_via_pad_errors || !is_via_pad_drc_error(error))
        })
        .count()
}

pub fn get_non_via_pad_drc_issue_count(snapshot: &DrcSnapshot) -> usize {
    let via_pad_count = snapshot
        .errors
        .iter()
        .filter(|error| is_via_pad_drc_error(error))
        .count();
    (snapshot.errors.len() - via_pad_count).max(snapshot.count.saturating_sub(via_pad_count))
}

pub fn get_repair_drc_issue_count(snapshot: &DrcSnapshot) -> usize {
    let count = get_non_via_pad_drc_issue_count(snapshot);
    if count > 0 { count } else { snapshot.count }
}

pub fn get_repair_drc_issue_score(snapshot: &DrcSnapshot) -> f64 {
    if get_non_via_pad_drc_issue_count(snapshot) == 0 {
        return snapshot.issue_score;
    }
    if snapshot.errors.iter().any(is_via_pad_drc_error) {
        return snapshot
            .errors
            .iter()
            .filter(|e| !is_via_pad_drc_error(e))
            .fold(0.0, |score, e| score + get_drc_error_severity(e));
    }
    snapshot.legacy_issue_score
}

pub fn is_drc_snapshot_count_better(candidate: &DrcSnapshot, best: &DrcSnapshot) -> bool {
    let candidate_legacy = get_non_via_pad_drc_issue_count(candidate);
    let best_legacy = get_non_via_pad_drc_issue_count(best);
    if candidate_legacy != best_legacy {
        return candidate_legacy < best_legacy;
    }
    if candidate_legacy > 0 {
        return false;
    }
    candidate.count < best.count
}

pub fn get_legacy_first_repair_errors(errors: &[Value]) -> Vec<Value> {
    let legacy: Vec<_> = errors
        .iter()
        .filter(|e| !is_via_pad_drc_error(e))
        .cloned()
        .collect();
    if legacy.is_empty() {
        errors.to_vec()
    } else {
        legacy
    }
}

pub fn get_safe_trace_layer_drc_issue_count(snapshot: &DrcSnapshot) -> usize {
    snapshot
        .errors
        .iter()
        .filter(|error| {
            matches!(
                get_drc_error_type(error),
                Some("pcb_trace_error" | "pcb_pad_trace_clearance_error")
            )
        })
        .count()
}

pub fn is_better_drc_snapshot(
    candidate: &DrcSnapshot,
    candidate_via_count: usize,
    best_count: usize,
    best_score: f64,
    best_via_count: usize,
    best: Option<&DrcSnapshot>,
) -> bool {
    if let Some(best) = best {
        let candidate_legacy = get_non_via_pad_drc_issue_count(candidate);
        let best_legacy = get_non_via_pad_drc_issue_count(best);
        if candidate_legacy != best_legacy {
            return candidate_legacy < best_legacy;
        }
    }
    let count = get_repair_drc_issue_count(candidate);
    let score = get_repair_drc_issue_score(candidate);
    count < best_count
        || (count == best_count && score < best_score)
        || (count == best_count && candidate_via_count < best_via_count)
}

fn normalize_message(message: &str) -> String {
    let bytes = message.as_bytes();
    let mut result = String::new();
    let mut cursor = 0;
    while cursor < bytes.len() {
        let start = cursor;
        let mut end = start + usize::from(bytes[start] == b'-');
        let digit_start = end;
        while end < bytes.len() && bytes[end].is_ascii_digit() {
            end += 1;
        }
        if end > digit_start
            && end + 1 < bytes.len()
            && bytes[end] == b'.'
            && bytes[end + 1].is_ascii_digit()
        {
            end += 1;
            while end < bytes.len() && bytes[end].is_ascii_digit() {
                end += 1;
            }
            result.push('#');
            cursor = end;
        } else {
            let ch = message[start..].chars().next().unwrap();
            result.push(ch);
            cursor += ch.len_utf8();
        }
    }
    result
}

fn get_drc_error_identity(error: &Value) -> String {
    let mut ids: Vec<_> = error
        .as_object()
        .expect("DRC error object required")
        .iter()
        .filter(|(key, value)| {
            key.as_str() != "source_trace_id"
                && (key.ends_with("_id") || key.ends_with("_ids"))
                && value.as_str() != Some("")
        })
        .collect();
    ids.sort_by_key(|(a, _)| *a);
    let ids: Vec<_> = ids.into_iter().map(|(k, v)| json!([k, v])).collect();
    serde_json::to_string(&json!([
        get_drc_error_type(error),
        ids,
        normalize_message(error["message"].as_str().unwrap_or(""))
    ]))
    .unwrap()
}

pub fn has_new_drc_error_identities(candidate: &[Value], input: &[Value]) -> bool {
    let identities: HashSet<_> = input.iter().map(get_drc_error_identity).collect();
    candidate
        .iter()
        .any(|error| !identities.contains(&get_drc_error_identity(error)))
}
