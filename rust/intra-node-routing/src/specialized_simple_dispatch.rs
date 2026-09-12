use serde_json::Value;
use crate::specialized_solver::SpecializedEngine;
use crate::single_layer_no_different_root_intersections_intra_node_solver::SingleLayerNoDifferentRootIntersectionsIntraNodeSolver;
use crate::single_transition_through_obstacle_intra_node_solver::SingleTransitionThroughObstacleIntraNodeSolver;

pub fn invoke(
    engine: &mut SpecializedEngine,
    method: &str,
    args: Vec<Value>,
) -> Result<(Value, Vec<Value>), String> {
    let result = match engine {
        SpecializedEngine::SingleLayer(solver) => match method {
            // Map entries preserve insertion order; the facade restores the Map.
            "buildTaskGroups" => serde_json::to_value(
                solver.build_task_groups().into_iter().collect::<Vec<_>>()
            ).map_err(|error| error.to_string())?,
            "trySolveNode" => serde_json::to_value(solver.try_solve_node())
                .map_err(|error| error.to_string())?,
            _ => return Err(format!("Unknown SingleLayerNoDifferentRootIntersectionsIntraNodeSolver method: {method}")),
        },
        SpecializedEngine::SingleTransition(solver) => match method {
            "extractRoutesFromNode" => Value::Array(solver.extract_routes_from_node()),
            "calculateBounds" => solver.calculate_bounds(),
            "createTransitionRoute" => {
                let params = args.first().ok_or("createTransitionRoute requires parameters")?;
                let start = params.get("start").ok_or("createTransitionRoute requires start")?;
                let end = params.get("end").ok_or("createTransitionRoute requires end")?;
                let via = params.get("via").ok_or("createTransitionRoute requires via")?;
                let name = params.get("connectionName").and_then(Value::as_str)
                    .ok_or("createTransitionRoute requires connectionName")?;
                solver.create_transition_route(start, end, via, name)
            }
            _ => return Err(format!("Unknown SingleTransitionIntraNodeSolver method: {method}")),
        },
        SpecializedEngine::ThroughObstacle(solver) => match method {
            "extractRoutesFromNode" => Value::Array(solver.extract_routes_from_node()),
            "getContainingThroughObstacle" => {
                let route = args.first().ok_or("getContainingThroughObstacle requires a route")?;
                solver.get_containing_through_obstacle(route).cloned().unwrap_or(Value::Null)
            }
            _ => return Err(format!("Unknown SingleTransitionThroughObstacleIntraNodeSolver method: {method}")),
        },
        _ => return Err(format!("Simple method dispatcher cannot invoke {method} on this solver")),
    };
    Ok((result, args))
}

pub fn is_applicable(kind: &str, params: Value) -> Result<bool, String> {
    match kind {
        "single-layer" => Ok(SingleLayerNoDifferentRootIntersectionsIntraNodeSolver::is_applicable(&params)),
        "through-obstacle" => SingleTransitionThroughObstacleIntraNodeSolver::is_applicable(params),
        _ => Err(format!("Specialized solver {kind} has no static isApplicable method")),
    }
}
