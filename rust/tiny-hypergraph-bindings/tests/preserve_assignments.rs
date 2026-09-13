use serde_json::json;
use tiny_hypergraph::{SelectiveReripTinyHyperGraphSolver, load_serialized_hyper_graph};

#[test]
fn global_rerip_restores_preloaded_assignments_when_configured() {
    let graph = json!({
        "regions": [
            {"regionId": "start", "pointIds": ["a"], "d": {}},
            {"regionId": "middle", "pointIds": ["a", "b"],
             "d": {"width": 2, "height": 2},
             "assignments": [{"connectionId": "route", "regionPort1Id": "a", "regionPort2Id": "b"}]},
            {"regionId": "end", "pointIds": ["b"], "d": {}}
        ],
        "ports": [
            {"portId": "a", "region1Id": "start", "region2Id": "middle", "d": {"x": -1, "y": 0, "z": 0}},
            {"portId": "b", "region1Id": "middle", "region2Id": "end", "d": {"x": 1, "y": 0, "z": 0}}
        ],
        "connections": [{"connectionId": "route", "startRegionId": "start", "endRegionId": "end"}]
    });
    for preserve in [false, true] {
        let loaded = load_serialized_hyper_graph(&graph);
        let mut solver =
            SelectiveReripTinyHyperGraphSolver::new(loaded.topology, loaded.problem, None);
        solver.preserve_initial_assignments = preserve;
        assert_eq!(solver.state.region_segments[1], vec![(0, 0, 1)]);
        solver.reset_routing_state_for_rerip();
        if preserve {
            assert_eq!(solver.state.region_segments[1], vec![(0, 0, 1)]);
            assert!(solver.state.unrouted_routes.is_empty());
            assert_eq!(solver.state.port_assignment, vec![0, 0]);
        } else {
            assert!(solver.state.region_segments[1].is_empty());
            assert_eq!(solver.state.unrouted_routes, vec![0]);
            assert_eq!(solver.state.port_assignment, vec![-1, -1]);
        }
    }
}
