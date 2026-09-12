use serde_json::Value;
use std::collections::{HashMap, HashSet};

type PortPointPair<'a> = [&'a Value; 2];

fn get_pair_key(a: &Value, b: &Value) -> String {
    let point_key = |point: &Value| -> String {
        if let Some(id) = point.get("portPointId").and_then(Value::as_str) {
            return id.to_owned();
        }
        let number = |key: &str| -> String {
            ryu_js::Buffer::new()
                .format(point[key].as_f64().expect("Port point coordinate must be a number"))
                .to_owned()
        };
        format!("{}:{}:{}:{}", point["connectionName"].as_str().expect("Port point connectionName must be a string"), number("x"), number("y"), number("z"))
    };
    let a_key = point_key(a);
    let b_key = point_key(b);
    if a_key.encode_utf16().cmp(b_key.encode_utf16()).is_lt() {
        format!("{a_key}|{b_key}")
    } else {
        format!("{b_key}|{a_key}")
    }
}

fn create_port_points_by_id_map(port_points: &[Value]) -> HashMap<&str, &Value> {
    let mut port_points_by_id = HashMap::new();
    for port_point in port_points {
        if let Some(id) = port_point.get("portPointId").and_then(Value::as_str).filter(|id| !id.is_empty()) {
            port_points_by_id.insert(id, port_point);
        }
    }
    port_points_by_id
}

fn append_pair_if_unique<'a>(pair: PortPointPair<'a>, seen_pair_keys: &mut HashSet<String>, pairs: &mut Vec<PortPointPair<'a>>) {
    if std::ptr::eq(pair[0], pair[1]) {
        return;
    }
    let pair_key = get_pair_key(pair[0], pair[1]);
    if seen_pair_keys.insert(pair_key) {
        pairs.push(pair);
    }
}

fn append_adjacent_pairs<'a>(port_points: &[&'a Value], seen_pair_keys: &mut HashSet<String>, pairs: &mut Vec<PortPointPair<'a>>) {
    for adjacent in port_points.windows(2) {
        append_pair_if_unique([adjacent[0], adjacent[1]], seen_pair_keys, pairs);
    }
}

fn get_linked_port_point_id_set<'a>(pairs: &[PortPointPair<'a>]) -> HashSet<&'a str> {
    let mut linked_port_point_ids = HashSet::new();
    for pair in pairs {
        for port_point in pair {
            if let Some(id) = port_point.get("portPointId").and_then(Value::as_str).filter(|id| !id.is_empty()) {
                linked_port_point_ids.insert(id);
            }
        }
    }
    linked_port_point_ids
}

pub fn get_connection_port_point_pairs(port_points: &[Value]) -> Vec<PortPointPair<'_>> {
    let mut pairs = Vec::new();
    let mut seen_pair_keys = HashSet::new();
    let port_points_by_id = create_port_points_by_id_map(port_points);
    for port_point in port_points {
        if let Some(prev_id) = port_point.get("prevPortPointId").and_then(Value::as_str).filter(|id| !id.is_empty()) {
            if let Some(prev) = port_points_by_id.get(prev_id) {
                if prev["connectionName"] == port_point["connectionName"] {
                    append_pair_if_unique([prev, port_point], &mut seen_pair_keys, &mut pairs);
                }
            }
        }
        if let Some(next_id) = port_point.get("nextPortPointId").and_then(Value::as_str).filter(|id| !id.is_empty()) {
            if let Some(next) = port_points_by_id.get(next_id) {
                if next["connectionName"] == port_point["connectionName"] {
                    append_pair_if_unique([port_point, next], &mut seen_pair_keys, &mut pairs);
                }
            }
        }
    }
    if pairs.is_empty() {
        append_adjacent_pairs(&port_points.iter().collect::<Vec<_>>(), &mut seen_pair_keys, &mut pairs);
        return pairs;
    }
    let linked_ids = get_linked_port_point_id_set(&pairs);
    let unlinked_port_points: Vec<_> = port_points.iter().filter(|port_point| {
        match port_point.get("portPointId").and_then(Value::as_str) {
            Some(id) if !id.is_empty() => !linked_ids.contains(id),
            _ => true,
        }
    }).collect();
    append_adjacent_pairs(&unlinked_port_points, &mut seen_pair_keys, &mut pairs);
    pairs
}
