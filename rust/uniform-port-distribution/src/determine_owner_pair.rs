use crate::get_owner_pair_key::normalize_owner_pair;
use crate::types::{InputNodeWithPortPoints, Name, OwnerPair};

pub fn determine_owner_pair(port_point_id: Option<&Name>, current_node_id: &Name, input_nodes: &[InputNodeWithPortPoints]) -> OwnerPair {
    let mut connection_node_ids = None;
    if let Some(port_point_id) = port_point_id.filter(|id| !id.is_empty()) {
        for node in input_nodes {
            let point = node.port_points.iter().find(|point| point.port_point_id.as_ref() == Some(port_point_id));
            if let Some(ids) = point.and_then(|point| point.connection_node_ids.as_ref()) {
                connection_node_ids = Some(ids);
                break;
            }
        }
    }
    let Some(ids) = connection_node_ids.filter(|ids| ids.len() == 2) else {
        return [current_node_id.clone(), current_node_id.clone()];
    };
    if ids[0].is_empty() || ids[1].is_empty() {
        return [current_node_id.clone(), current_node_id.clone()];
    }
    normalize_owner_pair(&ids[0], &ids[1])
}
