use crate::bindings::high_density::specialized_solver::SpecializedEngine;
use serde_json::Value;

pub fn invoke(
    engine: &mut SpecializedEngine,
    method: &str,
    args: Vec<Value>,
) -> Result<(Value, Vec<Value>), String> {
    let result = match engine {
        SpecializedEngine::TwoCrossing(solver) => match method {
            "handleRoutesDontCross" => {
                solver.handle_routes_dont_cross();
                Value::Null
            }
            "getSolvedRoutes" => Value::Array(solver.get_solved_routes().to_vec()),
            _ => {
                return Err(format!(
                    "Unknown TwoCrossingRoutesHighDensitySolver method: {method}"
                ));
            }
        },
        SpecializedEngine::TransitionCrossing(solver) => match method {
            "getSolvedRoutes" => Value::Array(solver.get_solved_routes().to_vec()),
            _ => {
                return Err(format!(
                    "Unknown SingleTransitionCrossingRouteSolver method: {method}"
                ));
            }
        },
        _ => {
            return Err(format!(
                "Crossing method dispatcher cannot invoke {method} on this solver"
            ));
        }
    };
    Ok((result, args))
}
