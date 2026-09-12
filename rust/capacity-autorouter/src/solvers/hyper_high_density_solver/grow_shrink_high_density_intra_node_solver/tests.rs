use super::*;

struct FakePortfolio {
    id: u32,
    state: GrowthPortfolioState,
    routes: Vec<Value>,
    fail: bool,
}

impl GrowthPortfolio for FakePortfolio {
    fn id(&self) -> u32 {
        self.id
    }
    fn step(&mut self) -> Result<(), String> {
        self.state.iterations += 1;
        self.state.solved = !self.fail;
        self.state.failed = self.fail;
        self.state.error = self.fail.then(|| "forced failure".into());
        Ok(())
    }
    fn state(&self) -> GrowthPortfolioState {
        self.state.clone()
    }
    fn set_max_iterations(&mut self, iterations: f64) {
        self.state.max_iterations = iterations;
    }
    fn solved_routes(&self) -> Result<Vec<Value>, String> {
        Ok(self.routes.clone())
    }
    fn reject_solution(&mut self, error: &str) {
        self.state.solved = false;
        self.state.failed = true;
        self.state.error = Some(error.into());
    }
    fn visualize(&self) -> Result<Value, String> {
        Ok(json!({"title":self.id}))
    }
}

#[path = "tests/exhausted_growth_fallback.rs"]
mod exhausted_growth_fallback;
#[path = "tests/fails_after_8x.rs"]
mod fails_after_8x;
#[path = "tests/grows_after_failure.rs"]
mod grows_after_failure;
#[path = "tests/shrinks_solution.rs"]
mod shrinks_solution;

fn make_solver() -> GrowShrinkHighDensityIntraNodeSolver {
    GrowShrinkHighDensityIntraNodeSolver::new(json!({
        "nodeWithPortPoints": {"capacityMeshNodeId":"cn1", "center":{"x":10,"y":20},
            "width":1,"height":1,"portPoints":[
                {"connectionName":"a","x":9.5,"y":20,"z":0},
                {"connectionName":"a","x":10.5,"y":20,"z":0}]}
    }))
}

fn failing_portfolio(_: Value) -> Result<Box<dyn GrowthPortfolio>, String> {
    Ok(Box::new(FakePortfolio {
        id: 1,
        state: GrowthPortfolioState {
            iterations: 0,
            max_iterations: 1000.0,
            solved: false,
            failed: false,
            progress: 0.0,
            error: None,
        },
        routes: vec![],
        fail: true,
    }))
}

#[test]
fn rejected_attempt_then_scaled_winner_preserves_child_ids_and_limits() {
    let mut solver = GrowShrinkHighDensityIntraNodeSolver::new(json!({
        "nodeWithPortPoints":{"capacityMeshNodeId":"node","center":{"x":2,"y":3},
            "width":2,"height":4,"availableZ":[0,1],"portPoints":[]},
        "maxGrowthAttempts":2,"maxInnerIterationsPerGrowthAttempt":7
    }));
    let mut next_id = 0;
    let mut factory = |params: Value| -> Result<Box<dyn GrowthPortfolio>, String> {
        next_id += 1;
        assert_eq!(
            params["nodeWithPortPoints"]["width"],
            json!(2.0 * next_id as f64)
        );
        Ok(Box::new(FakePortfolio {
            id: next_id,
            state: GrowthPortfolioState {
                iterations: 0,
                max_iterations: 1000.0,
                solved: false,
                failed: false,
                progress: 0.25,
                error: None,
            },
            fail: false,
            routes: vec![json!({"connectionName":"a","route":[{"x":4,"y":5,"z":0}],"vias":[]})],
        }))
    };
    let mut validations = 0;
    let mut validator =
        |routes: &[Value], _state: &Value| -> Result<(bool, Option<Value>), String> {
            validations += 1;
            assert_eq!(
                routes[0]["route"][0]["x"].as_f64(),
                Some(if validations == 1 { 4.0 } else { 3.0 })
            );
            Ok((validations == 2, None))
        };
    solver.step(&mut factory, Some(&mut validator)).unwrap();
    assert_eq!(solver.failed_solvers[0].id(), 1);
    assert_eq!(solver.failed_solvers[0].state().max_iterations, 7.0);
    assert!(!solver.failed_solvers[0].state().solved);
    assert!(solver.failed_solvers[0].state().failed);
    assert_eq!(solver.scale_factor, 2.0);
    assert_eq!(solver.progress, 1.0 / 3.0);
    solver.step(&mut factory, Some(&mut validator)).unwrap();
    assert!(solver.solved);
    assert!(solver.active_sub_solver.is_none());
    assert_eq!(solver.winning_solver.as_ref().unwrap().id(), 2);
    assert_eq!(
        solver
            .winning_solver
            .as_ref()
            .unwrap()
            .state()
            .max_iterations,
        7.0
    );
    assert_eq!(solver.solved_routes[0]["route"][0]["y"].as_f64(), Some(4.0));
    assert_eq!(solver.visualize().unwrap(), json!({"title":2}));
    solver.step(&mut factory, None).unwrap();
    assert_eq!(solver.iterations, 2);
}
