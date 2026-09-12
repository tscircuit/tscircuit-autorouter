use indexmap::IndexMap;
use serde_json::{Value, json};
use crate::utils::get_intra_node_crossings_using_circle::get_intra_node_crossings_using_circle;

fn unique_available_z(node: &Value) -> Vec<f64> {
    let values: Vec<f64> = if let Some(z) = node["availableZ"].as_array().filter(|a| !a.is_empty()) {
        z.iter().map(|v| v.as_f64().expect("Layer must be numeric")).collect()
    } else { node["portPoints"].as_array().expect("Ports required").iter().map(|p| p["z"].as_f64().unwrap_or(0.0)).collect() };
    let mut unique = Vec::new();
    for z in values { if !unique.contains(&z) { unique.push(z); } }
    unique.sort_by(|a,b| (a-b).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal)); unique
}

pub fn has_impossible_same_layer_crossing_geometry(node: &Value) -> bool {
    unique_available_z(node).len() == 1 && get_intra_node_crossings_using_circle(node)["numSameLayerCrossings"].as_u64().unwrap() > 0
}

pub fn create_invalid_direct_connection_routes(node: &Value, thickness: f64, diameter: f64) -> Vec<Value> {
    let mut groups: IndexMap<&str, Vec<&Value>> = IndexMap::new(); let z = unique_available_z(node).first().copied();
    for point in node["portPoints"].as_array().expect("Ports required") {
        groups.entry(point["connectionName"].as_str().expect("Connection name required")).or_default().push(point);
    }
    groups.into_iter().filter(|(_, points)| points.len() >= 2).map(|(name, points)| {
        let start = points[0]; let end = points[points.len()-1];
        let mut route = json!({"connectionName":name});
        if let Some(root) = start.get("rootConnectionName") { route["rootConnectionName"] = root.clone(); }
        if let Some(id) = node.get("capacityMeshNodeId") { route["regionId"] = id.clone(); }
        route["traceThickness"] = Value::from(thickness); route["viaDiameter"] = Value::from(diameter);
        route["route"] = json!([{"x":start["x"],"y":start["y"],"z":z.or_else(||start["z"].as_f64()).unwrap_or(0.0)},
            {"x":end["x"],"y":end["y"],"z":z.or_else(||end["z"].as_f64()).unwrap_or(0.0)}]);
        route["vias"] = json!([]); route
    }).collect()
}

pub fn create_invalid_same_layer_crossing_routes(node: &Value, thickness: f64, diameter: f64) -> Vec<Value> {
    create_invalid_direct_connection_routes(node, thickness, diameter)
}
