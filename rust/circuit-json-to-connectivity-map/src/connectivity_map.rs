use indexmap::{IndexMap, IndexSet};
use serde::Serialize;

#[cfg_attr(feature = "wasm-types", derive(tsify::Tsify))]
#[cfg_attr(feature = "wasm-types", tsify(rename = "ConnectivityMapOutput"))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectivityMap {
    #[serde(skip)]
    pub strings: Vec<Vec<u16>>,
    pub string_offset: usize,
    #[serde(rename = "strings")]
    #[cfg_attr(feature = "wasm-types", tsify(type = "ConnectivityWireString[]"))]
    pub generated_strings: Vec<crate::WireString>,
    pub arrays: Vec<Vec<usize>>,
    #[serde(serialize_with = "ordered_entries")]
    #[cfg_attr(feature = "wasm-types", tsify(type = "[number, number][]"))]
    pub net_map: IndexMap<usize, usize>,
    #[serde(serialize_with = "ordered_entries")]
    #[cfg_attr(feature = "wasm-types", tsify(type = "[number, number][]"))]
    pub id_to_net_map: IndexMap<usize, usize>,
    pub failed_group: Option<Vec<usize>>,
    #[serde(skip)]
    pub prototype_values: IndexMap<usize, Option<usize>>,
    #[serde(skip)]
    string_ids: IndexMap<Vec<u16>, usize>,
}

impl ConnectivityMap {
    pub fn new(strings: Vec<Vec<u16>>, prototype_values: IndexMap<usize, Option<usize>>) -> Self {
        let string_ids = strings
            .iter()
            .cloned()
            .enumerate()
            .map(|(id, value)| (value, id))
            .collect();
        Self {
            string_offset: strings.len(),
            generated_strings: Vec::new(),
            strings,
            string_ids,
            prototype_values,
            arrays: Vec::new(),
            net_map: IndexMap::new(),
            id_to_net_map: IndexMap::new(),
            failed_group: None,
        }
    }

    pub fn intern(&mut self, value: Vec<u16>) -> usize {
        if let Some(id) = self.string_ids.get(&value) {
            return *id;
        }
        let id = self.strings.len();
        self.generated_strings
            .push(crate::WireString::from_units(value.clone()));
        self.strings.push(value.clone());
        self.string_ids.insert(value, id);
        id
    }

    pub fn add_connections(&mut self, connections: &[Vec<usize>]) -> bool {
        for connection in connections {
            let mut existing_nets = IndexSet::new();
            for id in connection {
                if let Some(net) = self.id_to_net_map.get(id) {
                    existing_nets.insert(*net);
                } else if let Some(net) = self.prototype_values.get(id) {
                    match net {
                        Some(net) => {
                            existing_nets.insert(*net);
                        }
                        None => {
                            self.failed_group = Some(connection.clone());
                            return false;
                        }
                    }
                }
            }
            // An inherited value may name a missing net. Let the original JS
            // method materialize its own exception from this pre-group state.
            if existing_nets
                .iter()
                .any(|net| !self.net_map.contains_key(net))
            {
                self.failed_group = Some(connection.clone());
                return false;
            }
            let target_net_id = if existing_nets.is_empty() {
                let id = self.intern(
                    format!("connectivity_net{}", self.net_map.len())
                        .encode_utf16()
                        .collect(),
                );
                let array = self.arrays.len();
                self.arrays.push(Vec::new());
                self.net_map.insert(id, array);
                id
            } else {
                *existing_nets.first().unwrap()
            };

            if existing_nets.len() > 1 {
                for net_id in existing_nets {
                    if net_id != target_net_id {
                        let target = self.net_map[&target_net_id];
                        let source = self.net_map[&net_id];
                        // JS spread snapshots the source, including self-aliases.
                        let source = self.arrays[source].clone();
                        self.arrays[target].extend_from_slice(&source);
                        self.net_map.insert(net_id, target);
                        for id in &self.arrays[target] {
                            self.id_to_net_map.insert(*id, target_net_id);
                        }
                    }
                }
            }

            for id in connection {
                let target = self.net_map[&target_net_id];
                if !self.arrays[target].contains(id) {
                    self.arrays[target].push(*id);
                }
                self.id_to_net_map.insert(*id, target_net_id);
            }
        }
        true
    }
}

fn ordered_entries<S: serde::Serializer>(
    values: &IndexMap<usize, usize>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    use serde::ser::SerializeSeq;
    let mut entries = serializer.serialize_seq(Some(values.len()))?;
    for entry in values {
        entries.serialize_element(&entry)?;
    }
    entries.end()
}
