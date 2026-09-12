use serde_json::Value;
use crate::bindings::high_density::specialized_base_solver::{BaseSolverState, SpecializedSolver};
use crate::bindings::high_density::specialized_utils::math::SpecializedMath;
use crate::solvers::high_density_solver::single_layer_no_different_root_intersections_intra_node_solver::SingleLayerNoDifferentRootIntersectionsIntraNodeSolver;
use crate::solvers::high_density_solver::single_transition_intra_node_solver::SingleTransitionIntraNodeSolver;
use crate::solvers::high_density_solver::single_transition_through_obstacle_intra_node_solver::SingleTransitionThroughObstacleIntraNodeSolver;
use crate::solvers::high_density_solver::two_route_high_density_solver::two_crossing_routes_high_density_solver::TwoCrossingRoutesHighDensitySolver;
use crate::solvers::high_density_solver::two_route_high_density_solver::single_transition_crossing_route_solver::SingleTransitionCrossingRouteSolver;
use crate::solvers::high_density_solver::multi_head_poly_line_intra_node_solver::multi_head_poly_line_intra_node_solver::MultiHeadPolyLineIntraNodeSolver;
use crate::solvers::high_density_solver::multi_head_poly_line_intra_node_solver::multi_head_poly_line_intra_node_solver2_optimized::MultiHeadPolyLineIntraNodeSolver2;
use crate::solvers::high_density_solver::multi_head_poly_line_intra_node_solver::multi_head_poly_line_intra_node_solver3_via_possibilities_solver_integration::MultiHeadPolyLineIntraNodeSolver3;
use crate::solvers::via_possibilities_solver::via_possibilities_solver2::ViaPossibilitiesSolver2;

pub enum SpecializedEngine {
    SingleLayer(Box<SingleLayerNoDifferentRootIntersectionsIntraNodeSolver>),
    SingleTransition(Box<SingleTransitionIntraNodeSolver>),
    ThroughObstacle(Box<SingleTransitionThroughObstacleIntraNodeSolver>),
    TwoCrossing(Box<TwoCrossingRoutesHighDensitySolver>),
    TransitionCrossing(Box<SingleTransitionCrossingRouteSolver>),
    MultiHead(Box<MultiHeadPolyLineIntraNodeSolver>),
    MultiHead2(Box<MultiHeadPolyLineIntraNodeSolver2>),
    MultiHead3(Box<MultiHeadPolyLineIntraNodeSolver3>),
    ViaPossibilities2(Box<ViaPossibilitiesSolver2>),
}

impl SpecializedEngine {
    pub fn new(kind: &str, params: Value, math: SpecializedMath) -> Result<Self, String> {
        match kind {
            "single-layer" => Ok(Self::SingleLayer(Box::new(
                SingleLayerNoDifferentRootIntersectionsIntraNodeSolver::new_with_math(
                    params, math,
                )?,
            ))),
            "single-transition" => Ok(Self::SingleTransition(Box::new(
                SingleTransitionIntraNodeSolver::new_with_math(params, math)?,
            ))),
            "through-obstacle" => Ok(Self::ThroughObstacle(Box::new(
                SingleTransitionThroughObstacleIntraNodeSolver::new_with_math(params, math)?,
            ))),
            "two-crossing" => Ok(Self::TwoCrossing(Box::new(
                TwoCrossingRoutesHighDensitySolver::new_with_math(params, math)?,
            ))),
            "transition-crossing" => Ok(Self::TransitionCrossing(Box::new(
                SingleTransitionCrossingRouteSolver::new_with_math(params, math)?,
            ))),
            "multi-head" => Ok(Self::MultiHead(Box::new(
                MultiHeadPolyLineIntraNodeSolver::new_with_math(params, math)?,
            ))),
            "multi-head2" => Ok(Self::MultiHead2(Box::new(
                MultiHeadPolyLineIntraNodeSolver2::new_with_math(params, math)?,
            ))),
            "multi-head3" => Ok(Self::MultiHead3(Box::new(
                MultiHeadPolyLineIntraNodeSolver3::new_with_math(params, math)?,
            ))),
            "via-possibilities2" => Ok(Self::ViaPossibilities2(Box::new(
                ViaPossibilitiesSolver2::new_with_math(params, math)?,
            ))),
            _ => Err(format!("Unknown specialized high-density solver: {kind}")),
        }
    }

    pub fn solver(&self) -> &dyn SpecializedSolver {
        match self {
            Self::SingleLayer(solver) => solver.as_ref(),
            Self::SingleTransition(solver) => solver.as_ref(),
            Self::ThroughObstacle(solver) => solver.as_ref(),
            Self::TwoCrossing(solver) => solver.as_ref(),
            Self::TransitionCrossing(solver) => solver.as_ref(),
            Self::MultiHead(solver) => solver.as_ref(),
            Self::MultiHead2(solver) => solver.as_ref(),
            Self::MultiHead3(solver) => solver.as_ref(),
            Self::ViaPossibilities2(solver) => solver.as_ref(),
        }
    }

    pub fn solver_mut(&mut self) -> &mut dyn SpecializedSolver {
        match self {
            Self::SingleLayer(solver) => solver.as_mut(),
            Self::SingleTransition(solver) => solver.as_mut(),
            Self::ThroughObstacle(solver) => solver.as_mut(),
            Self::TwoCrossing(solver) => solver.as_mut(),
            Self::TransitionCrossing(solver) => solver.as_mut(),
            Self::MultiHead(solver) => solver.as_mut(),
            Self::MultiHead2(solver) => solver.as_mut(),
            Self::MultiHead3(solver) => solver.as_mut(),
            Self::ViaPossibilities2(solver) => solver.as_mut(),
        }
    }

    pub fn state(&self) -> &BaseSolverState {
        self.solver().base()
    }

    pub fn invoke(
        &mut self,
        method: &str,
        args: Vec<Value>,
    ) -> Result<(Value, Vec<Value>), String> {
        match self {
            Self::SingleLayer(_) | Self::SingleTransition(_) | Self::ThroughObstacle(_) => {
                crate::bindings::high_density::specialized_simple_dispatch::invoke(
                    self, method, args,
                )
            }
            Self::TwoCrossing(_) | Self::TransitionCrossing(_) => {
                crate::bindings::high_density::specialized_crossing_dispatch::invoke(
                    self, method, args,
                )
            }
            Self::MultiHead(_)
            | Self::MultiHead2(_)
            | Self::MultiHead3(_)
            | Self::ViaPossibilities2(_) => {
                crate::bindings::high_density::specialized_multi_head_dispatch::invoke(
                    self, method, args,
                )
            }
        }
    }

    pub fn snapshot(&self) -> Result<Value, String> {
        let result = match self {
            Self::SingleLayer(solver) => serde_json::to_value(solver),
            Self::SingleTransition(solver) => serde_json::to_value(solver),
            Self::ThroughObstacle(solver) => serde_json::to_value(solver),
            Self::TwoCrossing(solver) => serde_json::to_value(solver),
            Self::TransitionCrossing(solver) => serde_json::to_value(solver),
            Self::MultiHead(solver) => serde_json::to_value(solver),
            Self::MultiHead2(solver) => serde_json::to_value(solver),
            Self::MultiHead3(solver) => serde_json::to_value(solver),
            Self::ViaPossibilities2(solver) => serde_json::to_value(solver),
        };
        result.map_err(|error| error.to_string())
    }

    pub fn solved_routes(&self) -> Result<&[Value], String> {
        match self {
            Self::SingleLayer(solver) => Ok(&solver.solved_routes),
            Self::SingleTransition(solver) => Ok(&solver.solved_routes),
            Self::ThroughObstacle(solver) => Ok(&solver.solved_routes),
            Self::TwoCrossing(solver) => Ok(&solver.solved_routes),
            Self::TransitionCrossing(solver) => Ok(&solver.solved_routes),
            Self::MultiHead(solver) => Ok(&solver.solved_routes),
            Self::MultiHead2(solver) => Ok(&solver.solved_routes),
            Self::MultiHead3(solver) => Ok(&solver.solved_routes),
            Self::ViaPossibilities2(_) => {
                Err("ViaPossibilitiesSolver2 exposes completedPaths, not solvedRoutes".into())
            }
        }
    }

    pub fn restore(&mut self, snapshot: Value, math: SpecializedMath) -> Result<(), String> {
        match self {
            Self::SingleLayer(solver) => {
                **solver = serde_json::from_value(snapshot).map_err(|error| error.to_string())?
            }
            Self::SingleTransition(solver) => {
                **solver = serde_json::from_value(snapshot).map_err(|error| error.to_string())?
            }
            Self::ThroughObstacle(solver) => {
                **solver = serde_json::from_value(snapshot).map_err(|error| error.to_string())?
            }
            Self::TwoCrossing(solver) => {
                **solver = serde_json::from_value(snapshot).map_err(|error| error.to_string())?;
                solver.math = math;
            }
            Self::TransitionCrossing(solver) => {
                **solver = serde_json::from_value(snapshot).map_err(|error| error.to_string())?;
                solver.math = math;
            }
            Self::MultiHead(solver) => {
                **solver = serde_json::from_value(snapshot).map_err(|error| error.to_string())?;
                solver.math = math;
                solver.variant = 1;
            }
            Self::MultiHead2(solver) => {
                **solver = serde_json::from_value(snapshot).map_err(|error| error.to_string())?;
                solver.math = math;
                solver.variant = 2;
            }
            Self::MultiHead3(solver) => {
                **solver = serde_json::from_value(snapshot).map_err(|error| error.to_string())?;
                solver.math = math;
                solver.variant = 3;
            }
            Self::ViaPossibilities2(solver) => {
                **solver = serde_json::from_value(snapshot).map_err(|error| error.to_string())?;
                solver.math = math;
            }
        }
        Ok(())
    }

    pub fn visualize(&self, transparentize: &dyn Fn(&str, f64) -> String) -> Value {
        match self {
            Self::SingleLayer(solver) => solver.visualize(),
            Self::SingleTransition(solver) => solver.visualize(),
            Self::ThroughObstacle(solver) => solver.visualize(),
            Self::TwoCrossing(solver) => solver.visualize(),
            Self::TransitionCrossing(solver) => solver.visualize(),
            Self::MultiHead(solver) => solver.visualize(transparentize),
            Self::MultiHead2(solver) => solver.visualize(transparentize),
            Self::MultiHead3(solver) => solver.visualize(transparentize),
            Self::ViaPossibilities2(solver) => solver.visualize(transparentize),
        }
    }
}
