use tiny_hypergraph::{
    DistinctOwnerBlockerHop, DistinctOwnerBlockerSearchOptions, DistinctOwnerBlockerSearchResult,
    find_distinct_owner_blocker_path, order_routes_after_selective_rerip,
    select_owner_route_ids_to_rip,
};

#[test]
fn retries_blockers_in_discovery_order() {
    let result = find_distinct_owner_blocker_path(DistinctOwnerBlockerSearchOptions {
        start: 0,
        get_state_key: &|state| *state,
        is_goal: &|state| *state == 3,
        get_hops: &|state| {
            let owners = match state {
                0 => vec![37],
                1 => vec![38, 37],
                2 => vec![23],
                _ => unreachable!(),
            };
            vec![DistinctOwnerBlockerHop {
                state: state + 1,
                distance: 1.0,
                owners: Some(owners),
                data: Some(()),
            }]
        },
        max_expanded_labels: None,
    });
    let DistinctOwnerBlockerSearchResult::Success(path) = result else {
        panic!("Expected the blocker path to reach its goal");
    };
    let owners: Vec<_> = path.owners.into_iter().collect();
    assert_eq!(owners, [37, 38, 23]);
    let ripped = select_owner_route_ids_to_rip(46, &owners, None);
    assert_eq!(
        order_routes_after_selective_rerip(46, &[46, 48, 37, 49, 23, 38], &ripped),
        [46, 48, 49, 37, 38, 23]
    );
}
