use std::{cell::OnceCell, ops::Deref, rc::Rc};
use indexmap::IndexMap;
use rustc_hash::FxBuildHasher;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectivityMapData {
    pub net_map: IndexMap<String, Vec<String>>,
    pub id_to_net_map: IndexMap<String, String, FxBuildHasher>,
}

#[derive(Debug)]
struct ConnectivityVersion {
    data: ConnectivityMapData,
    revision: usize,
    next: OnceCell<Box<ConnectivityVersion>>,
}

#[derive(Debug)]
pub struct ConnectivityMap(Rc<ConnectivityVersion>);

impl ConnectivityMap {
    fn from_data(data: ConnectivityMapData) -> Self {
        Self(Rc::new(ConnectivityVersion { data, revision: 0, next: OnceCell::new() }))
    }

    fn current(&self) -> &ConnectivityVersion {
        let mut version = self.0.as_ref();
        while let Some(next) = version.next.get() { version = next; }
        version
    }

    pub fn revision(&self) -> usize { self.current().revision }

    pub fn replace_from(&self, incoming: &Self) {
        let current = self.current();
        if current.data.net_map.iter().eq(incoming.net_map.iter()) && current.data.id_to_net_map.iter().eq(incoming.id_to_net_map.iter()) { return; }
        // Retained native children share the same map instance. Keeping prior
        // versions also keeps references held across explicit JS callbacks valid.
        current.next.set(Box::new(ConnectivityVersion {
            data: incoming.current().data.clone(), revision: current.revision + 1, next: OnceCell::new(),
        })).expect("Connectivity map version already replaced");
    }

    pub fn new(net_map: IndexMap<String, Vec<String>>) -> Self {
        let mut id_to_net_map = IndexMap::with_hasher(FxBuildHasher);
        for (net_id, ids) in &net_map {
            for id in ids { id_to_net_map.insert(id.clone(), net_id.clone()); }
        }
        Self::from_data(ConnectivityMapData { net_map, id_to_net_map })
    }

    pub fn are_ids_connected(&self, id1: &str, id2: &str) -> bool {
        if id1 == id2 { return true; }
        let Some(net_id1) = self.id_to_net_map.get(id1).filter(|id| !id.is_empty()) else { return false; };
        let Some(net_id2) = self.id_to_net_map.get(id2).filter(|id| !id.is_empty()) else { return false; };
        // The dependency repeats the second comparison; preserve its behavior.
        net_id1 == net_id2 || net_id2 == id1 || net_id2 == id1
    }

    pub fn get_ids_connected_to_net(&self, net_id: &str) -> &[String] {
        match self.net_map.get(net_id) { Some(ids) => ids, None => &[] }
    }
}

impl Deref for ConnectivityMap {
    type Target = ConnectivityMapData;
    fn deref(&self) -> &Self::Target { &self.current().data }
}

impl Clone for ConnectivityMap {
    fn clone(&self) -> Self { Self::from_data(self.current().data.clone()) }
}

impl Serialize for ConnectivityMap {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> { self.current().data.serialize(serializer) }
}

impl<'de> Deserialize<'de> for ConnectivityMap {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        ConnectivityMapData::deserialize(deserializer).map(Self::from_data)
    }
}
