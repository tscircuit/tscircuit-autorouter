use crate::utils::js_number::js_number_to_string;
use indexmap::{IndexMap, IndexSet};
use serde_json::Value;

pub type PortPointPair<'a> = [&'a Value; 2];

pub fn get_port_point_key(point: &Value) -> String {
    if let Some(id) = point.get("portPointId").filter(|value| !value.is_null()) {
        return id
            .as_str()
            .expect("Port point ID must be a string")
            .to_owned();
    }
    let coordinate = |key: &str| match point.get(key) {
        None => "undefined".to_owned(),
        Some(Value::Null) => "null".to_owned(),
        Some(value) => {
            js_number_to_string(value.as_f64().expect("Port coordinate must be numeric"))
        }
    };
    format!(
        "{}:{}:{}:{}",
        point["connectionName"]
            .as_str()
            .expect("Port connection name"),
        coordinate("x"),
        coordinate("y"),
        coordinate("z")
    )
}

pub fn get_pair_key(pair: PortPointPair<'_>) -> String {
    let a = get_port_point_key(pair[0]);
    let b = get_port_point_key(pair[1]);
    if a.encode_utf16().cmp(b.encode_utf16()).is_lt() {
        format!("{a}|{b}")
    } else {
        format!("{b}|{a}")
    }
}

fn add_unique_pair<'a>(
    pair: PortPointPair<'a>,
    pairs: &mut Vec<PortPointPair<'a>>,
    seen: &mut IndexSet<String>,
) -> bool {
    if std::ptr::eq(pair[0], pair[1]) {
        return false;
    }
    let key = get_pair_key(pair);
    if !seen.insert(key) {
        return false;
    }
    pairs.push(pair);
    true
}

fn add_sequential_pairs<'a>(
    points: &[&'a Value],
    pairs: &mut Vec<PortPointPair<'a>>,
    seen: &mut IndexSet<String>,
) {
    for adjacent in points.windows(2) {
        add_unique_pair([adjacent[0], adjacent[1]], pairs, seen);
    }
}

pub fn get_connection_port_point_pairs<'a>(points: &[&'a Value]) -> Vec<PortPointPair<'a>> {
    let mut pairs = Vec::new();
    let mut seen = IndexSet::new();
    let mut by_id = IndexMap::new();
    for &point in points {
        if let Some(id) = point["portPointId"].as_str() {
            by_id.insert(id, point);
        }
    }
    for &point in points {
        if let Some(id) = point["prevPortPointId"]
            .as_str()
            .filter(|id| !id.is_empty())
            && let Some(&previous) = by_id
                .get(id)
                .filter(|previous| previous["connectionName"] == point["connectionName"])
        {
            add_unique_pair([previous, point], &mut pairs, &mut seen);
        }
        if let Some(id) = point["nextPortPointId"]
            .as_str()
            .filter(|id| !id.is_empty())
            && let Some(&next) = by_id
                .get(id)
                .filter(|next| next["connectionName"] == point["connectionName"])
        {
            add_unique_pair([point, next], &mut pairs, &mut seen);
        }
    }
    if pairs.is_empty() {
        add_sequential_pairs(points, &mut pairs, &mut seen);
        return pairs;
    }
    let linked: IndexSet<&str> = pairs
        .iter()
        .flat_map(|pair| pair.iter())
        .filter_map(|point| point["portPointId"].as_str().filter(|id| !id.is_empty()))
        .collect();
    let unlinked: Vec<_> = points
        .iter()
        .copied()
        .filter(|point| {
            point["portPointId"]
                .as_str()
                .filter(|id| !id.is_empty())
                .is_none_or(|id| !linked.contains(id))
        })
        .collect();
    add_sequential_pairs(&unlinked, &mut pairs, &mut seen);
    pairs
}
