use high_density_repair03::drc::standalone_drc_evaluator::StandaloneDrcEvaluator;
use high_density_repair03::solvers::global_drc_force_improve_solver::global_drc_force_improve_solver as force_improve_solver;
use high_density_repair03::solvers::global_drc_force_improve_solver::internal_types::MutableRoute;
use high_density_repair03::solvers::global_drc_force_improve_solver::types::DrcEvaluator;
use high_density_repair03::solvers::global_drc_force_improve_solver::types::DrcSnapshot;
use high_density_repair03::solvers::global_drc_force_improve_solver::types::Evaluator;
use high_density_repair03::solvers::global_drc_force_improve_solver::types::Routes;
use serde_json::{Value, json};
use std::{cell::RefCell, collections::HashMap, rc::Rc};
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;

#[derive(serde::Serialize, serde::Deserialize, Tsify)]
#[serde(transparent)]
pub struct GlobalDrcRoutePacket(
    #[tsify(
        type = "{ id: number; routes: { id: number; pointArrayId: number; viaArrayId: number; sourceId: number; value: import('high-density-repair03/lib').HighDensityRoute; pointIds: number[]; pointSourceIds: number[] }[] }"
    )]
    Value,
);

#[derive(serde::Serialize, serde::Deserialize, Tsify)]
#[serde(transparent)]
#[expect(
    dead_code,
    reason = "Tsify emits this type for TypeScript mutation packets."
)]
pub struct GlobalDrcMutationPacket(
    #[tsify(
        type = "{ id: number; routes: { id: number; pointArrayId: number; viaArrayId: number; value: import('high-density-repair03/lib').HighDensityRoute; pointIds: number[] }[] }"
    )]
    Value,
);

#[derive(serde::Serialize, serde::Deserialize, Tsify)]
#[serde(transparent)]
pub struct GlobalDrcSolverState(
    #[tsify(
        type = "Record<string, unknown> & { iterations: number; MAX_ITERATIONS: number; solved: boolean; failed: boolean; error: string | null; progress: number; stats: Record<string, unknown>; outputIsInput?: boolean; drcStats?: import('high-density-repair03/lib/drc/AutoroutingDrcEngine').AutoroutingDrcEngine['lastRunStats'] }"
    )]
    Value,
);

#[derive(serde::Serialize, serde::Deserialize, Tsify)]
#[serde(transparent)]
pub struct GlobalDrcCallbackInput(
    #[tsify(
        type = "{ routes: GlobalDrcRoutePacket; output: GlobalDrcRoutePacket | null; state: GlobalDrcSolverState; reference: boolean; topology: boolean; legacy: boolean }"
    )]
    Value,
);

#[derive(serde::Serialize, serde::Deserialize, Tsify)]
#[serde(transparent)]
pub struct GlobalDrcCallbackOutput(
    #[tsify(
        type = "{ snapshot?: { errors: Record<string, unknown>[]; count: number; issueScore: number; legacyIssueScore: number; traceRouteIndexById: Record<string, number> }; thrown?: boolean; state: GlobalDrcSolverState; mutations: GlobalDrcMutationPacket[] }"
    )]
    Value,
);

#[derive(serde::Deserialize, Tsify)]
#[serde(transparent)]
pub struct GlobalDrcSolverParams(
    #[tsify(
        type = "Omit<import('high-density-repair03/lib').GlobalDrcForceImproveSolverParams, 'drcEvaluator' | 'referenceDrcEvaluator' | 'autoroutingDrcEngine' | 'connMap'> & { connMap: { idToNetMap: Record<string, string> } | null; hasCustomDrcEvaluator: boolean; useHostEvaluator: boolean; hasReferenceEvaluator: boolean; initialReferenceSnapshot?: unknown }"
    )]
    Value,
);

#[derive(serde::Deserialize, Tsify)]
#[serde(transparent)]
pub struct GlobalDrcRoutes(
    #[tsify(type = "import('high-density-repair03/lib').HighDensityRoute[]")] Vec<Value>,
);

struct RouteRegistry {
    arrays: Vec<Routes>,
    array_clients: HashMap<i64,usize>,
    identities: HashMap<(u8,i64),u64>,
    identity_clients: HashMap<(u8,u64),i64>,
    points: HashMap<i64,Rc<RefCell<high_density_repair03::solvers::global_drc_force_improve_solver::internal_types::RoutePoint>>>,
    point_clients: HashMap<usize,i64>,
    route_sources: HashMap<usize,i64>,
    point_sources: HashMap<u64,i64>,
}

impl RouteRegistry {
    fn new(input: Routes) -> Self {
        Self {
            arrays: vec![input],
            array_clients: HashMap::new(),
            identities: HashMap::new(),
            identity_clients: HashMap::new(),
            points: HashMap::new(),
            point_clients: HashMap::new(),
            route_sources: HashMap::new(),
            point_sources: HashMap::new(),
        }
    }

    fn native_identity(&mut self, kind: u8, id: i64) -> u64 {
        if id >= 0 {
            return id as u64;
        }
        let value=*self.identities.entry((kind,id)).or_insert_with(high_density_repair03::solvers::global_drc_force_improve_solver::internal_types::next_identity);
        self.identity_clients.insert((kind, value), id);
        value
    }

    fn client_identity(&self, kind: u8, id: u64) -> i64 {
        self.identity_clients
            .get(&(kind, id))
            .copied()
            .unwrap_or(id as i64)
    }

    fn array(&self, id: i64) -> Result<Routes, String> {
        let index = if id >= 0 {
            id as usize
        } else {
            *self
                .array_clients
                .get(&id)
                .ok_or("Unknown route array identity")?
        };
        self.arrays
            .get(index)
            .cloned()
            .ok_or_else(|| "Unknown route array identity".to_owned())
    }

    fn packet(&mut self, routes: &Routes) -> Value {
        let index = if let Some(index) = self
            .arrays
            .iter()
            .position(|item| Routes::ptr_eq(item, routes))
        {
            index
        } else {
            self.arrays.push(routes.clone());
            self.arrays.len() - 1
        };
        let id = self
            .array_clients
            .iter()
            .find_map(|(&client, &value)| (value == index).then_some(client))
            .unwrap_or(index as i64);
        let mut entries = Vec::new();
        for route in routes.iter() {
            let route_id = self.client_identity(0, route.identity);
            let source_id = *self
                .route_sources
                .entry(Rc::as_ptr(&route.metadata) as usize)
                .or_insert(route_id);
            let mut point_ids = Vec::new();
            let mut point_sources = Vec::new();
            for point in &route.route {
                let key = Rc::as_ptr(point) as usize;
                let point_id = *self.point_clients.entry(key).or_insert(key as i64);
                self.points.entry(point_id).or_insert_with(|| point.clone());
                let source = *self
                    .point_sources
                    .entry(point.borrow().metadata_identity)
                    .or_insert(point_id);
                point_ids.push(point_id);
                point_sources.push(source);
            }
            entries.push(json!({"id":route_id,"pointArrayId":self.client_identity(1,route.point_array_identity),"viaArrayId":self.client_identity(2,route.via_array_identity),
                "sourceId":source_id,"value":route.to_value(),"pointIds":point_ids,"pointSourceIds":point_sources}));
        }
        json!({"id":id,"routes":entries})
    }

    fn apply_mutations(&mut self, mutations: &Value) -> Result<(), String> {
        let Some(mutations) = mutations.as_array() else {
            return Ok(());
        };
        if mutations.is_empty() {
            return Ok(());
        }
        let mut updates = HashMap::new();
        let mut point_arrays = HashMap::new();
        let mut via_arrays = HashMap::new();
        let mut layouts = Vec::new();
        for packet in mutations {
            let array_id = packet["id"].as_i64().ok_or("Mutation array identity")?;
            let mut layout = Vec::new();
            for entry in packet["routes"]
                .as_array()
                .ok_or("Mutation route entries")?
            {
                let client = entry["id"].as_i64().ok_or("Mutation route identity")?;
                let identity = self.native_identity(0, client);
                let point_array_identity = self.native_identity(
                    1,
                    entry["pointArrayId"]
                        .as_i64()
                        .ok_or("Point array identity")?,
                );
                let via_array_identity = self
                    .native_identity(2, entry["viaArrayId"].as_i64().ok_or("Via array identity")?);
                let mut route = MutableRoute::from_owned_value(entry["value"].clone());
                route.identity = identity;
                route.point_array_identity = point_array_identity;
                route.via_array_identity = via_array_identity;
                let point_ids = entry["pointIds"]
                    .as_array()
                    .ok_or("Mutation point identities")?;
                if point_ids.len() != route.route.len() {
                    return Err("Mutation point count differs".to_owned());
                }
                for (point, id) in route.route.iter_mut().zip(point_ids) {
                    let client = id.as_i64().ok_or("Mutation point identity")?;
                    if let Some(existing) = self.points.get(&client) {
                        if existing.borrow().to_value() != point.borrow().to_value() {
                            *existing.borrow_mut() = point.borrow().clone();
                            self.point_sources
                                .insert(existing.borrow().metadata_identity, client);
                        }
                        *point = existing.clone();
                    } else {
                        self.points.insert(client, point.clone());
                        self.point_clients
                            .insert(Rc::as_ptr(point) as usize, client);
                        self.point_sources
                            .insert(point.borrow().metadata_identity, client);
                    }
                }
                self.route_sources
                    .insert(Rc::as_ptr(&route.metadata) as usize, client);
                point_arrays.insert(point_array_identity, route.route.clone());
                via_arrays.insert(via_array_identity, route.vias.clone());
                updates.insert(identity, route);
                layout.push(identity);
            }
            if array_id < 0 && !self.array_clients.contains_key(&array_id) {
                self.array_clients.insert(array_id, self.arrays.len());
                self.arrays.push(Routes::new(Vec::new()));
            }
            layouts.push((array_id, layout));
        }
        // Shared route objects and point/via arrays can occur in several candidate
        // arrays. Apply their updates everywhere before replacing array layouts.
        for array in &self.arrays {
            let mut changed = false;
            let routes = array
                .iter()
                .map(|route| {
                    if let Some(update) = updates.get(&route.identity) {
                        changed = true;
                        return update.shallow_clone();
                    }
                    let mut route = route.shallow_clone();
                    if let Some(points) = point_arrays.get(&route.point_array_identity) {
                        route.route = points.clone();
                        changed = true;
                    }
                    if let Some(vias) = via_arrays.get(&route.via_array_identity) {
                        route.vias = vias.clone();
                        changed = true;
                    }
                    route
                })
                .collect();
            if changed {
                array.replace(routes);
            }
        }
        for (id, layout) in layouts {
            self.array(id)?.replace(
                layout
                    .iter()
                    .map(|id| {
                        updates
                            .get(id)
                            .expect("Mutated route identity")
                            .shallow_clone()
                    })
                    .collect(),
            );
        }
        Ok(())
    }
}

struct CallbackEvaluator {
    callback: js_sys::Function,
    reference: bool,
    registry: Rc<RefCell<RouteRegistry>>,
    state: Rc<RefCell<Value>>,
    output: Rc<RefCell<Option<Routes>>>,
    patch: Rc<RefCell<Option<Value>>>,
    pending_error: Rc<RefCell<Option<JsValue>>>,
}

impl DrcEvaluator for CallbackEvaluator {
    fn snapshot(
        &mut self,
        routes: &Routes,
        topology: bool,
        legacy: bool,
    ) -> Result<DrcSnapshot, String> {
        let packet = self.registry.borrow_mut().packet(routes);
        let output = self
            .output
            .borrow()
            .as_ref()
            .map(|routes| self.registry.borrow_mut().packet(routes));
        let input = json!({"routes":packet,"output":output,"state":*self.state.borrow(),"reference":self.reference,"topology":topology,"legacy":legacy});
        let input = GlobalDrcCallbackInput(input)
            .into_ts()
            .map_err(|error| error.to_string())?;
        let output = self
            .callback
            .call1(&JsValue::UNDEFINED, &input.js_value())
            .map_err(|error| {
                *self.pending_error.borrow_mut() = Some(error);
                "Global DRC callback failed".to_owned()
            })?;
        let output = Ts::<GlobalDrcCallbackOutput>::new_unchecked(output)
            .to_rust()
            .map_err(|error| error.to_string())?
            .0;
        self.registry
            .borrow_mut()
            .apply_mutations(&output["mutations"])?;
        *self.patch.borrow_mut() = output.get("state").cloned();
        if let Some(id) = output["state"]["outputId"].as_i64() {
            *self.output.borrow_mut() = Some(self.registry.borrow().array(id)?);
        }
        if output["thrown"].as_bool() == Some(true) {
            return Err("Global DRC callback failed".to_owned());
        }
        serde_json::from_value(output["snapshot"].clone()).map_err(|error| error.to_string())
    }
}

#[wasm_bindgen]
pub struct GlobalDrcForceImproveSolver {
    solver: force_improve_solver::GlobalDrcForceImproveSolver,
    registry: Rc<RefCell<RouteRegistry>>,
    default_evaluator: Option<Rc<RefCell<StandaloneDrcEvaluator>>>,
    pending_error: Rc<RefCell<Option<JsValue>>>,
}

#[wasm_bindgen]
impl GlobalDrcForceImproveSolver {
    #[wasm_bindgen(constructor)]
    pub fn new(
        params: Ts<GlobalDrcSolverParams>,
        #[wasm_bindgen(
            unchecked_param_type = "(input: GlobalDrcCallbackInput) => GlobalDrcCallbackOutput"
        )]
        callback: js_sys::Function,
    ) -> Result<Self, JsValue> {
        let mut params = params.to_rust().map_err(js_error)?.0;
        let route_values = params["hdRoutes"].take();
        let Value::Array(route_values) = route_values else {
            return Err(JsValue::from_str("Global repair routes required"));
        };
        let routes = Routes::new(
            route_values
                .into_iter()
                .map(MutableRoute::from_owned_value)
                .collect(),
        );
        let registry = Rc::new(RefCell::new(RouteRegistry::new(routes.clone())));
        let state = Rc::new(RefCell::new(Value::Null));
        let output = Rc::new(RefCell::new(None));
        let patch = Rc::new(RefCell::new(None));
        let pending_error = Rc::new(RefCell::new(None));
        let conn = params
            .get("connMap")
            .filter(|value| !value.is_null())
            .cloned();
        let engine=Rc::new(high_density_repair03::solvers::global_drc_force_improve_solver::solver_helpers::BroadRepulsionEngine::new(params["srj"].clone(),conn.clone(),crate::repair_math()));
        let mut default_evaluator = None;
        let make_callback = |reference| -> Evaluator {
            Rc::new(RefCell::new(CallbackEvaluator {
                callback: callback.clone(),
                reference,
                registry: registry.clone(),
                state: state.clone(),
                output: output.clone(),
                patch: patch.clone(),
                pending_error: pending_error.clone(),
            }))
        };
        let evaluator: Evaluator = if params["useHostEvaluator"].as_bool() == Some(true) {
            make_callback(false)
        } else {
            let native = Rc::new(RefCell::new(
                StandaloneDrcEvaluator::new(
                    params["srj"].clone(),
                    conn,
                    params["enableTraceViaOwnerTargeting"]
                        .as_bool()
                        .unwrap_or(false),
                    high_density_repair03::drc::autorouting_drc_engine::DrcMath {
                        hypot: js_sys::Math::hypot,
                        sin: js_sys::Math::sin,
                        cos: js_sys::Math::cos,
                    },
                )
                .map_err(js_error)?,
            ));
            default_evaluator = Some(native.clone());
            native
        };
        let reference = if params["hasReferenceEvaluator"].as_bool() == Some(true) {
            Some(make_callback(true))
        } else {
            None
        };
        let mut solver = force_improve_solver::GlobalDrcForceImproveSolver::new(
            params, routes, engine, evaluator, reference,
        )
        .map_err(|error| {
            pending_error
                .borrow_mut()
                .take()
                .unwrap_or_else(|| js_error(error))
        })?;
        if default_evaluator.is_none()
            || solver.params["hasReferenceEvaluator"].as_bool() == Some(true)
        {
            solver.callback_state = Some(state);
            solver.callback_output = Some(output);
            solver.callback_patch = Some(patch);
        }
        registry
            .borrow_mut()
            .arrays
            .push(solver.guarded_input_hd_routes.clone());
        Ok(Self {
            solver,
            registry,
            default_evaluator,
            pending_error,
        })
    }

    #[wasm_bindgen(js_name=stepInner)]
    pub fn step_inner(
        &mut self,
        state: Ts<GlobalDrcSolverState>,
        final_acceptance: bool,
    ) -> Result<Ts<GlobalDrcSolverState>, JsValue> {
        let state = state.to_rust().map_err(js_error)?.0;
        self.registry
            .borrow_mut()
            .apply_mutations(&state["mutations"])
            .map_err(js_error)?;
        self.solver.restore_public_state(&state);
        if let Some(conn) = state.get("connectivity") {
            let conn = if conn.is_null() {
                None
            } else {
                Some(conn.clone())
            };
            self.solver.engine = Rc::new(high_density_repair03::solvers::global_drc_force_improve_solver::solver_helpers::BroadRepulsionEngine::new(self.solver.params["srj"].clone(),conn.clone(),crate::repair_math()));
            if let Some(evaluator) = &self.default_evaluator {
                evaluator.borrow_mut().engine.conn_map = conn
                    .map(serde_json::from_value)
                    .transpose()
                    .map_err(js_error)?;
            }
        }
        if let Some(id) = state["outputId"].as_i64() {
            self.solver.output_hd_routes = self.registry.borrow().array(id).map_err(js_error)?;
        }
        let result = if final_acceptance {
            self.solver.try_final_acceptance()
        } else {
            self.solver.step_inner()
        };
        result.map_err(|error| {
            self.pending_error
                .borrow_mut()
                .take()
                .unwrap_or_else(|| js_error(error))
        })?;
        self.state()
    }

    #[wasm_bindgen(js_name=state)]
    pub fn state(&self) -> Result<Ts<GlobalDrcSolverState>, JsValue> {
        let mut state = self.solver.debug_state();
        state["outputIsInput"] = json!(Routes::ptr_eq(
            &self.solver.output_hd_routes,
            &self.solver.input_hd_routes
        ));
        if let Some(evaluator) = &self.default_evaluator {
            state["drcStats"] = serde_json::to_value(&evaluator.borrow().engine.last_run_stats)
                .map_err(js_error)?;
        }
        GlobalDrcSolverState(state).into_ts().map_err(js_error)
    }

    #[wasm_bindgen(js_name=routes)]
    pub fn routes(&self, which: &str) -> Result<Ts<GlobalDrcRoutePacket>, JsValue> {
        let routes = match which {
            "input" => &self.solver.input_hd_routes,
            "guarded" => &self.solver.guarded_input_hd_routes,
            "output" => &self.solver.output_hd_routes,
            _ => return Err(js_error("Unknown route field")),
        };
        GlobalDrcRoutePacket(self.registry.borrow_mut().packet(routes))
            .into_ts()
            .map_err(js_error)
    }

    #[wasm_bindgen(js_name=importRoutes)]
    pub fn import_routes(&self, routes: Ts<GlobalDrcRoutes>) -> Result<usize, JsValue> {
        let values = routes.to_rust().map_err(js_error)?.0;
        let routes = Routes::new(
            values
                .into_iter()
                .map(MutableRoute::from_owned_value)
                .collect(),
        );
        let mut registry = self.registry.borrow_mut();
        let id = registry.arrays.len();
        registry.arrays.push(routes);
        Ok(id)
    }
}

fn js_error(error: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}
