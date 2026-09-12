use serde_json::json;
use tiny_hypergraph::{
    TinyHyperGraphSolver, TinyHyperGraphSolverOptions, load_serialized_hyper_graph,
};

#[test]
fn trace_density_cost_scales_by_area_layers_and_configured_factor() {
    for (layers, expected) in [(vec![], 0.01), (vec![0], 0.04), (vec![0, 1], 0.01)] {
        let loaded = load_serialized_hyper_graph(&json!({
            "regions": [{"regionId": "region", "pointIds": [],
                "d": {"width": 2, "height": 2, "availableZ": layers}}],
            "ports": [], "connections": []
        }));
        let mut solver = TinyHyperGraphSolver::new(
            loaded.topology,
            loaded.problem,
            Some(TinyHyperGraphSolverOptions {
                trace_density_cost_factor: Some(1.0),
                ..Default::default()
            }),
        );
        assert!((solver.compute_region_cost_for_region(0, 0, 0, 0, 4) - expected).abs() < 1e-12);
        solver.options.trace_density_cost_factor = 0.0;
        assert_eq!(solver.compute_region_cost_for_region(0, 0, 0, 0, 4), 0.0);
    }
}
