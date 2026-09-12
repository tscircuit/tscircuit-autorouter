use indexmap::{IndexMap, IndexSet};
use serde_json::Value;
use math_utils::{js_to_fixed, js_number_to_string};
use crate::utils::get_connection_port_point_pairs::get_connection_port_point_pairs;

fn point_key(point: &Value) -> String {
    format!("{},{},{}", js_to_fixed(point["x"].as_f64().expect("Point x required"), 6),
        js_to_fixed(point["y"].as_f64().expect("Point y required"), 6), js_number_to_string(point["z"].as_f64().expect("Point z required")))
}

fn get_connected_point_keys_for_connection(routes: &[Value], name: &str, start: String) -> IndexSet<String> {
    let mut adjacency: IndexMap<String, IndexSet<String>> = IndexMap::new();
    for route in routes {
        let points = route["route"].as_array().expect("Route points required");
        if route["connectionName"].as_str() != Some(name) || points.is_empty() { continue; }
        if points.len() == 1 { adjacency.entry(point_key(&points[0])).or_default(); continue; }
        for pair in points.windows(2) {
            let a = point_key(&pair[0]); let b = point_key(&pair[1]);
            adjacency.entry(a.clone()).or_default().insert(b.clone());
            adjacency.entry(b).or_default().insert(a);
        }
    }
    let mut connected = IndexSet::new(); connected.insert(start.clone());
    let mut stack = vec![start];
    while let Some(key) = stack.pop() {
        if let Some(neighbors) = adjacency.get(&key) {
            for next in neighbors { if connected.insert(next.clone()) { stack.push(next.clone()); } }
        }
    }
    connected
}

pub fn are_node_port_point_pairs_connected_by_routes(routes: &[Value], node: &Value) -> bool {
    if let Some(pairs) = node["portPointsInPairs"].as_array().filter(|pairs| !pairs.is_empty()) {
        for pair in pairs {
            let start = &pair[0]; let end = &pair[1];
            let keys = get_connected_point_keys_for_connection(routes, start["connectionName"].as_str().expect("Connection name required"), point_key(start));
            if !keys.contains(&point_key(end)) { return false; }
        }
        return true;
    }
    let mut groups: IndexMap<&str, Vec<&Value>> = IndexMap::new();
    for point in node["portPoints"].as_array().expect("Node ports required") {
        groups.entry(point["connectionName"].as_str().expect("Connection name required")).or_default().push(point);
    }
    for (name, points) in groups {
        for [start, end] in get_connection_port_point_pairs(&points) {
            let keys = get_connected_point_keys_for_connection(routes, name, point_key(points[start]));
            if !keys.contains(&point_key(points[end])) { return false; }
        }
    }
    true
}

pub fn repair_disconnected_same_root_port_points(routes: &[Value], node: &Value) -> Vec<Value> {
    let mut repaired = routes.to_vec();
    let mut groups: IndexMap<&str, Vec<&Value>> = IndexMap::new();
    for point in node["portPoints"].as_array().expect("Node ports required") {
        groups.entry(point["connectionName"].as_str().expect("Connection name required")).or_default().push(point);
    }
    for (name, points) in groups {
        if points.len() <= 1 { continue; }
        let root = points[0]["rootConnectionName"].as_str().unwrap_or(name);
        let targets: IndexSet<String> = points.iter().map(|p| point_key(p)).collect();
        let mut connected = get_connected_point_keys_for_connection(&repaired, name, point_key(points[0]));
        for point in &points[1..] {
            let key = point_key(point);
            if connected.contains(&key) { continue; }
            let bridge = repaired.iter().find(|route| {
                if route["rootConnectionName"].as_str().or(route["connectionName"].as_str()) != Some(root) || route["connectionName"].as_str() == Some(name) { return false; }
                let geometry = route["route"].as_array().expect("Route points required");
                let (Some(start), Some(end)) = (geometry.first(), geometry.last()) else { return false; };
                let start = point_key(start); let end = point_key(end);
                (connected.contains(&start) && end == key) || (connected.contains(&end) && start == key)
                    || (targets.contains(&start) && targets.contains(&end) && (start == key || end == key))
            });
            let Some(bridge) = bridge else { continue; };
            let mut route = bridge.clone();
            route["connectionName"] = Value::from(name); route["rootConnectionName"] = Value::from(root);
            for point in route["route"].as_array_mut().expect("Route points required") {
                point["connectionName"] = Value::from(name); point["rootConnectionName"] = Value::from(root);
            }
            // Cloning the Value copies via and jumper endpoint objects too.
            if route["jumpers"].is_null() { route.as_object_mut().unwrap().remove("jumpers"); }
            repaired.push(route);
            connected = get_connected_point_keys_for_connection(&repaired, name, point_key(points[0]));
        }
    }
    repaired
}
