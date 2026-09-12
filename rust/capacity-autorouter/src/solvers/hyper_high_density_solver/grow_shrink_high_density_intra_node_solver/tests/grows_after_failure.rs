use super::*;

#[test]
fn grows_after_inner_failure() {
    let mut solver = make_solver();
    solver.max_growth_attempts = 1.0;
    solver.step(&mut failing_portfolio, None).unwrap();
    assert!(!solver.failed);
    assert_eq!(solver.growth_attempts, 1.0);
    assert_eq!(solver.scale_factor, 2.0);
    assert_eq!(solver.failed_solvers.len(), 1);
}
