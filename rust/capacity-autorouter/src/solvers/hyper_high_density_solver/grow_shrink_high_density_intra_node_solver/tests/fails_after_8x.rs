use super::*;

#[test]
fn fails_after_an_8x_resize_fails() {
    let mut solver = make_solver();
    for scale in [2.0, 4.0, 8.0] {
        solver.step(&mut failing_portfolio, None).unwrap();
        assert!(!solver.failed);
        assert_eq!(solver.scale_factor, scale);
    }
    solver.step(&mut failing_portfolio, None).unwrap();
    assert!(solver.failed);
    assert_eq!(solver.growth_attempts, 3.0);
    assert_eq!(solver.failed_solvers.len(), 4);
    assert!(solver.error.unwrap().contains("resizing to 8x"));
}
