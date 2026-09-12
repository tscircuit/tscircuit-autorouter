use crate::types::Id;
use indexmap::IndexSet;

// Entries retain their creation positions, including the gaps left by deleted
// networks. This follows the source Map/Set merge order exactly.
pub fn find_connected_networks(connections: &[[Id; 2]]) -> indexmap::IndexMap<String, IndexSet<Id>> {
    let mut networks: Vec<Option<IndexSet<Id>>> = Vec::new();
    for connection in connections {
        let mut network = None;
        for node in connection {
            let current = match network {
                None => {
                    let existing = get_or_create_network(&mut networks, node);
                    network = Some(existing);
                    existing
                }
                Some(current) => {
                    if !networks[current].as_ref().unwrap().contains(node) {
                        let existing = get_or_create_network(&mut networks, node);
                        if existing != current {
                            let merged = networks[existing].take().unwrap();
                            networks[current].as_mut().unwrap().extend(merged);
                        }
                    }
                    current
                }
            };
            networks[current].as_mut().unwrap().insert(node.clone());
        }
    }
    networks.into_iter().enumerate().filter_map(|(index, network)| network.map(|nodes| (format!("connectivity_net{index}"), nodes))).collect()
}
fn get_or_create_network(networks: &mut Vec<Option<IndexSet<Id>>>, node: &Id) -> usize {
    for (index, network) in networks.iter().enumerate() {
        if network.as_ref().is_some_and(|n| n.contains(node)) { return index; }
    }
    networks.push(Some(IndexSet::new()));
    networks.len() - 1
}
