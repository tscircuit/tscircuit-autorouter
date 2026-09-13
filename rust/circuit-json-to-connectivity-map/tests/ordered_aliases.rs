use circuit_json_to_connectivity_map::connectivity_map::ConnectivityMap;
use indexmap::IndexMap;
#[test]
fn merging_preserves_order_stale_aliases_and_self_spread_snapshot() {
    let mut map = ConnectivityMap::new(Vec::new(), IndexMap::new());
    let ids: Vec<_> = ["a", "b", "c", "d"]
        .iter()
        .map(|name| map.intern(name.encode_utf16().collect()))
        .collect();
    assert!(map.add_connections(&[
        vec![ids[0], ids[1]],
        vec![ids[2], ids[3]],
        vec![ids[0], ids[2]]
    ]));
    let net0 = map.intern("connectivity_net0".encode_utf16().collect());
    let net1 = map.intern("connectivity_net1".encode_utf16().collect());
    assert_eq!(map.net_map[&net0], map.net_map[&net1]);
    assert_eq!(map.arrays[map.net_map[&net0]], ids);
    // The class permits public table mutation. Exercise its literal self-alias
    // merge semantics directly rather than replacing merges with set union.
    map.id_to_net_map.insert(ids[2], net1);
    assert!(map.add_connections(&[vec![ids[0], ids[2]]]));
    assert_eq!(
        map.arrays[map.net_map[&net0]],
        ids.iter().chain(ids.iter()).copied().collect::<Vec<_>>()
    );
}
