use indexmap::IndexMap;
use serde::{Serialize, Deserialize};
use serde_json::Value;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortPair {
    pub start: Value,
    pub end: Value,
    pub connection_name: String,
}

pub type PortPairMap = IndexMap<String, PortPair>;

pub fn get_port_pair_map(node: &Value) -> PortPairMap {
    let mut pairs = IndexMap::new();
    for point in node["portPoints"].as_array().expect("Node portPoints required") {
        let name = point["connectionName"].as_str().expect("Port connectionName required");
        if let Some(pair) = pairs.get_mut(name) {
            let pair: &mut PortPair = pair;
            pair.end = point.clone();
        } else {
            pairs.insert(name.to_owned(), PortPair { start: point.clone(), end: Value::Null, connection_name: name.to_owned() });
        }
    }
    pairs
}
