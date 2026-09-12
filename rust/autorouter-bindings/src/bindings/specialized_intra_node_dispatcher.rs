use std::{cell::RefCell, rc::Rc};
use intra_node_routing::specialized_solver::SpecializedEngine;
use intra_node_routing::specialized_utils::math::SpecializedMath;
use serde_json::Value;
use wasm_bindgen::prelude::*;

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
    connectivity: Option<Rc<intra_node_routing::connectivity_map::ConnectivityMap>>,
    obstacles: Rc<Vec<Value>>,
}

#[wasm_bindgen]
impl SpecializedRouterContext {
    #[wasm_bindgen(constructor)]
    pub fn new(props_json: &str) -> Result<Self, JsValue> {
        let mut props: Value = serde_json::from_str(props_json)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let object = props.as_object_mut().ok_or_else(|| JsValue::from_str("Specialized context requires an object"))?;
        let connectivity_json = object.remove("connMap").filter(|value| !value.is_null()).map(Rc::new);
        let connectivity = connectivity_json.as_ref().map(|value| {
            serde_json::from_value(value.as_ref().clone()).map(Rc::new)
        }).transpose().map_err(|error| JsValue::from_str(&error.to_string()))?;
        let layer_count = object.get("layerCount").and_then(Value::as_f64).unwrap_or(2.0);
        let obstacles = match object.remove("obstacles") {
            Some(Value::Array(obstacles)) => obstacles,
            None | Some(Value::Null) => Vec::new(),
            Some(_) => return Err(JsValue::from_str("Specialized context obstacles must be an array")),
        };
        let obstacles = intra_node_routing::specialized_utils::create_objects_with_z_layers::create_objects_with_z_layers_owned(obstacles, layer_count);
        Ok(Self { connectivity_json, connectivity, obstacles: Rc::new(obstacles) })
    }

    pub fn create(&self, kind: &str, params_json: &str) -> Result<SpecializedIntraNodeDispatcher, JsValue> {
        let params: Value = serde_json::from_str(params_json)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let engine = if kind == "through-obstacle" {
            let solver = intra_node_routing::single_transition_through_obstacle_intra_node_solver::SingleTransitionThroughObstacleIntraNodeSolver::new_with_context(
                params, host_math(), self.obstacles.clone(), self.connectivity.clone(),
            ).map_err(|error| JsValue::from_str(&error))?;
            SpecializedEngine::ThroughObstacle(Box::new(solver))
        } else {
            let mut engine = SpecializedEngine::new(kind, params, host_math())
                .map_err(|error| JsValue::from_str(&error))?;
            match &mut engine {
                SpecializedEngine::MultiHead(solver) => solver.conn_map = self.connectivity_json.clone(),
                SpecializedEngine::MultiHead2(solver) => solver.conn_map = self.connectivity_json.clone(),
                SpecializedEngine::MultiHead3(solver) => solver.conn_map = self.connectivity_json.clone(),
                _ => return Err(JsValue::from_str("Shared specialized context requires a MultiHead or through-obstacle solver")),
            }
            engine
        };
        Ok(SpecializedIntraNodeDispatcher { engine: Rc::new(RefCell::new(engine)) })
    }
}

#[wasm_bindgen]
impl SpecializedIntraNodeDispatcher {
    #[wasm_bindgen(constructor)]
    pub fn new(kind: &str, params_json: &str) -> Result<Self, JsValue> {
        let params: Value = serde_json::from_str(params_json)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let engine = SpecializedEngine::new(kind, params, host_math())
            .map_err(|error| JsValue::from_str(&error))?;
        Ok(Self { engine: Rc::new(RefCell::new(engine)) })
    }

    #[wasm_bindgen(js_name = snapshotJson)]
    pub fn snapshot_json(&self) -> Result<String, JsValue> {
        let snapshot = self.engine.borrow().snapshot().map_err(|error| JsValue::from_str(&error))?;
        serde_json::to_string(&snapshot).map_err(|error| JsValue::from_str(&error.to_string()))
    }

    #[wasm_bindgen(js_name = stateJson)]
    pub fn state_json(&self) -> Result<String, JsValue> {
        serde_json::to_string(self.engine.borrow().state())
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    #[wasm_bindgen(js_name = restoreStateJson)]
    pub fn restore_state_json(&mut self, state_json: &str) -> Result<(), JsValue> {
        let mut value: Value = serde_json::from_str(state_json)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let non_finite_progress = value["progress"].is_null();
        if non_finite_progress { value["progress"] = Value::from(0.0); }
        let mut state: intra_node_routing::specialized_base_solver::BaseSolverState = serde_json::from_value(value)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        if non_finite_progress { state.progress = f64::NAN; }
        *self.engine.borrow_mut().solver_mut().base_mut() = state;
        Ok(())
    }

    #[wasm_bindgen(js_name = invokeJson)]
    pub fn invoke_json(&mut self, method: &str, args_json: &str) -> Result<String, JsValue> {
        let args: Vec<Value> = serde_json::from_str(args_json)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let (result, args) = self.engine.borrow_mut().invoke(method, args)
            .map_err(|error| JsValue::from_str(&error))?;
        serde_json::to_string(&serde_json::json!({ "result": result, "args": args }))
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    #[wasm_bindgen(js_name = isApplicable)]
    pub fn is_applicable(kind: &str, params_json: &str) -> Result<bool, JsValue> {
        let params: Value = serde_json::from_str(params_json)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        intra_node_routing::specialized_simple_dispatch::is_applicable(kind, params)
            .map_err(|error| JsValue::from_str(&error))
    }

    #[wasm_bindgen(js_name = restoreJson)]
    pub fn restore_json(&mut self, snapshot_json: &str) -> Result<(), JsValue> {
        let snapshot: Value = serde_json::from_str(snapshot_json)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        self.engine.borrow_mut().restore(snapshot, host_math()).map_err(|error| JsValue::from_str(&error))
    }

    #[wasm_bindgen(js_name = visualizeJson)]
    pub fn visualize_json(&self, transparentize: &js_sys::Function) -> Result<String, JsValue> {
        let callback_error = RefCell::new(None);
        let output = self.engine.borrow().visualize(&|color, amount| {
            match transparentize.call2(&JsValue::UNDEFINED, &JsValue::from_str(color), &JsValue::from_f64(amount)) {
                Ok(value) => match value.as_string() {
                    Some(color) => color,
                    None => {
                        *callback_error.borrow_mut() = Some(JsValue::from_str("Visualization color callback must return a string"));
                        String::new()
                    }
                },
                Err(error) => {
                    *callback_error.borrow_mut() = Some(error);
                    String::new()
                }
            }
        });
        if let Some(error) = callback_error.into_inner() { return Err(error); }
        serde_json::to_string(&output).map_err(|error| JsValue::from_str(&error.to_string()))
    }

    #[wasm_bindgen(js_name = solvedRoutesJson)]
    pub fn solved_routes_json(&self) -> Result<String, JsValue> {
        let engine = self.engine.borrow();
        let routes = engine.solved_routes().map_err(|error| JsValue::from_str(&error))?;
        serde_json::to_string(routes).map_err(|error| JsValue::from_str(&error.to_string()))
    }

    pub fn step(&mut self) -> Result<(), JsValue> {
        self.engine.borrow_mut().solver_mut().step().map_err(|error| JsValue::from_str(&error))
    }

    pub fn solve(&mut self) -> Result<(), JsValue> {
        self.engine.borrow_mut().solver_mut().solve().map_err(|error| JsValue::from_str(&error))
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
        self.engine.borrow_mut().solver_mut().try_final_acceptance().map_err(|error| JsValue::from_str(&error))
    }

    #[wasm_bindgen(js_name = computeProgress)]
    pub fn compute_progress(&self) -> f64 {
        let engine = self.engine.borrow();
        engine.solver().compute_progress().unwrap_or(engine.state().progress)
    }

    #[wasm_bindgen(js_name = shareForPortfolio)]
    pub fn share_for_portfolio(&self) -> u32 {
        crate::bindings::portfolio_single_intra_node_solver::share_specialized(self.engine.clone())
    }
}

#[wasm_bindgen]
impl SpecializedIntraNodeDispatcher {
    #[wasm_bindgen(js_name = snapshotIdentityJson)]
    pub fn snapshot_identity_json(&self) -> Result<String, JsValue> {
        let identity = intra_node_routing::multi_head_poly_line_intra_node_solver::types1::snapshot_identity(&mut self.engine.borrow_mut());
        serde_json::to_string(&identity).map_err(|error|JsValue::from_str(&error.to_string()))
    }

    #[wasm_bindgen(js_name = restoreIdentityJson)]
    pub fn restore_identity_json(&mut self, snapshot_json: &str, identity_json: &str) -> Result<(), JsValue> {
        let identity: Value = serde_json::from_str(identity_json).map_err(|error|JsValue::from_str(&error.to_string()))?;
        self.restore_json(snapshot_json)?;
        intra_node_routing::multi_head_poly_line_intra_node_solver::types1::restore_snapshot_identity(&mut self.engine.borrow_mut(), &identity)
            .map_err(|error|JsValue::from_str(&error))
    }

    #[wasm_bindgen(js_name = invokeIdentityJson)]
    pub fn invoke_identity_json(&mut self, method: &str, args_json: &str, identity_json: &str) -> Result<String, JsValue> {
        let args: Vec<Value> = serde_json::from_str(args_json).map_err(|error|JsValue::from_str(&error.to_string()))?;
        let identity: Value = serde_json::from_str(identity_json).map_err(|error|JsValue::from_str(&error.to_string()))?;
        let (result,args,identity) = intra_node_routing::multi_head_poly_line_intra_node_solver::types1::invoke_with_identity(&mut self.engine.borrow_mut(),method,args,identity)
            .map_err(|error|JsValue::from_str(&error))?;
        serde_json::to_string(&serde_json::json!({"result":result,"args":args,"identity":identity}))
            .map_err(|error|JsValue::from_str(&error.to_string()))
    }
}
