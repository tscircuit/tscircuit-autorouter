use indexmap::{IndexMap, IndexSet};
use serde_json::Value;
use math_utils::js_number_to_string;

fn get_port_point_key(point: &Value) -> String {
    point.get("portPointId").filter(|v| !v.is_null()).map(|id| id.as_str().expect("Port point id must be a string").to_owned()).unwrap_or_else(|| {
        format!("{}:{}:{}:{}", point["connectionName"].as_str().expect("Connection name required"),
            js_number_to_string(point["x"].as_f64().expect("Point x required")), js_number_to_string(point["y"].as_f64().expect("Point y required")),
            js_number_to_string(point["z"].as_f64().expect("Point z required")))
    })
}

fn get_pair_key(a: &Value, b: &Value) -> String {
    let a = get_port_point_key(a); let b = get_port_point_key(b);
    if a.encode_utf16().cmp(b.encode_utf16()).is_lt() { format!("{a}|{b}") } else { format!("{b}|{a}") }
}

fn add_unique_pair(pair: [usize; 2], points: &[&Value], pairs: &mut Vec<[usize; 2]>, seen: &mut IndexSet<String>) -> bool {
    if std::ptr::eq(points[pair[0]], points[pair[1]]) { return false; }
    let key = get_pair_key(points[pair[0]], points[pair[1]]);
    if !seen.insert(key) { return false; }
    pairs.push(pair); true
}

pub fn get_connection_port_point_pairs(points: &[&Value]) -> Vec<[usize; 2]> {
    let mut pairs = Vec::new(); let mut seen = IndexSet::new();
    let mut by_id = IndexMap::new();
    for (index, point) in points.iter().enumerate() {
        if let Some(id) = point["portPointId"].as_str() { by_id.insert(id, index); }
    }
    for (index, point) in points.iter().enumerate() {
        if let Some(prev) = point["prevPortPointId"].as_str().filter(|id| !id.is_empty()).and_then(|id| by_id.get(id)).copied() {
            if points[prev]["connectionName"] == point["connectionName"] { add_unique_pair([prev, index], points, &mut pairs, &mut seen); }
        }
        if let Some(next) = point["nextPortPointId"].as_str().filter(|id| !id.is_empty()).and_then(|id| by_id.get(id)).copied() {
            if points[next]["connectionName"] == point["connectionName"] { add_unique_pair([index, next], points, &mut pairs, &mut seen); }
        }
    }
    if pairs.is_empty() {
        for index in 0..points.len().saturating_sub(1) { add_unique_pair([index, index + 1], points, &mut pairs, &mut seen); }
        return pairs;
    }
    let linked: IndexSet<&str> = pairs.iter().flat_map(|pair| pair.iter()).filter_map(|&i| points[i]["portPointId"].as_str()).filter(|id| !id.is_empty()).collect();
    let unlinked: Vec<usize> = points.iter().enumerate().filter(|(_, p)| p["portPointId"].as_str().is_none_or(|id| id.is_empty() || !linked.contains(id))).map(|(i, _)| i).collect();
    for pair in unlinked.windows(2) { add_unique_pair([pair[0], pair[1]], points, &mut pairs, &mut seen); }
    pairs
}
