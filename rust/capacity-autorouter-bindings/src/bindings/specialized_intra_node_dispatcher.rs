use crate::bindings::high_density_wire::*;
use capacity_autorouter::bindings::high_density::specialized_solver::SpecializedEngine;
use capacity_autorouter::bindings::high_density::specialized_utils::math::SpecializedMath;
use serde_json::Value;
use std::{cell::RefCell, rc::Rc};
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;

use capacity_autorouter::solvers::high_density_solver::multi_head_poly_line_intra_node_solver::{
    multi_head_poly_line_intra_node_solver::MultiHeadPolyLineIntraNodeSolver,
    types1::{self, Candidate, PolyLine},
};
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Serialize, Deserialize, Tsify)]
pub struct SpecializedResult<T> {
    pub result: T,
    #[tsify(type = "unknown[]")]
    pub args: Vec<Value>,
    pub identity: Option<CandidateIdentity>,
}

macro_rules! specialized_result {
    ($name:ident, $result:ty) => {
        #[derive(Serialize, Deserialize, Tsify)]
        #[serde(transparent)]
        pub struct $name(SpecializedResult<$result>);

        impl $name {
            fn output(
                result: $result,
                args: Vec<Value>,
                identity: Option<Value>,
            ) -> Result<Ts<Self>, JsValue> {
                Self(SpecializedResult {
                    result,
                    args,
                    identity: identity.map(decode).transpose()?,
                })
                .into_ts()
                .map_err(|error| JsError::new(&error.to_string()).into())
            }
        }
    };
}

macro_rules! specialized_value {
    ($name:ident, $ty:literal) => {
        #[derive(Serialize, Deserialize, Tsify)]
        #[serde(transparent)]
        pub struct $name(#[tsify(type = $ty)] Value);
    };
}

specialized_value!(
    SpecializedCandidate,
    "import('../../../lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types1').Candidate"
);
specialized_value!(
    SpecializedCandidates,
    "import('../../../lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types1').Candidate[]"
);
specialized_value!(
    SpecializedOptionalCandidate,
    "import('../../../lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types1').Candidate | null"
);
specialized_value!(
    SpecializedPolyLines,
    "import('../../../lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types1').PolyLine[]"
);
specialized_value!(
    SpecializedHeuristicCandidate,
    "Pick<import('../../../lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types1').Candidate, 'minGaps' | 'forces'>"
);
specialized_value!(
    SpecializedSolvedCandidate,
    "Pick<import('../../../lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types1').Candidate, 'minGaps' | 'polyLines'>"
);
specialized_value!(
    ThroughObstacleApplicability,
    "Parameters<typeof import('../../../lib/solvers/HighDensitySolver/SingleTransitionThroughObstacleIntraNodeSolver').SingleTransitionThroughObstacleIntraNodeSolver.isApplicable>[0]"
);
specialized_value!(SpecializedPoint, "{ x: number; y: number; z: number }");
specialized_value!(
    SpecializedForceResult,
    "{ lastStepMoved: boolean; magForceApplied: number }"
);
specialized_value!(SpecializedSolvedResult, "never[] | null");

specialized_result!(SpecializedNumbersResult, Vec<f64>);
specialized_result!(SpecializedNumberResult, f64);
specialized_result!(SpecializedVoidResult, ());
specialized_result!(SpecializedBooleanResult, bool);
specialized_result!(SpecializedNeighborsResult, SpecializedCandidates);
specialized_result!(SpecializedSeedResult, SpecializedOptionalCandidate);
specialized_result!(SpecializedSetRoutesResult, SpecializedSolvedResult);
specialized_result!(SpecializedApplyForcesResult, SpecializedForceResult);
specialized_result!(SpecializedPointResult, SpecializedPoint);

fn input<T: Tsify>(value: Ts<T>) -> Result<Value, JsValue> {
    callback_mapped_value(JsValue::from(value))
}

fn decode<T: serde::de::DeserializeOwned>(value: Value) -> Result<T, JsValue> {
    serde_json::from_value(value).map_err(|error| JsError::new(&error.to_string()).into())
}

fn multi_head(
    engine: &mut SpecializedEngine,
) -> Result<&mut MultiHeadPolyLineIntraNodeSolver, JsValue> {
    types1::multi_head_mut(engine)
        .ok_or_else(|| JsError::new("This method requires a MultiHead solver").into())
}

fn partial_candidate() -> Candidate {
    Candidate {
        diagnostic_id: types1::next_diagnostic_id(),
        poly_lines_id: types1::next_diagnostic_id(),
        min_gaps_id: types1::next_diagnostic_id(),
        poly_lines: Vec::new(),
        g: 0.0,
        h: 0.0,
        f: 0.0,
        min_gaps: Vec::new(),
        forces: None,
        via_count: 0,
        mag_force_applied: None,
        has_closed_same_layer_face: None,
    }
}

fn host_math() -> SpecializedMath {
    SpecializedMath {
        sin: js_sys::Math::sin,
        cos: js_sys::Math::cos,
        atan2: js_sys::Math::atan2,
        acos: js_sys::Math::acos,
        hypot: js_sys::Math::hypot,
        pow: js_sys::Math::pow,
        exp: js_sys::Math::exp,
        round: js_sys::Math::round,
    }
}

#[wasm_bindgen]
pub struct SpecializedIntraNodeDispatcher {
    pub(crate) engine: Rc<RefCell<SpecializedEngine>>,
}

#[wasm_bindgen]
pub struct SpecializedRouterContext {
    connectivity_json: Option<Rc<Value>>,
    connectivity: Option<
        Rc<capacity_autorouter::solvers::high_density_solver::connectivity_map::ConnectivityMap>,
    >,
    obstacles: Rc<Vec<Value>>,
}

#[wasm_bindgen]
impl SpecializedRouterContext {
    #[wasm_bindgen(constructor)]
    pub fn new(props: Ts<HighDensityMappedValue>) -> Result<Self, JsValue> {
        let mut props: Value = read_mapped_value(props)?;
        let object = props
            .as_object_mut()
            .ok_or_else(|| JsValue::from_str("Specialized context requires an object"))?;
        let connectivity_json = object
            .remove("connMap")
            .filter(|value| !value.is_null())
            .map(Rc::new);
        let connectivity = connectivity_json
            .as_ref()
            .map(|value| serde_json::from_value(value.as_ref().clone()).map(Rc::new))
            .transpose()
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let layer_count = object
            .get("layerCount")
            .and_then(Value::as_f64)
            .unwrap_or(2.0);
        let obstacles = match object.remove("obstacles") {
            Some(Value::Array(obstacles)) => obstacles,
            None | Some(Value::Null) => Vec::new(),
            Some(_) => {
                return Err(JsValue::from_str(
                    "Specialized context obstacles must be an array",
                ));
            }
        };
        let obstacles = capacity_autorouter::bindings::high_density::specialized_utils::create_objects_with_z_layers::create_objects_with_z_layers_owned(obstacles, layer_count);
        Ok(Self {
            connectivity_json,
            connectivity,
            obstacles: Rc::new(obstacles),
        })
    }

    pub fn create(
        &self,
        kind: &str,
        params: Ts<HighDensityMappedValue>,
    ) -> Result<SpecializedIntraNodeDispatcher, JsValue> {
        let params: Value = read_mapped_value(params)?;
        let engine = if kind == "through-obstacle" {
            let solver = capacity_autorouter::solvers::high_density_solver::single_transition_through_obstacle_intra_node_solver::SingleTransitionThroughObstacleIntraNodeSolver::new_with_context(
                params, host_math(), self.obstacles.clone(), self.connectivity.clone(),
            ).map_err(|error| JsValue::from_str(&error))?;
            SpecializedEngine::ThroughObstacle(Box::new(solver))
        } else {
            let mut engine = SpecializedEngine::new(kind, params, host_math())
                .map_err(|error| JsValue::from_str(&error))?;
            match &mut engine {
                SpecializedEngine::MultiHead(solver) => {
                    solver.conn_map = self.connectivity_json.clone()
                }
                SpecializedEngine::MultiHead2(solver) => {
                    solver.conn_map = self.connectivity_json.clone()
                }
                SpecializedEngine::MultiHead3(solver) => {
                    solver.conn_map = self.connectivity_json.clone()
                }
                _ => {
                    return Err(JsValue::from_str(
                        "Shared specialized context requires a MultiHead or through-obstacle solver",
                    ));
                }
            }
            engine
        };
        Ok(SpecializedIntraNodeDispatcher {
            engine: Rc::new(RefCell::new(engine)),
        })
    }
}

#[wasm_bindgen]
impl SpecializedIntraNodeDispatcher {
    #[wasm_bindgen(constructor)]
    pub fn new(kind: &str, params: Ts<HighDensityMappedValue>) -> Result<Self, JsValue> {
        let params: Value = read_mapped_value(params)?;
        let engine = SpecializedEngine::new(kind, params, host_math())
            .map_err(|error| JsValue::from_str(&error))?;
        Ok(Self {
            engine: Rc::new(RefCell::new(engine)),
        })
    }

    #[wasm_bindgen(js_name = snapshot)]
    pub fn snapshot(&self) -> Result<Ts<HighDensityRecord>, JsValue> {
        let snapshot = self
            .engine
            .borrow()
            .snapshot()
            .map_err(|error| JsValue::from_str(&error))?;
        HighDensityRecord(snapshot)
            .into_ts()
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    #[wasm_bindgen(js_name = state)]
    pub fn state(&self) -> Result<Ts<HighDensityState>, JsValue> {
        HighDensityState(
            serde_json::to_value(self.engine.borrow().state())
                .map_err(|error| JsValue::from_str(&error.to_string()))?,
        )
        .into_ts()
        .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    #[wasm_bindgen(js_name = restoreState)]
    pub fn restore_state(&mut self, state: Ts<HighDensityMappedValue>) -> Result<(), JsValue> {
        let mut value: Value = read_mapped_value(state)?;
        let non_finite_progress = value["progress"].is_null();
        if non_finite_progress {
            value["progress"] = Value::from(0.0);
        }
        let mut state: capacity_autorouter::bindings::high_density::specialized_base_solver::BaseSolverState = serde_json::from_value(value)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        if non_finite_progress {
            state.progress = f64::NAN;
        }
        *self.engine.borrow_mut().solver_mut().base_mut() = state;
        Ok(())
    }

    #[wasm_bindgen(js_name = isSingleLayerApplicable)]
    pub fn is_single_layer_applicable(params: Ts<HighDensityNode>) -> Result<bool, JsValue> {
        let params = input(params)?;
        Ok(capacity_autorouter::solvers::high_density_solver::single_layer_no_different_root_intersections_intra_node_solver::SingleLayerNoDifferentRootIntersectionsIntraNodeSolver::is_applicable(&params))
    }

    #[wasm_bindgen(js_name = isThroughObstacleApplicable)]
    pub fn is_through_obstacle_applicable(
        params: Ts<ThroughObstacleApplicability>,
    ) -> Result<bool, JsValue> {
        let params = input(params)?;
        capacity_autorouter::solvers::high_density_solver::single_transition_through_obstacle_intra_node_solver::SingleTransitionThroughObstacleIntraNodeSolver::is_applicable(params)
            .map_err(|error| JsValue::from_str(&error))
    }

    #[wasm_bindgen(js_name = restore)]
    pub fn restore(&mut self, snapshot: Ts<HighDensityMappedValue>) -> Result<(), JsValue> {
        let snapshot: Value = read_mapped_value(snapshot)?;
        self.engine
            .borrow_mut()
            .restore(snapshot, host_math())
            .map_err(|error| JsValue::from_str(&error))
    }

    #[wasm_bindgen(js_name = visualize)]
    pub fn visualize(
        &self,
        #[wasm_bindgen(unchecked_param_type = "(color: string, amount: number) => string")]
        transparentize: &js_sys::Function,
    ) -> Result<Ts<HighDensityGraphics>, JsValue> {
        let callback_error = RefCell::new(None);
        let output = self
            .engine
            .borrow()
            .visualize(&|color, amount| match transparentize.call2(
                &JsValue::UNDEFINED,
                &JsValue::from_str(color),
                &JsValue::from_f64(amount),
            ) {
                Ok(value) => match value.as_string() {
                    Some(color) => color,
                    None => {
                        *callback_error.borrow_mut() = Some(JsValue::from_str(
                            "Visualization color callback must return a string",
                        ));
                        String::new()
                    }
                },
                Err(error) => {
                    *callback_error.borrow_mut() = Some(error);
                    String::new()
                }
            });
        if let Some(error) = callback_error.into_inner() {
            return Err(error);
        }
        HighDensityGraphics(output)
            .into_ts()
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    #[wasm_bindgen(js_name = solvedRoutes)]
    pub fn solved_routes(&self) -> Result<Ts<HighDensityRoutes>, JsValue> {
        let engine = self.engine.borrow();
        let routes = engine
            .solved_routes()
            .map_err(|error| JsValue::from_str(&error))?;
        HighDensityRoutes(routes.to_vec())
            .into_ts()
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    pub fn step(&mut self) -> Result<(), JsValue> {
        self.engine
            .borrow_mut()
            .solver_mut()
            .step()
            .map_err(|error| JsValue::from_str(&error))
    }

    pub fn solve(&mut self) -> Result<(), JsValue> {
        self.engine
            .borrow_mut()
            .solver_mut()
            .solve()
            .map_err(|error| JsValue::from_str(&error))
    }

    #[wasm_bindgen(js_name = stepInner)]
    pub fn step_inner(&mut self, iterations: usize, max_iterations: f64) -> Result<(), JsValue> {
        let mut engine = self.engine.borrow_mut();
        let solver = engine.solver_mut();
        solver.base_mut().iterations = iterations;
        solver.base_mut().max_iterations = max_iterations;
        solver._step().map_err(|error| JsValue::from_str(&error))
    }

    #[wasm_bindgen(js_name = tryFinalAcceptance)]
    pub fn try_final_acceptance(&mut self) -> Result<(), JsValue> {
        self.engine
            .borrow_mut()
            .solver_mut()
            .try_final_acceptance()
            .map_err(|error| JsValue::from_str(&error))
    }

    #[wasm_bindgen(js_name = computeProgress)]
    pub fn compute_progress(&self) -> f64 {
        let engine = self.engine.borrow();
        engine
            .solver()
            .compute_progress()
            .unwrap_or(engine.state().progress)
    }

    #[wasm_bindgen(js_name = shareForPortfolio)]
    pub fn share_for_portfolio(&self) -> u32 {
        crate::bindings::portfolio_single_intra_node_solver::share_specialized(self.engine.clone())
    }
}

#[wasm_bindgen]
impl SpecializedIntraNodeDispatcher {
    #[wasm_bindgen(js_name = snapshotIdentity)]
    pub fn snapshot_identity(&self) -> Result<Ts<CandidateIdentity>, JsValue> {
        let identity = capacity_autorouter::solvers::high_density_solver::multi_head_poly_line_intra_node_solver::types1::snapshot_identity(&mut self.engine.borrow_mut());
        serde_json::from_value::<CandidateIdentity>(identity)
            .map_err(|error| JsValue::from_str(&error.to_string()))?
            .into_ts()
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    #[wasm_bindgen(js_name = restoreIdentity)]
    pub fn restore_identity(
        &mut self,
        snapshot: Ts<HighDensityMappedValue>,
        identity: Ts<HighDensityMappedValue>,
    ) -> Result<(), JsValue> {
        let identity: Value = read_mapped_value(identity)?;
        self.restore(snapshot)?;
        capacity_autorouter::solvers::high_density_solver::multi_head_poly_line_intra_node_solver::types1::restore_snapshot_identity(&mut self.engine.borrow_mut(), &identity)
            .map_err(|error|JsValue::from_str(&error))
    }
}

#[wasm_bindgen]
impl SpecializedIntraNodeDispatcher {
    #[wasm_bindgen(js_name = computeMinGapBtwPolyLines)]
    pub fn compute_min_gap_btw_poly_lines(
        &mut self,
        lines: Ts<SpecializedPolyLines>,
    ) -> Result<Ts<SpecializedNumbersResult>, JsValue> {
        let lines = input(lines)?;
        let parsed: Vec<PolyLine> = decode(lines.clone())?;
        let result =
            multi_head(&mut self.engine.borrow_mut())?.compute_min_gap_btw_poly_lines(&parsed);
        SpecializedNumbersResult::output(result, vec![lines], None)
    }

    #[wasm_bindgen(js_name = insertCandidate)]
    pub fn insert_candidate(
        &mut self,
        candidate: Ts<SpecializedCandidate>,
        identity: Ts<CandidateIdentity>,
    ) -> Result<Ts<SpecializedVoidResult>, JsValue> {
        let value = input(candidate)?;
        let mut candidate: Candidate = decode(value.clone())?;
        let identity = input(identity)?;
        types1::restore_candidate_identity(&mut candidate, &identity)
            .map_err(|error| JsError::new(&error))?;
        let mut engine = self.engine.borrow_mut();
        let solver = multi_head(&mut engine)?;
        if solver
            .candidates
            .iter()
            .any(|queued| queued.diagnostic_id == candidate.diagnostic_id)
        {
            solver.has_candidate_aliases = true;
        }
        solver.insert_candidate(candidate);
        SpecializedVoidResult::output((), vec![value], None)
    }

    #[wasm_bindgen(js_name = setupInitialPolyLines)]
    pub fn setup_initial_poly_lines(&mut self) -> Result<Ts<SpecializedVoidResult>, JsValue> {
        multi_head(&mut self.engine.borrow_mut())?
            .setup_initial_poly_lines()
            .map_err(|error| JsError::new(&error))?;
        SpecializedVoidResult::output((), vec![], None)
    }

    #[wasm_bindgen(js_name = computeG)]
    pub fn compute_g(
        &mut self,
        lines: Ts<SpecializedPolyLines>,
        candidate: Ts<SpecializedCandidate>,
    ) -> Result<Ts<SpecializedNumberResult>, JsValue> {
        let lines = input(lines)?;
        let value = input(candidate)?;
        let mut candidate = partial_candidate();
        candidate.g = decode(value["g"].clone())?;
        candidate.via_count = decode(value["viaCount"].clone())?;
        let result = multi_head(&mut self.engine.borrow_mut())?.compute_g(&[], &candidate);
        SpecializedNumberResult::output(result, vec![lines, value], None)
    }

    #[wasm_bindgen(js_name = computeH)]
    pub fn compute_h(
        &mut self,
        candidate: Ts<SpecializedHeuristicCandidate>,
    ) -> Result<Ts<SpecializedNumberResult>, JsValue> {
        let value = input(candidate)?;
        let mut candidate = partial_candidate();
        let mut engine = self.engine.borrow_mut();
        let solver = multi_head(&mut engine)?;
        if solver.variant >= 2 {
            candidate.min_gaps = decode(value["minGaps"].clone())?;
        } else {
            candidate.forces = decode(value["forces"].clone())?;
        }
        SpecializedNumberResult::output(solver.compute_h(&candidate), vec![value], None)
    }

    #[wasm_bindgen(js_name = checkIfSolved)]
    pub fn check_if_solved(
        &mut self,
        candidate: Ts<SpecializedSolvedCandidate>,
    ) -> Result<Ts<SpecializedBooleanResult>, JsValue> {
        let value = input(candidate)?;
        let mut candidate = partial_candidate();
        candidate.min_gaps = decode(value["minGaps"].clone())?;
        candidate.poly_lines = decode(value["polyLines"].clone())?;
        let result = multi_head(&mut self.engine.borrow_mut())?.check_if_solved(&candidate);
        SpecializedBooleanResult::output(result, vec![value], None)
    }

    #[wasm_bindgen(js_name = getNeighbors)]
    pub fn get_neighbors(
        &mut self,
        candidate: Ts<SpecializedCandidate>,
        identity: Ts<CandidateIdentity>,
    ) -> Result<Ts<SpecializedNeighborsResult>, JsValue> {
        let value = input(candidate)?;
        let mut candidate: Candidate = decode(value.clone())?;
        types1::restore_candidate_identity(&mut candidate, &input(identity)?)
            .map_err(|error| JsError::new(&error))?;
        let neighbors = multi_head(&mut self.engine.borrow_mut())?.get_neighbors(&candidate);
        let identity =
            json!({"items":neighbors.iter().map(types1::candidate_identity).collect::<Vec<_>>()});
        SpecializedNeighborsResult::output(
            SpecializedCandidates(json!(neighbors)),
            vec![value],
            Some(identity),
        )
    }

    #[wasm_bindgen(js_name = setSolvedRoutes)]
    pub fn set_solved_routes(&mut self) -> Result<Ts<SpecializedSetRoutesResult>, JsValue> {
        let mut engine = self.engine.borrow_mut();
        let solver = multi_head(&mut engine)?;
        let returned_empty = !solver.base.solved || solver.last_candidate.is_none();
        solver.set_solved_routes();
        SpecializedSetRoutesResult::output(
            SpecializedSolvedResult(if returned_empty {
                json!([])
            } else {
                Value::Null
            }),
            vec![],
            None,
        )
    }

    #[wasm_bindgen(js_name = applyForcesToPolyLines)]
    pub fn apply_forces_to_poly_lines(
        &mut self,
        lines: Ts<SpecializedPolyLines>,
    ) -> Result<Ts<SpecializedApplyForcesResult>, JsValue> {
        let mut value = input(lines)?;
        let mut lines: Vec<PolyLine> = decode(value.clone())?;
        let mut engine = self.engine.borrow_mut();
        let solver = multi_head(&mut engine)?;
        if solver.variant < 2 {
            return Err(
                JsError::new("applyForcesToPolyLines requires MultiHead2 or MultiHead3").into(),
            );
        }
        let result = solver.apply_forces_to_poly_lines(&mut lines);
        // Preserve untouched fields and property insertion order in the mutable argument.
        for (line_index, line) in lines.iter().enumerate() {
            for (point_index, point) in line.m_points.iter().enumerate() {
                value[line_index]["mPoints"][point_index]["x"] = json!(point.x);
                value[line_index]["mPoints"][point_index]["y"] = json!(point.y);
            }
        }
        SpecializedApplyForcesResult::output(
            SpecializedForceResult(
                json!({"lastStepMoved":result.last_step_moved,"magForceApplied":result.mag_force_applied}),
            ),
            vec![value],
            None,
        )
    }

    #[wasm_bindgen(js_name = createInitialCandidateFromSeed)]
    pub fn create_initial_candidate_from_seed(
        &mut self,
        seed: f64,
    ) -> Result<Ts<SpecializedSeedResult>, JsValue> {
        if !seed.is_finite() {
            return Err(JsError::new("Missing shuffle seed").into());
        }
        let candidate = multi_head(&mut self.engine.borrow_mut())?
            .create_initial_candidate_from_seed(seed)
            .map_err(|error| JsError::new(&error))?;
        let identity = candidate.as_ref().map(types1::candidate_identity);
        SpecializedSeedResult::output(
            SpecializedOptionalCandidate(json!(candidate)),
            vec![json!(seed)],
            identity,
        )
    }

    #[wasm_bindgen(js_name = handleRoutesDontCross)]
    pub fn handle_routes_dont_cross(&mut self) -> Result<Ts<SpecializedVoidResult>, JsValue> {
        let mut engine = self.engine.borrow_mut();
        let SpecializedEngine::TwoCrossing(solver) = &mut *engine else {
            return Err(JsError::new("handleRoutesDontCross requires a TwoCrossing solver").into());
        };
        solver.handle_routes_dont_cross();
        SpecializedVoidResult::output((), vec![], None)
    }

    #[wasm_bindgen(js_name = padByNewHeadWallBuffer)]
    pub fn pad_by_new_head_wall_buffer(
        &mut self,
        point: Ts<SpecializedPoint>,
    ) -> Result<Ts<SpecializedPointResult>, JsValue> {
        let point = input(point)?;
        let engine = self.engine.borrow();
        let SpecializedEngine::ViaPossibilities2(solver) = &*engine else {
            return Err(
                JsError::new("padByNewHeadWallBuffer requires ViaPossibilitiesSolver2").into(),
            );
        };
        SpecializedPointResult::output(
            SpecializedPoint(solver.pad_by_new_head_wall_buffer(&point)),
            vec![point],
            None,
        )
    }

    #[wasm_bindgen(js_name = padByPlaceholderWallBuffer)]
    pub fn pad_by_placeholder_wall_buffer(
        &mut self,
        point: Ts<SpecializedPoint>,
    ) -> Result<Ts<SpecializedPointResult>, JsValue> {
        let point = input(point)?;
        let engine = self.engine.borrow();
        let SpecializedEngine::ViaPossibilities2(solver) = &*engine else {
            return Err(JsError::new(
                "padByPlaceholderWallBuffer requires ViaPossibilitiesSolver2",
            )
            .into());
        };
        SpecializedPointResult::output(
            SpecializedPoint(solver.pad_by_placeholder_wall_buffer(&point)),
            vec![point],
            None,
        )
    }
}
