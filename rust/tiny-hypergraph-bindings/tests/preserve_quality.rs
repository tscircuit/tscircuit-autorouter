use serde_json::json;
use tiny_hypergraph::{
    load_serialized_hyper_graph, SelectiveReripTinyHyperGraphSolver, TinyHyperGraphSolution,
    TinyHyperGraphSolverOptions,
};

#[test]
fn quality_rerips_preserve_initial_routes_when_other_routes_touch_the_hot_region() {
    let loaded = load_serialized_hyper_graph(&json!({
        "regions": [
            {"regionId": "west", "pointIds": ["a"], "d": {}},
            {"regionId": "east", "pointIds": ["b"], "d": {}},
            {"regionId": "north", "pointIds": ["c"], "d": {}},
            {"regionId": "south", "pointIds": ["d"], "d": {}},
            {"regionId": "middle", "pointIds": ["a", "b", "c", "d"],
             "d": {"width": 2, "height": 2},
             "assignments": [{"connectionId": "fixed", "regionPort1Id": "a", "regionPort2Id": "b"}]}
        ],
        "ports": [
            {"portId": "a", "region1Id": "west", "region2Id": "middle", "d": {"x": -1, "y": 0}},
            {"portId": "b", "region1Id": "east", "region2Id": "middle", "d": {"x": 1, "y": 0}},
            {"portId": "c", "region1Id": "north", "region2Id": "middle", "d": {"x": 0, "y": 1}},
            {"portId": "d", "region1Id": "south", "region2Id": "middle", "d": {"x": 0, "y": -1}}
        ],
        "connections": [
            {"connectionId": "fixed", "startRegionId": "west", "endRegionId": "east"},
            {"connectionId": "other", "startRegionId": "north", "endRegionId": "south"}
        ]
    }));
    let options = TinyHyperGraphSolverOptions {
        partial_rip_enabled: Some(true),
        partial_rip_min_route_count: Some(0.0),
        ..Default::default()
    };
    let solution = TinyHyperGraphSolution {
        solved_route_path_segments: vec![vec![(0, 1)], vec![(2, 3)]],
        solved_route_path_region_ids: Some(vec![vec![Some(4)], vec![Some(4)]]),
    };
    let baseline = tiny_hypergraph::section_solver::create_solved_solver_from_solution(
        &loaded.topology, &loaded.problem, &solution, &options,
    );
    let mut solver = SelectiveReripTinyHyperGraphSolver::new(
        loaded.topology, loaded.problem, Some(options),
    );
    solver.outside_in.distance_aware.core = baseline;
    solver.preserve_initial_assignments = true;
    assert!(solver.prepare_partial_rip(&[4], &[0.0, 0.0, 0.0, 0.0, 1.0]));
    assert_eq!(solver.state.region_segments[4], vec![(0, 0, 1)]);
    assert_eq!(solver.state.unrouted_routes, vec![1]);
    assert_eq!(solver.partially_ripped_route_count, 1);
}
