use serde_json::Value;
use serde::Deserialize;
use indexmap::IndexMap;

#[derive(Deserialize)]
#[cfg_attr(feature = "wasm-types", derive(tsify::Tsify))]
#[serde(rename_all = "camelCase")]
pub struct RepairConnectivityMap {
    #[cfg_attr(feature = "wasm-types", tsify(type = "Record<string, string>"))]
    pub id_to_net_map: IndexMap<String, String, rustc_hash::FxBuildHasher>,
}
use crate::solvers::global_drc_force_improve_solver::internal_types::MutableRoute;

#[derive(Clone, Copy)]
pub struct ResolvedNetId<'a> {
    pub id: &'a str,
    pub net_id: Option<&'a str>,
}

pub fn resolve_net_id<'a>(id: &'a str, conn_map: Option<&'a RepairConnectivityMap>) -> ResolvedNetId<'a> {
    ResolvedNetId {
        id,
        net_id: conn_map.and_then(|map| map.id_to_net_map.get(id).map(String::as_str)),
    }
}

pub fn shares_resolved_net(left: ResolvedNetId<'_>, right: ResolvedNetId<'_>) -> bool {
    if right.id.is_empty() { return false; }
    if left.id == right.id { return true; }
    if let Some(left_net_id) = left.net_id.filter(|id| !id.is_empty()) {
        if Some(left_net_id) == right.net_id || (!left.id.is_empty() && left_net_id == right.id) { return true; }
    }
    if let Some(right_net_id) = right.net_id.filter(|id| !id.is_empty()) {
        if right_net_id == left.id { return true; }
    }
    false
}

pub fn get_root_connection_name(route: &MutableRoute) -> &str {
    route.root_connection_name.as_deref().unwrap_or(&route.connection_name)
}

pub fn get_conn_map_net_id<'a>(conn_map: Option<&'a RepairConnectivityMap>, id: Option<&str>) -> Option<&'a str> {
    let conn_map = conn_map?;
    let id = id.filter(|id| !id.is_empty())?;
    conn_map.id_to_net_map.get(id).map(String::as_str)
}

pub fn get_conn_map_aware_srj(srj: &Value, conn_map: Option<&RepairConnectivityMap>) -> Value {
    let Some(conn_map) = conn_map else { return srj.clone(); };
    let connections = srj["connections"].as_array().expect("SRJ connections are required").iter().map(|connection| {
        let net_connection_name = get_conn_map_net_id(Some(conn_map), connection["name"].as_str())
            .or_else(|| get_conn_map_net_id(Some(conn_map), connection["rootConnectionName"].as_str()))
            .or_else(|| connection["netConnectionName"].as_str());
        let mut connection = connection.clone();
        if let Some(name) = net_connection_name.filter(|name| !name.is_empty()) {
            connection["netConnectionName"] = Value::from(name);
        }
        connection
    }).collect();
    let obstacles = srj["obstacles"].as_array().expect("SRJ obstacles are required").iter().map(|obstacle| {
        let original_connected_to = obstacle["connectedTo"].as_array().expect("Obstacle connectedTo is required");
        let mut connected_to = Vec::new();
        for id in original_connected_to {
            if !connected_to.contains(id) { connected_to.push(id.clone()); }
        }
        for connected_id in original_connected_to {
            if let Some(net_id) = get_conn_map_net_id(Some(conn_map), connected_id.as_str()).filter(|net_id| !net_id.is_empty()) {
                let net_id = Value::from(net_id);
                if !connected_to.contains(&net_id) { connected_to.push(net_id); }
            }
        }
        let mut obstacle = obstacle.clone();
        obstacle["connectedTo"] = Value::Array(connected_to);
        obstacle
    }).collect();
    let mut result = srj.clone();
    result["connections"] = Value::Array(connections);
    result["obstacles"] = Value::Array(obstacles);
    result
}

pub fn shares_net(left: &str, right: Option<&str>, conn_map: Option<&RepairConnectivityMap>) -> bool {
    let Some(right) = right.filter(|right| !right.is_empty()) else { return false; };
    if left == right { return true; }
    // Unlike getConnMapNetId, the source calls getNetConnectedToId even for an
    // empty left id here. Keep that distinction for sparse connectivity maps.
    let left_net_id = conn_map.and_then(|map| map.id_to_net_map.get(left).map(String::as_str));
    let right_net_id = conn_map.and_then(|map| map.id_to_net_map.get(right).map(String::as_str));
    if let Some(left_net_id) = left_net_id.filter(|id| !id.is_empty()) {
        if Some(left_net_id) == right_net_id || (!left.is_empty() && left_net_id == right) { return true; }
    }
    if let Some(right_net_id) = right_net_id.filter(|id| !id.is_empty()) {
        if right_net_id == left { return true; }
    }
    false
}

pub fn obstacle_shares_net(root_connection_name: &str, obstacle: &Value, conn_map: Option<&RepairConnectivityMap>) -> bool {
    let Some(connected_to) = obstacle.get("connectedTo").filter(|value| !value.is_null()) else { return false; };
    connected_to.as_array().expect("Obstacle connectedTo must be an array").iter()
        .any(|connected_to| shares_net(root_connection_name, connected_to.as_str(), conn_map))
}

#[derive(Clone, Copy)]
pub(crate) struct InternedResolvedNetId {
    id: usize,
    net_id: Option<usize>,
}

pub(crate) struct ResolvedNetInterner {
    ids: std::cell::RefCell<rustc_hash::FxHashMap<String, usize>>,
}

impl ResolvedNetInterner {
    pub(crate) fn new() -> Self {
        let mut ids = rustc_hash::FxHashMap::default();
        ids.insert(String::new(), 0);
        Self { ids: std::cell::RefCell::new(ids) }
    }

    pub(crate) fn resolve(&self, id: &str, conn_map: Option<&RepairConnectivityMap>) -> InternedResolvedNetId {
        let resolved = resolve_net_id(id, conn_map);
        let mut ids = self.ids.borrow_mut();
        let id = match ids.get(resolved.id) {
            Some(&id) => id,
            None => { let id = ids.len(); ids.insert(resolved.id.to_owned(), id); id }
        };
        let net_id = resolved.net_id.map(|net| match ids.get(net) {
            Some(&id) => id,
            None => { let id = ids.len(); ids.insert(net.to_owned(), id); id }
        });
        InternedResolvedNetId { id, net_id }
    }
}

pub(crate) fn shares_interned_resolved_net(left: InternedResolvedNetId, right: InternedResolvedNetId) -> bool {
    if right.id == 0 { return false; }
    if left.id == right.id { return true; }
    if let Some(left_net_id) = left.net_id.filter(|id| *id != 0) {
        if Some(left_net_id) == right.net_id || (left.id != 0 && left_net_id == right.id) { return true; }
    }
    if let Some(right_net_id) = right.net_id.filter(|id| *id != 0) {
        if right_net_id == left.id { return true; }
    }
    false
}

#[cfg(test)]
mod interned_net_tests {
    use super::*;

    #[test]
    fn interned_membership_preserves_empty_alias_and_update_semantics() {
        let ids = ["", "a", "b", "c", "net", "unknown"];
        let interner = ResolvedNetInterner::new();
        for entries in [
            serde_json::json!({}),
            serde_json::json!({"a":"b","b":"c","c":"net"}),
            serde_json::json!({"":"net","a":"","b":"net","net":"a"}),
            serde_json::json!({"a":"net","b":"net","c":""}),
        ] {
            let map: RepairConnectivityMap = serde_json::from_value(serde_json::json!({"idToNetMap":entries})).unwrap();
            for conn in [None, Some(&map)] {
                for left in ids {
                    for right in ids {
                        assert_eq!(
                            shares_interned_resolved_net(interner.resolve(left, conn), interner.resolve(right, conn)),
                            shares_net(left, Some(right), conn),
                            "left={left:?}, right={right:?}",
                        );
                    }
                }
            }
        }
    }
}
