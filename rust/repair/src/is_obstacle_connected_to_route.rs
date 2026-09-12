use serde_json::Value;
use crate::net_utils::RepairConnectivityMap;

pub fn are_ids_connected(left: &str, right: &str, conn_map: Option<&RepairConnectivityMap>) -> bool {
    if left == right { return true; }
    let Some(map) = conn_map else { return false; };
    let Some(a) = map.id_to_net_map.get(left).filter(|s| !s.is_empty()) else { return false; };
    let Some(b) = map.id_to_net_map.get(right).filter(|s| !s.is_empty()) else { return false; };
    a == b || b == left
}

pub fn is_obstacle_connected_to_route(obstacle: &Value, route: &Value, conn_map: Option<&RepairConnectivityMap>) -> bool {
    let name = route["connectionName"].as_str().expect("Route connectionName");
    let root = route["rootConnectionName"].as_str();
    obstacle["connectedTo"].as_array().expect("Obstacle connectedTo").iter().filter_map(Value::as_str).any(|id| {
        id == name || Some(id) == root || (conn_map.is_some() && (are_ids_connected(name, id, conn_map) || root.is_some_and(|root| are_ids_connected(root, id, conn_map))))
    })
}
