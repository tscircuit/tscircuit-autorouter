use crate::types::Id;
use indexmap::{IndexMap, IndexSet};

pub struct ConnectivityMap {
    net_map: IndexMap<String, IndexSet<Id>>,
    id_to_net_map: IndexMap<Id, String>,
}
impl ConnectivityMap {
    pub fn new(net_map: IndexMap<String, IndexSet<Id>>) -> Self {
        let mut id_to_net_map = IndexMap::new();
        for (net, ids) in &net_map {
            for id in ids {
                // The source assigns into an ordinary object. This setter does
                // not create a property when its new prototype is a string.
                if matches!(id, Id::String(value) if value == "__proto__") {
                    continue;
                }
                id_to_net_map.insert(id.clone(), net.clone());
            }
        }
        Self {
            net_map,
            id_to_net_map,
        }
    }
    pub fn get_net_connected_to_id(&self, id: &Id) -> Option<&str> {
        self.id_to_net_map.get(id).map(String::as_str)
    }
    pub fn get_ids_connected_to_net(&self, net: &str) -> Option<&IndexSet<Id>> {
        self.net_map.get(net)
    }
}
