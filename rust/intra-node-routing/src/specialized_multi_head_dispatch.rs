use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use crate::specialized_solver::SpecializedEngine;
use crate::multi_head_poly_line_intra_node_solver::multi_head_poly_line_intra_node_solver::MultiHeadPolyLineIntraNodeSolver;
use crate::multi_head_poly_line_intra_node_solver::types1::{Candidate, PolyLine};

fn argument<T: DeserializeOwned>(args: &[Value], index: usize, method: &str) -> Result<T, String> {
    let value = args.get(index).ok_or_else(|| {
        format!("Missing argument {index} for {method}")
    })?;
    serde_json::from_value(value.clone()).map_err(|error| {
        format!("Invalid argument {index} for {method}: {error}")
    })
}

pub fn invoke(
    engine: &mut SpecializedEngine,
    method: &str,
    mut args: Vec<Value>,
) -> Result<(Value, Vec<Value>), String> {
    if let SpecializedEngine::ViaPossibilities2(solver) = engine {
        let point: Value = argument(&args, 0, method)?;
        let result = match method {
            "_padByNewHeadWallBuffer" => solver.pad_by_new_head_wall_buffer(&point),
            "_padByPlaceholderWallBuffer" => solver.pad_by_placeholder_wall_buffer(&point),
            _ => return Err(format!("Unknown ViaPossibilitiesSolver2 method: {method}")),
        };
        return Ok((result, args));
    }

    let solver: &mut MultiHeadPolyLineIntraNodeSolver = match engine {
        SpecializedEngine::MultiHead(solver) => solver,
        SpecializedEngine::MultiHead2(solver) => &mut solver.inner,
        SpecializedEngine::MultiHead3(solver) => &mut solver.inner.inner,
        _ => return Err(format!("MultiHead method dispatcher cannot invoke {method} on this solver")),
    };
    let result = match method {
        "computeMinGapBtwPolyLines" => {
            let lines: Vec<PolyLine> = argument(&args, 0, method)?;
            json!(solver.compute_min_gap_btw_poly_lines(&lines))
        }
        "insertCandidate" => {
            let candidate: Candidate = argument(&args, 0, method)?;
            solver.insert_candidate(candidate);
            Value::Null
        }
        "setupInitialPolyLines" => {
            solver.setup_initial_poly_lines()?;
            Value::Null
        }
        "computeG" | "computeH" | "checkIfSolved" => {
            let index = if method == "computeG" { 1 } else { 0 };
            let value = args.get(index).ok_or_else(|| format!("Missing argument {index} for {method}"))?;
            // Public signatures accept Picks of Candidate; only decode the fields
            // consumed by the selected method, rather than requiring a full candidate.
            let mut candidate = Candidate {diagnostic_id: crate::multi_head_poly_line_intra_node_solver::types1::next_diagnostic_id(), poly_lines_id: crate::multi_head_poly_line_intra_node_solver::types1::next_diagnostic_id(), min_gaps_id: crate::multi_head_poly_line_intra_node_solver::types1::next_diagnostic_id(),
                poly_lines: Vec::new(),
                g: 0.0,
                h: 0.0,
                f: 0.0,
                min_gaps: Vec::new(),
                forces: None,
                via_count: 0,
                mag_force_applied: None,
                has_closed_same_layer_face: None,
            };
            if method == "computeG" {
                candidate.g = serde_json::from_value(value["g"].clone()).map_err(|error| error.to_string())?;
                candidate.via_count = serde_json::from_value(value["viaCount"].clone()).map_err(|error| error.to_string())?;
                json!(solver.compute_g(&[], &candidate))
            } else if method == "computeH" {
                if solver.variant >= 2 {
                    candidate.min_gaps = serde_json::from_value(value["minGaps"].clone()).map_err(|error| error.to_string())?;
                } else {
                    candidate.forces = serde_json::from_value(value["forces"].clone()).map_err(|error| error.to_string())?;
                }
                json!(solver.compute_h(&candidate))
            } else {
                candidate.min_gaps = serde_json::from_value(value["minGaps"].clone()).map_err(|error| error.to_string())?;
                candidate.poly_lines = serde_json::from_value(value["polyLines"].clone()).map_err(|error| error.to_string())?;
                json!(solver.check_if_solved(&candidate))
            }
        }
        "getNeighbors" => {
            let candidate: Candidate = argument(&args, 0, method)?;
            serde_json::to_value(solver.get_neighbors(&candidate)).map_err(|error| error.to_string())?
        }
        "_setSolvedRoutes" => {
            let returned_empty = !solver.base.solved || solver.last_candidate.is_none();
            solver.set_solved_routes();
            if returned_empty { json!([]) } else { Value::Null }
        }
        "applyForcesToPolyLines" if solver.variant >= 2 => {
            let mut lines: Vec<PolyLine> = argument(&args, 0, method)?;
            let result = solver.apply_forces_to_poly_lines(&mut lines);
            // The source mutates only middle-point coordinates. Preserve every
            // untouched argument field and its original property insertion order.
            for (line_index, line) in lines.iter().enumerate() {
                for (point_index, point) in line.m_points.iter().enumerate() {
                    args[0][line_index]["mPoints"][point_index]["x"] = json!(point.x);
                    args[0][line_index]["mPoints"][point_index]["y"] = json!(point.y);
                }
            }
            json!({"lastStepMoved": result.last_step_moved, "magForceApplied": result.mag_force_applied})
        }
        "createInitialCandidateFromSeed" if solver.variant == 3 => {
            let seed: f64 = argument(&args, 0, method)?;
            serde_json::to_value(solver.create_initial_candidate_from_seed(seed)?).map_err(|error| error.to_string())?
        }
        _ => return Err(format!("Unknown MultiHeadPolyLineIntraNodeSolver method: {method}")),
    };
    Ok((result, args))
}
