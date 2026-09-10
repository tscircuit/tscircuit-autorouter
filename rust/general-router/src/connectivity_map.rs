use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectivityMap {
    pub net_map: IndexMap<String, Vec<String>>,
    pub id_to_net_map: IndexMap<String, String>,
}

impl ConnectivityMap {
    pub fn new(net_map: IndexMap<String, Vec<String>>) -> Self {
        let mut id_to_net_map = IndexMap::new();
        for (net_id, ids) in &net_map {
            for id in ids {
                id_to_net_map.insert(id.clone(), net_id.clone());
            }
        }
        Self { net_map, id_to_net_map }
    }

    pub fn are_ids_connected(&self, id1: &str, id2: &str) -> bool {
        if id1 == id2 {
            return true;
        }
        let Some(net_id1) = self.id_to_net_map.get(id1).filter(|id| !id.is_empty()) else {
            return false;
        };
        let Some(net_id2) = self.id_to_net_map.get(id2).filter(|id| !id.is_empty()) else {
            return false;
        };
        // The dependency repeats the second comparison; preserve its behavior.
        net_id1 == net_id2 || net_id2 == id1 || net_id2 == id1
    }

    pub fn get_ids_connected_to_net(&self, net_id: &str) -> &[String] {
        match self.net_map.get(net_id) {
            Some(ids) => ids,
            None => &[],
        }
    }
}
