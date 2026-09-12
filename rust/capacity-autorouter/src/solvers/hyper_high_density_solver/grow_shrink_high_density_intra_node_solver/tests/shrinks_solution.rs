use super::*;

#[test]
fn shrinks_routes_and_vias_to_the_original_node() {
    let mut solver = make_solver();
    solver.scale_factor = 2.0;
    solver.active_sub_solver = Some(Box::new(FakePortfolio {
        id: 1,
        state: GrowthPortfolioState {
            iterations: 0,
            max_iterations: 1000.0,
            solved: false,
            failed: false,
            progress: 0.0,
            error: None,
        },
        fail: false,
        routes: vec![
            json!({"connectionName":"a","traceThickness":0.15,"viaDiameter":0.3,
            "route":[{"x":9,"y":20,"z":0},{"x":10,"y":22,"z":0},{"x":11,"y":20,"z":0}],
            "vias":[{"x":10,"y":22}]}),
        ],
    }));
    solver.step(&mut failing_portfolio, None).unwrap();
    assert!(solver.solved);
    assert_eq!(
        solver.solved_routes[0]["route"],
        json!([
            {"x":9.5,"y":20.0,"z":0},{"x":10.0,"y":21.0,"z":0},{"x":10.5,"y":20.0,"z":0}
        ])
    );
    assert_eq!(
        solver.solved_routes[0]["vias"],
        json!([{"x":10.0,"y":21.0}])
    );
}
