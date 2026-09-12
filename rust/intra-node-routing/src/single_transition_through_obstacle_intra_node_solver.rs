use indexmap::IndexMap;
use std::rc::Rc;
use serde::{Serialize, Deserialize};
use serde_json::{Value, json};
use crate::connectivity_map::ConnectivityMap;
use crate::specialized_base_solver::{BaseSolverState, SpecializedSolver};
use crate::specialized_utils::create_objects_with_z_layers::create_objects_with_z_layers_owned;
use crate::specialized_utils::get_connection_port_point_pairs::get_connection_port_point_pairs;
use crate::specialized_utils::math::SpecializedMath;
use crate::js_number::js_number_to_string;

const CONTAINS_POINT_TOLERANCE: f64 = 1e-6;
fn n(value: &Value) -> f64 { value.as_f64().expect("Required numeric coordinate") }
fn truthy(value: &Value) -> bool {
    match value { Value::Null => false, Value::Bool(v) => *v, Value::Number(v) => v.as_f64().is_some_and(|n| n != 0.0 && !n.is_nan()), Value::String(v) => !v.is_empty(), _ => true }
}

pub fn point_inside_obstacle(point: &Value, obstacle: &Value) -> bool {
    let half_width = n(&obstacle["width"]) / 2.0 + CONTAINS_POINT_TOLERANCE;
    let half_height = n(&obstacle["height"]) / 2.0 + CONTAINS_POINT_TOLERANCE;
    (n(&point["x"]) - n(&obstacle["center"]["x"])).abs() <= half_width
        && (n(&point["y"]) - n(&obstacle["center"]["y"])).abs() <= half_height
}

pub fn obstacle_is_connected_to_route(obstacle: &Value, name: &str, conn_map: Option<&ConnectivityMap>) -> bool {
    obstacle["connectedTo"].as_array().expect("Obstacle connectedTo").iter().any(|id| {
        let id = id.as_str().expect("Connected ID");
        id == name || conn_map.is_some_and(|map| map.are_ids_connected(name, id))
    })
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SingleTransitionThroughObstacleIntraNodeSolver {
    #[serde(flatten)] pub base: BaseSolverState,
    pub node_with_port_points: Value,
    pub routes: Vec<Value>,
    pub obstacles: Rc<Vec<Value>>,
    pub via_diameter: f64,
    pub trace_thickness: f64,
    #[serde(skip_serializing_if = "Option::is_none")] pub conn_map: Option<Rc<ConnectivityMap>>,
    pub solved_routes: Vec<Value>,
}

impl SingleTransitionThroughObstacleIntraNodeSolver {
    pub fn new(params: Value) -> Result<Self, String> { Self::new_with_math(params, SpecializedMath::default()) }

    pub fn new_with_math(mut params: Value, math: SpecializedMath) -> Result<Self, String> {
        let fields = params.as_object_mut().ok_or("Solver parameters required")?;
        let conn_map = fields.remove("connMap").filter(|v| !v.is_null())
            .map(|value| serde_json::from_value(value).map(Rc::new).map_err(|error| error.to_string())).transpose()?;
        if !fields.contains_key("nodeWithPortPoints") { return Err("Node required".into()); }
        let objects = match fields.remove("obstacles") {
            Some(Value::Array(objects)) => objects,
            _ => Vec::new(),
        };
        let layer_count = fields.get("layerCount").and_then(Value::as_f64).unwrap_or(2.0);
        let obstacles = Rc::new(create_objects_with_z_layers_owned(objects, layer_count));
        Self::new_with_context(params, math, obstacles, conn_map)
    }

    pub fn new_with_context(
        mut params: Value,
        _math: SpecializedMath,
        obstacles: Rc<Vec<Value>>,
        conn_map: Option<Rc<ConnectivityMap>>,
    ) -> Result<Self, String> {
        let node_with_port_points = params.as_object_mut().ok_or("Solver parameters required")?
            .remove("nodeWithPortPoints").ok_or("Node required")?;
        let mut solver = Self {
            base: BaseSolverState::default(),
            node_with_port_points,
            routes: Vec::new(),
            obstacles,
            conn_map,
            via_diameter: params["viaDiameter"].as_f64().unwrap_or(0.3),
            trace_thickness: params["traceThickness"].as_f64().unwrap_or(0.15),
            solved_routes: Vec::new(),
        };
        solver.routes = solver.extract_routes_from_node();
        if solver.routes.is_empty() {
            solver.base.failed = true;
            solver.base.error = Some("Expected at least 1 route".into());
            return Ok(solver);
        }
        if solver.routes.iter().any(|route| route["A"].get("z").is_none() || route["B"].get("z").is_none()) {
            solver.base.failed = true;
            solver.base.error = Some("Route points should have predefined z values".into());
            return Ok(solver);
        }
        if !solver.routes.iter().any(|route| route["A"]["z"] != route["B"]["z"]) {
            solver.base.failed = true;
            solver.base.error = Some("No route transitions through an obstacle".into());
            return Ok(solver);
        }
        let containing: Vec<_> = solver.routes.iter().map(|route| solver.get_containing_through_obstacle(route)).collect();
        if containing.iter().any(Option::is_none) {
            solver.base.failed = true;
            solver.base.error = Some("No same-net multilayer obstacle contains every route".into());
            return Ok(solver);
        }
        let solved_routes = solver.routes.iter().zip(containing).map(|(route, obstacle)| {
            let a = &route["A"];
            let b = &route["B"];
            let mut start = json!({"x":a["x"],"y":a["y"],"z":a["z"]});
            if a["z"] != b["z"] {
                start["toNextSegmentType"] = json!("through_obstacle");
                let metadata = &obstacle.unwrap()["circuitJsonMetadata"];
                if truthy(metadata) { start["toNextSegmentCircuitJsonMetadata"] = metadata.clone(); }
            }
            let mut output = json!({"connectionName":route["connectionName"]});
            if let Some(root) = route.get("rootConnectionName") { output["rootConnectionName"] = root.clone(); }
            output["regionId"] = solver.node_with_port_points["capacityMeshNodeId"].clone();
            output["route"] = json!([start,{"x":b["x"],"y":b["y"],"z":b["z"]}]);
            output["traceThickness"] = json!(solver.trace_thickness);
            output["viaDiameter"] = json!(solver.via_diameter);
            output["vias"] = json!([]);
            output
        }).collect();
        solver.solved_routes = solved_routes;
        solver.base.solved = true;
        Ok(solver)
    }

    pub fn is_applicable(params: Value) -> Result<bool, String> { Ok(Self::new(params)?.base.solved) }

    pub fn extract_routes_from_node(&self) -> Vec<Value> {
        let mut groups: IndexMap<&str, Vec<&Value>> = IndexMap::new();
        for point in self.node_with_port_points["portPoints"].as_array().expect("Port points") {
            groups.entry(point["connectionName"].as_str().expect("Connection name")).or_default().push(point);
        }
        let mut routes = Vec::new();
        for (name, points) in groups {
            for [a, b] in get_connection_port_point_pairs(&points) {
                let mut route = json!({"A":a,"B":b,"connectionName":name});
                if let Some(root) = a.get("rootConnectionName").filter(|v| !v.is_null()).or_else(|| b.get("rootConnectionName")) {
                    route["rootConnectionName"] = root.clone();
                }
                routes.push(route);
            }
        }
        routes
    }

    pub fn get_containing_through_obstacle(&self, route: &Value) -> Option<&Value> {
        let a = route["A"].get("z")?;
        let b = route["B"].get("z")?;
        self.obstacles.iter().find(|obstacle| {
            let layers = obstacle["__zLayers"].as_array().expect("Obstacle z layers");
            if layers.len() < 2 || !layers.iter().any(|z| z.as_f64() == a.as_f64()) || !layers.iter().any(|z| z.as_f64() == b.as_f64()) { return false; }
            if !obstacle_is_connected_to_route(obstacle, route["connectionName"].as_str().expect("Connection name"), self.conn_map.as_deref()) { return false; }
            point_inside_obstacle(&route["A"], obstacle) && point_inside_obstacle(&route["B"], obstacle)
        })
    }

    pub fn visualize(&self) -> Value {
        let mut graphics = json!({"lines":[],"points":[],"rects":[],"circles":[]});
        for obstacle in self.obstacles.iter() {
            let layers = obstacle["__zLayers"].as_array().unwrap().iter().map(|z| js_number_to_string(n(z))).collect::<Vec<_>>().join(",");
            graphics["rects"].as_array_mut().unwrap().push(json!({"center":obstacle["center"],"width":obstacle["width"],"height":obstacle["height"],
                "fill":"rgba(128, 0, 128, 0.2)","stroke":"rgba(128, 0, 128, 0.6)","label":format!("through obstacle candidate\nz: {layers}")}));
        }
        for route in &self.solved_routes {
            let name = route["connectionName"].as_str().unwrap();
            graphics["lines"].as_array_mut().unwrap().push(json!({"points":route["route"],"strokeColor":"rgba(0, 180, 0, 0.8)","strokeDash":"4, 3","strokeWidth":route["traceThickness"],"label":format!("{name} through_obstacle")}));
            for point in route["route"].as_array().unwrap() {
                graphics["points"].as_array_mut().unwrap().push(json!({"x":point["x"],"y":point["y"],"color":"green","label":format!("{name}\nz: {}",js_number_to_string(n(&point["z"]))) }));
            }
        }
        graphics
    }
}

impl SpecializedSolver for SingleTransitionThroughObstacleIntraNodeSolver {
    fn base(&self) -> &BaseSolverState { &self.base }
    fn base_mut(&mut self) -> &mut BaseSolverState { &mut self.base }
    fn get_solver_name(&self) -> &'static str { "SingleTransitionThroughObstacleIntraNodeSolver" }
    fn _step(&mut self) -> Result<(), String> { self.base.solved = true; Ok(()) }
}
