use std::rc::Rc;
use indexmap::IndexMap;
use serde::Serialize;
use serde_json::{json, Value};
use crate::bindings::high_density::specialized_base_solver::BaseSolverState;
use crate::utils::js_number::js_number_to_string;
use crate::solvers::hyper_high_density_solver::grow_shrink_high_density_intra_node_solver::grow_shrink_high_density_intra_node_solver::DEFAULT_MAX_GROWTH_ATTEMPTS;
use crate::utils::merge_route_segments::merge_route_segments;

pub trait HighDensityNodeSolver {
    fn id(&self) -> u32;
    fn state(&self) -> BaseSolverState;
    fn step(&mut self, observe_parent: Option<&mut dyn FnMut(bool) -> Result<(), String>>) -> Result<(), String>;
    fn solved_routes(&self) -> Result<Vec<Value>, String>;
    fn route_count(&self) -> Result<usize, String> {
        let routes = self.solved_routes()?;
        Ok(routes.len())
    }
    fn node_with_port_points(&self) -> &Value;
    fn solver_type_name(&self) -> String;
    fn growth_attempts(&self) -> Option<f64>;
    fn visualize(&self, transparentize: &dyn Fn(&str, f64) -> String) -> Result<Value, String>;
}

pub type NodeFactory<'a> = dyn FnMut(Value, &HighDensitySolver) -> Result<Box<dyn HighDensityNodeSolver>, String> + 'a;
pub type CacheStats<'a> = dyn FnMut() -> (f64, f64) + 'a;

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct HighDensitySolver {
    #[serde(flatten)] pub base: BaseSolverState,
    pub unsolved_node_port_points: Vec<Value>,
    pub routes: Vec<Value>,
    pub color_map: Rc<Value>,
    pub default_via_diameter: f64,
    pub default_trace_thickness: f64,
    pub via_diameter: f64,
    pub trace_width: f64,
    pub obstacle_margin: f64,
    pub effort: f64,
    pub obstacles: Rc<Value>,
    pub layer_count: f64,
    pub use_grow_shrink_high_density_intra_node_solver: bool,
    pub preserve_terminal_pcb_port_ids: bool,
    #[serde(skip_serializing_if="Option::is_none")]
    pub grow_shrink_max_inner_iterations_per_growth_attempt: Option<f64>,
    pub grow_shrink_fallback_to_invalid_geometry_on_failure: bool,
    pub capture_search_debug: bool,
    #[serde(skip)] pub failed_solvers: Vec<Box<dyn HighDensityNodeSolver>>,
    #[serde(skip)] pub active_sub_solver: Option<Box<dyn HighDensityNodeSolver>>,
    #[serde(skip_serializing_if="Option::is_none")] pub conn_map: Option<Rc<Value>>,
    pub node_pf_by_id: IndexMap<String, Value>,
    pub node_solve_metadata_by_id: IndexMap<String, Value>,
    pub stats: Value,
    #[serde(skip)] pub observe_parent: Option<Box<dyn Fn(Option<Value>) -> Result<(), String>>>,
}

impl HighDensitySolver {
    pub fn new(mut params: Value) -> Result<Self, String> {
        let effort = params["effort"].as_f64().unwrap_or(1.0);
        let grow = params["useGrowShrinkHighDensityIntraNodeSolver"].as_bool().unwrap_or(false);
        let nodes = params.get_mut("nodePortPoints").ok_or("nodePortPoints required")?.take();
        let unsolved_node_port_points = serde_json::from_value(nodes).map_err(|error| error.to_string())?;
        let node_pf_by_id = serde_json::from_value(params.get("nodePfById").filter(|v| !v.is_null()).cloned().unwrap_or(json!({}))).map_err(|error| error.to_string())?;
        Ok(Self {
            base: BaseSolverState { max_iterations: 10e6 * effort * if grow { DEFAULT_MAX_GROWTH_ATTEMPTS + 1.0 } else { 1.0 }, ..Default::default() },
            unsolved_node_port_points, routes: Vec::new(),
            color_map: Rc::new(params.get_mut("colorMap").filter(|v| !v.is_null()).map(Value::take).unwrap_or(json!({}))),
            default_via_diameter: 0.3, default_trace_thickness: 0.15,
            via_diameter: params["viaDiameter"].as_f64().unwrap_or(0.3),
            trace_width: params["traceWidth"].as_f64().unwrap_or(0.15),
            obstacle_margin: params["obstacleMargin"].as_f64().unwrap_or(0.15), effort,
            obstacles: Rc::new(params.get_mut("obstacles").filter(|v| !v.is_null()).map(Value::take).unwrap_or(json!([]))),
            layer_count: params["layerCount"].as_f64().unwrap_or(2.0),
            use_grow_shrink_high_density_intra_node_solver: grow,
            preserve_terminal_pcb_port_ids: params["preserveTerminalPcbPortIds"].as_bool().unwrap_or(false),
            grow_shrink_max_inner_iterations_per_growth_attempt: params["growShrinkMaxInnerIterationsPerGrowthAttempt"].as_f64(),
            grow_shrink_fallback_to_invalid_geometry_on_failure: params["growShrinkFallbackToInvalidGeometryOnFailure"].as_bool().unwrap_or(false),
            capture_search_debug: params["captureSearchDebug"].as_bool().unwrap_or(true),
            failed_solvers: Vec::new(), active_sub_solver: None,
            conn_map: params.get_mut("connMap").filter(|v| !v.is_null()).map(|v| Rc::new(v.take())),
            node_pf_by_id, node_solve_metadata_by_id: IndexMap::new(),
            stats: json!({"solverNodeCount":{},"difficultNodePfs":{},"highDensityResizeCount":0}), observe_parent: None,
        })
    }

    pub fn record_node_solve_metadata(&mut self, solver: &dyn HighDensityNodeSolver, status: &str) -> Result<(), String> {
        let node = solver.node_with_port_points();
        let id = node["capacityMeshNodeId"].as_str().ok_or("Node ID required")?;
        let state = solver.state();
        let mut metadata = json!({"node":node,"status":status,"solverType":solver.solver_type_name(),
            "iterations":state.iterations,"routeCount":solver.route_count()?,"nodePf":self.node_pf_by_id.get(id).unwrap_or(&Value::Null)});
        if let Some(error) = state.error { metadata["error"] = json!(error); }
        self.node_solve_metadata_by_id.insert(id.to_owned(), metadata);
        Ok(())
    }

    pub fn record_solved_node_stats(&mut self, solver: &dyn HighDensityNodeSolver) {
        let name = solver.solver_type_name();
        let count = self.stats["solverNodeCount"][&name].as_f64().unwrap_or(0.0);
        self.stats["solverNodeCount"][&name] = json!(count + 1.0);
        let id = solver.node_with_port_points()["capacityMeshNodeId"].as_str().expect("Node ID");
        if let Some(pf) = self.node_pf_by_id.get(id).and_then(Value::as_f64).filter(|pf| *pf > 0.05) {
            if self.stats["difficultNodePfs"].get(&name).is_none() { self.stats["difficultNodePfs"][&name] = json!([]); }
            self.stats["difficultNodePfs"][&name].as_array_mut().unwrap().push(json!(pf));
        }
    }

    pub fn record_resize_stats(&mut self, solver: &dyn HighDensityNodeSolver) {
        if let Some(attempts) = solver.growth_attempts() {
            self.stats["highDensityResizeCount"] = json!(self.stats["highDensityResizeCount"].as_f64().unwrap_or(0.0) + attempts);
        }
    }

    pub fn get_solved_routes_with_terminal_pcb_port_ids(&self, solver: &dyn HighDensityNodeSolver) -> Result<Vec<Value>, String> {
        Self::attach_terminal_pcb_port_ids(solver.node_with_port_points(), solver.solved_routes()?)
    }

    pub fn attach_terminal_pcb_port_ids(node: &Value, mut routes: Vec<Value>) -> Result<Vec<Value>, String> {
        let terminals: Vec<_> = node["portPoints"].as_array().ok_or("Port points required")?.iter()
            .filter(|point| point.get("pcb_port_id").is_some()).collect();
        if terminals.is_empty() { return Ok(routes); }
        for route in &mut routes {
            let points = route["route"].as_array().ok_or("Route points required")?;
            let mut endpoints = Vec::new();
            for point in [points.first(), if points.len() > 1 { points.last() } else { None }] {
                let mut id = None;
                if let Some(point) = point {
                    let matches: Vec<_> = terminals.iter().filter(|terminal| terminal["connectionName"] == route["connectionName"]
                        && ["x","y","z"].iter().all(|key| terminal[*key].as_f64() == point[*key].as_f64())).collect();
                    if matches.len() > 1 { return Err(format!("HighDensitySolver found multiple PCB terminals at an endpoint of \"{}\"", route["connectionName"].as_str().unwrap())); }
                    if let Some(terminal) = matches.first() {
                        if terminal["pcb_port_id"].as_str().is_some_and(|value| !value.is_empty()) { id = Some(terminal["pcb_port_id"].clone()); }
                    }
                }
                endpoints.push(id);
            }
            for (key, id) in ["startPcbPortId","endPcbPortId"].iter().zip(endpoints) {
                if let Some(id) = id { route[*key] = id; } else { route.as_object_mut().unwrap().shift_remove(*key); }
            }
        }
        Ok(routes)
    }

    pub fn update_cache_stats(&mut self, cache_stats: &mut CacheStats<'_>) {
        let (hits, misses) = cache_stats();
        self.stats["intraNodeCacheHits"] = json!(hits);
        self.stats["intraNodeCacheMisses"] = json!(misses);
    }

    pub fn _step(&mut self, factory: &mut NodeFactory<'_>, cache_stats: &mut CacheStats<'_>) -> Result<(), String> {
        self.update_cache_stats(cache_stats);
        if let Some(mut solver) = self.active_sub_solver.take() {
            let active_id = solver.id();
            let mut observe = |enter: bool| -> Result<(), String> {
                if let Some(callback) = &self.observe_parent {
                    if enter {
                        let mut snapshot = self.snapshot()?;
                        snapshot["activeId"] = json!(active_id);
                        callback(Some(snapshot))?;
                    } else { callback(None)?; }
                }
                Ok(())
            };
            if let Err(error) = solver.step(Some(&mut observe)) { self.active_sub_solver = Some(solver); return Err(error); }
            let state = solver.state();
            if state.solved {
                let routes = if self.preserve_terminal_pcb_port_ids { self.get_solved_routes_with_terminal_pcb_port_ids(solver.as_ref()) } else { solver.solved_routes() };
                match routes { Ok(routes) => self.routes.extend(routes), Err(error) => { self.active_sub_solver = Some(solver); return Err(error); } }
                self.record_node_solve_metadata(solver.as_ref(), "solved")?;
                self.record_solved_node_stats(solver.as_ref());
                self.record_resize_stats(solver.as_ref());
            } else if state.failed {
                self.record_node_solve_metadata(solver.as_ref(), "failed")?;
                self.record_resize_stats(solver.as_ref());
                self.failed_solvers.push(solver);
            } else { self.active_sub_solver = Some(solver); }
            self.update_cache_stats(cache_stats);
            return Ok(());
        }
        if self.unsolved_node_port_points.is_empty() {
            if !self.failed_solvers.is_empty() {
                self.base.solved = false;
                self.base.failed = true;
                let ids = self.failed_solvers.iter().take(5).map(|solver| solver.node_with_port_points()["capacityMeshNodeId"].as_str().unwrap().to_owned()).collect::<Vec<_>>().join(",");
                self.base.error = Some(format!("Failed to solve {} nodes, {}. err0: {}.", self.failed_solvers.len(), ids, self.failed_solvers[0].state().error.as_deref().unwrap_or("null")));
            } else { self.base.solved = true; }
            self.update_cache_stats(cache_stats);
            return Ok(());
        }
        let node = self.unsolved_node_port_points.pop().unwrap();
        self.active_sub_solver = Some(factory(node, self)?);
        self.update_cache_stats(cache_stats);
        Ok(())
    }

    pub fn step(&mut self, factory: &mut NodeFactory<'_>, cache_stats: &mut CacheStats<'_>) -> Result<(), String> {
        if self.base.solved || self.base.failed { return Ok(()); }
        self.base.iterations += 1;
        if let Err(error) = self._step(factory, cache_stats) {
            self.base.error = Some(format!("HighDensitySolver error: {error}"));
            self.base.failed = true;
            return Err(error);
        }
        if !self.base.solved && self.base.iterations as f64 > self.base.max_iterations {
            self.base.error = Some(format!("HighDensitySolver ran out of iterations (MAX_ITERATIONS={})", js_number_to_string(self.base.max_iterations)));
            self.base.failed = true;
        }
        Ok(())
    }

    pub fn visualize(&self, transparentize: &dyn Fn(&str, f64) -> String) -> Result<Value, String> {
        let mut graphics = json!({"lines":[],"points":[],"rects":[],"circles":[]});
        for route in &self.routes {
            let name = route["connectionName"].as_str().ok_or("Connection name required")?;
            let mut label = name.to_owned();
            if let Some(root) = route["rootConnectionName"].as_str().filter(|root| !root.is_empty()) { label.push_str(&format!("\nrootConnectionName: {root}")); }
            let color = self.color_map.get(name);
            for segment in merge_route_segments(route["route"].as_array().ok_or("Route points required")?, name, color) {
                let mut line = json!({"points":segment.points,"label":label});
                if segment.z == 0.0 {
                    if let Some(color) = segment.color { line["strokeColor"] = color; }
                } else if let Some(color) = segment.color.as_ref().and_then(Value::as_str) { line["strokeColor"] = json!(transparentize(color, 0.5)); }
                line["layer"] = json!(format!("z{}", js_number_to_string(segment.z)));
                if let Some(width) = route.get("traceThickness") { line["strokeWidth"] = width.clone(); }
                if segment.z != 0.0 { line["strokeDash"] = json!([0.1,0.3]); }
                graphics["lines"].as_array_mut().unwrap().push(line);
            }
            for via in route["vias"].as_array().ok_or("Route vias required")? {
                let mut circle = json!({"center":via,"layer":"z0,1","radius":route["viaDiameter"].as_f64().unwrap()/2.0});
                if let Some(color) = color { circle["fill"] = color.clone(); }
                circle["label"] = json!(format!("{label}\nvia"));
                graphics["circles"].as_array_mut().unwrap().push(circle);
            }
        }
        if self.base.solved || self.base.failed {
            for (id, metadata) in &self.node_solve_metadata_by_id {
                let node = &metadata["node"];
                let x = node["center"]["x"].as_f64().unwrap();
                let y = node["center"]["y"].as_f64().unwrap();
                let width = node["width"].as_f64().unwrap();
                let height = node["height"].as_f64().unwrap();
                let left = x-width/2.0;
                let right = x+width/2.0;
                let top = y-height/2.0;
                let bottom = y+height/2.0;
                let status = metadata["status"].as_str().unwrap();
                let pf = metadata["nodePf"].as_f64().map(js_number_to_string).unwrap_or("n/a".into());
                let mut label = format!("hd_node_marker\nnode: {}\nstatus: {}\nsolver: {}\niterations: {}\nroutes: {}\nnodePf: {}\nportPoints: {}", id, status,
                    metadata["solverType"].as_str().unwrap(), metadata["iterations"], metadata["routeCount"], pf, node["portPoints"].as_array().unwrap().len());
                if let Some(error) = metadata["error"].as_str().filter(|error| !error.is_empty()) { label.push_str(&format!("\nerror: {error}")); }
                let color = if status == "solved" { "blue" } else { "red" };
                for (a,b) in [((left,top),(right,top)),((right,top),(right,bottom)),((right,bottom),(left,bottom)),((left,bottom),(left,top))] {
                    graphics["lines"].as_array_mut().unwrap().push(json!({"points":[{"x":a.0,"y":a.1},{"x":b.0,"y":b.1}],
                        "layer":"hd_node_boundaries","strokeColor":color,"strokeDash":"6, 4","strokeWidth":0.03,"label":label}));
                }
                if status == "solved" {
                    graphics["points"].as_array_mut().unwrap().push(json!({"x":x,"y":y,"color":color,"layer":"hd_node_markers","label":label}));
                } else {
                    graphics["lines"].as_array_mut().unwrap().push(json!({"points":[{"x":0,"y":0},{"x":x,"y":y}],
                        "layer":"hd_failed_node_guides","strokeColor":"red","strokeDash":"8, 6","strokeWidth":0.05,"label":label}));
                    graphics["rects"].as_array_mut().unwrap().push(json!({"center":node["center"],"layer":"hd_node_markers",
                        "width":crate::bindings::high_density::specialized_utils::math::max(width*0.1,0.12),"height":crate::bindings::high_density::specialized_utils::math::max(height*0.1,0.12),"fill":"red","label":label}));
                }
            }
        }
        if let Some(active) = &self.active_sub_solver {
            let child = active.visualize(transparentize)?;
            let mut combined = json!({"points":[],"lines":[],"circles":[],"rects":[],"polygons":[],"infiniteLines":[],"arrows":[],"texts":[]});
            for (index, visualization) in [&graphics, &child].iter().enumerate() {
                for key in ["lines","points","circles","rects","polygons","infiniteLines","arrows","texts"] {
                    if let Some(items) = visualization[key].as_array() {
                        for item in items { let mut item = item.clone(); item["step"] = json!(index); combined[key].as_array_mut().unwrap().push(item); }
                    }
                }
            }
            graphics = combined;
        }
        Ok(graphics)
    }

    pub fn snapshot(&self) -> Result<Value, String> {
        let mut snapshot = serde_json::to_value(self).map_err(|error| error.to_string())?;
        snapshot["activeId"] = self.active_sub_solver.as_ref().map(|solver| json!(solver.id())).unwrap_or(Value::Null);
        snapshot["failedIds"] = json!(self.failed_solvers.iter().map(|solver| solver.id()).collect::<Vec<_>>());
        Ok(snapshot)
    }

    pub fn solve(&mut self, factory: &mut NodeFactory<'_>, cache_stats: &mut CacheStats<'_>) -> Result<(), String> {
        while !self.base.solved && !self.base.failed {
            self.step(factory, cache_stats)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct Child { id: u32, node: Value, state: BaseSolverState }
    impl HighDensityNodeSolver for Child {
        fn id(&self) -> u32 { self.id }
        fn state(&self) -> BaseSolverState { self.state.clone() }
        fn step(&mut self, _observe_parent: Option<&mut dyn FnMut(bool) -> Result<(), String>>) -> Result<(), String> { self.state.iterations += 1; self.state.solved = true; Ok(()) }
        fn solved_routes(&self) -> Result<Vec<Value>, String> {
            Ok(vec![json!({"connectionName":"a","route":[{"x":0,"y":0,"z":0},{"x":1,"y":0,"z":0}],"vias":[],"traceThickness":0.15,"viaDiameter":0.3})])
        }
        fn node_with_port_points(&self) -> &Value { &self.node }
        fn solver_type_name(&self) -> String { "Child".into() }
        fn growth_attempts(&self) -> Option<f64> { Some(2.0) }
        fn visualize(&self, _: &dyn Fn(&str, f64) -> String) -> Result<Value, String> { Ok(json!({})) }
    }

    #[test]
    fn board_pops_nodes_and_records_routes_between_cache_updates() {
        let events = Rc::new(RefCell::new(Vec::new()));
        let cache_events = events.clone();
        let mut cache = move || {
            cache_events.borrow_mut().push("cache".to_owned());
            (3.0, 4.0)
        };
        let factory_events = events.clone();
        let mut factory = move |node: Value, _: &HighDensitySolver| -> Result<Box<dyn HighDensityNodeSolver>, String> {
            factory_events.borrow_mut().push(node["capacityMeshNodeId"].as_str().unwrap().to_owned());
            Ok(Box::new(Child { id: 1, node, state: BaseSolverState::default() }))
        };
        let ports = json!([{"connectionName":"a","x":0,"y":0,"z":0,"pcb_port_id":"p0"},{"connectionName":"a","x":1,"y":0,"z":0,"pcb_port_id":"p1"}]);
        let mut board = HighDensitySolver::new(json!({"nodePortPoints":[{"capacityMeshNodeId":"first","portPoints":ports},{"capacityMeshNodeId":"last","portPoints":ports}],"preserveTerminalPcbPortIds":true,"nodePfById":{"last":0.1}})).unwrap();
        board.step(&mut factory, &mut cache).unwrap();
        assert_eq!(&*events.borrow(), &["cache","last","cache"]);
        assert_eq!(board.unsolved_node_port_points.len(), 1);
        assert!(board.routes.is_empty());
        board.step(&mut factory, &mut cache).unwrap();
        assert_eq!(&*events.borrow(), &["cache","last","cache","cache","cache"]);
        assert_eq!(board.routes[0]["startPcbPortId"], "p0");
        assert_eq!(board.routes[0]["endPcbPortId"], "p1");
        assert_eq!(board.stats["highDensityResizeCount"], 2.0);
        assert_eq!(board.node_solve_metadata_by_id["last"]["iterations"], 1);
        board.solve(&mut factory, &mut cache).unwrap();
        assert!(board.base.solved);
        assert_eq!(board.base.iterations, 5);
        assert_eq!(board.routes.len(), 2);
    }
}
