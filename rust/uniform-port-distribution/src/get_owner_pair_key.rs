use crate::types::{Name, OwnerPair};

pub fn normalize_owner_pair(node_a: &Name, node_b: &Name) -> OwnerPair {
    let order = match (node_a, node_b) {
        (Name::String(a), Name::String(b)) => a.encode_utf16().cmp(b.encode_utf16()),
        _ => node_a.utf16().cmp(&node_b.utf16()),
    };
    if order.is_le() { [node_a.clone(), node_b.clone()] }
    else { [node_b.clone(), node_a.clone()] }
}

pub fn get_owner_pair_key(owner_node_ids: &OwnerPair) -> Name {
    if let [Name::String(a), Name::String(b)] = owner_node_ids {
        let mut key = String::with_capacity(a.len() + b.len() + 1);
        key.push_str(a); key.push('|'); key.push_str(b);
        Name::String(key)
    } else {
        let mut units = owner_node_ids[0].utf16();
        units.push('|' as u16);
        units.extend(owner_node_ids[1].utf16());
        Name::Units { __utf16: units }
    }
}
