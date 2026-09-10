use crate::compat::get_single_port_point_pathing_solver_params;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashSet;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionPatch {
    pub connection_id: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionPatchSelection {
    pub connection_patches: Vec<ConnectionPatch>,
}

pub fn filter_port_point_pathing_solver_input_by_connection_patches(
    input: &Value,
    selection: &ConnectionPatchSelection,
) -> Value {
    let params = get_single_port_point_pathing_solver_params(input);
    let selected: HashSet<&str> = selection
        .connection_patches
        .iter()
        .map(|p| p.connection_id.as_str())
        .collect();
    assert!(
        !selected.is_empty(),
        "Connection patch selection must contain at least one id"
    );
    let filtered: Vec<Value> = params["connections"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| selected.contains(c["connectionId"].as_str().unwrap()))
        .cloned()
        .collect();
    if filtered.len() != selected.len() {
        let found: HashSet<&str> = filtered
            .iter()
            .map(|c| c["connectionId"].as_str().unwrap())
            .collect();
        let mut missing: Vec<&str> = selected.difference(&found).copied().collect();
        missing.sort();
        panic!(
            "Missing selected connection ids in port point pathing input: {}",
            missing.join(", ")
        );
    }

    let mut params = params.clone();
    params["connections"] = json!(filtered);
    if input.is_array() {
        json!([params])
    } else {
        params
    }
}
