use super::*;

#[test]
fn opt_in_invalid_geometry_after_exhausting_growth() {
    let mut solver = make_solver();
    solver.constructor_params["fallbackToInvalidGeometryOnFailure"] = json!(true);
    for _ in 0..4 {
        solver.step(&mut failing_portfolio, None).unwrap();
    }
    assert!(solver.solved);
    assert!(!solver.failed);
    assert!(solver.error.is_none());
    assert_eq!(solver.stats["invalidGeometryFallback"], json!(true));
    assert_eq!(solver.stats["reason"], json!("growth attempts exhausted"));
    assert_eq!(solver.solved_routes.len(), 1);
}
