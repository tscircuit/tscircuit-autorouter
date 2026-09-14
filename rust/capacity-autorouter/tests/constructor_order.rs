use serde_json::json;
use capacity_autorouter::solvers::uniform_port_distribution_solver::types::Name;
use capacity_autorouter::solvers::uniform_port_distribution_solver::uniform_port_distribution_solver::{UniformPortDistributionConstructor, UniformPortDistributionInput};
use capacity_autorouter::solvers::uniform_port_distribution_solver::determine_owner_pair::determine_owner_pair;
use capacity_autorouter::solvers::uniform_port_distribution_solver::get_owner_pair_key::normalize_owner_pair;

#[test]
fn constructor_preserves_first_match_dedupe_sources_and_ordered_edges() {
    let input: UniformPortDistributionInput = serde_json::from_value(json!({
        "nodeWithPortPoints":[
            {"capacityMeshNodeId":"a","center":{"x":-1,"y":0},"width":2,"height":2,"portPoints":[
                {"portPointId":"p","x":0,"y":0.4},{"portPointId":"p","x":0,"y":-0.4},
                {"portPointId":"solo","x":-1,"y":0}]},
            {"capacityMeshNodeId":"b","center":{"x":1,"y":0},"width":2,"height":2,"portPoints":[
                {"portPointId":"p","x":0,"y":0.4},{"portPointId":"q","x":0,"y":-0.6}]}],
        "inputNodesWithPortPoints":[
            {"portPoints":[{"portPointId":"p"},{"portPointId":"p","connectionNodeIds":["wrong","pair"]},
                {"portPointId":"invalid","connectionNodeIds":[]}]},
            {"portPoints":[{"portPointId":"p","connectionNodeIds":["b","a"]},
                {"portPointId":"q","connectionNodeIds":["a","b"]},
                {"portPointId":"invalid","connectionNodeIds":["a","b"]}]}]
    })).unwrap();
    let result = UniformPortDistributionConstructor::new(&input);
    assert_eq!(
        result
            .node_bounds
            .iter()
            .map(|entry| serde_json::to_value(&entry.0).unwrap())
            .collect::<Vec<_>>(),
        vec![json!("a"), json!("b")]
    );
    assert_eq!(
        result
            .owner_pair_port_points
            .iter()
            .map(|entry| serde_json::to_value(&entry.0).unwrap())
            .collect::<Vec<_>>(),
        vec![json!("a|b"), json!("a|a")]
    );
    let family = &result.owner_pair_port_points[0].1;
    assert_eq!(
        family
            .iter()
            .map(|point| (point.node_index, point.point_index))
            .collect::<Vec<_>>(),
        vec![(0, 0), (1, 1)]
    );
    assert_eq!(
        serde_json::to_value(&family[0].owner_node_ids).unwrap(),
        json!(["a", "b"])
    );
    assert_eq!(
        serde_json::to_value(&result.owner_pairs_to_process).unwrap(),
        json!(["a|b"])
    );
    let edge = &result.shared_edges[0].1;
    assert_eq!((edge.x1, edge.y1, edge.x2, edge.y2), (0.0, -1.0, 0.0, 1.0));
    let invalid = Name::String("invalid".into());
    let current = Name::String("current".into());
    assert_eq!(
        determine_owner_pair(
            Some(&invalid),
            &current,
            &input.input_nodes_with_port_points
        ),
        [current.clone(), current]
    );
    let bmp = Name::String("\u{e000}".into());
    let supplementary = Name::String("\u{10000}".into());
    assert_eq!(
        normalize_owner_pair(&bmp, &supplementary),
        [supplementary, bmp]
    );
    let lone = Name::Units {
        __utf16: vec![0xd800],
    };
    let replacement = Name::String("\u{fffd}".into());
    assert_eq!(
        normalize_owner_pair(&replacement, &lone),
        [lone.clone(), replacement.clone()]
    );
    let key = capacity_autorouter::solvers::uniform_port_distribution_solver::get_owner_pair_key::get_owner_pair_key(&[lone,replacement]);
    assert_eq!(
        key,
        Name::Units {
            __utf16: vec![0xd800, 0x7c, 0xfffd]
        }
    );
}
