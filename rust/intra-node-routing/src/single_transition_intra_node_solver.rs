use indexmap::IndexMap;
use serde::{Serialize, Deserialize};
use serde_json::{Value, json};
use crate::specialized_base_solver::{BaseSolverState, SpecializedSolver};
use crate::specialized_utils::get_connection_port_point_pairs::get_connection_port_point_pairs;
use crate::js_number::js_number_to_string;
use crate::specialized_utils::math::{clamp, SpecializedMath};

fn n(value: &Value) -> f64 { value.as_f64().expect("Required numeric coordinate") }
fn z_label(point: &Value) -> String { point.get("z").map(|v| if v.is_null() { "null".to_owned() } else { js_number_to_string(n(v)) }).unwrap_or_else(|| "undefined".to_owned()) }

pub fn clamp_with_fallback(value: f64, min: f64, max: f64) -> f64 {
    if min <= max { clamp(value, min, max) } else { value }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SingleTransitionIntraNodeSolver {
    #[serde(flatten)] pub base: BaseSolverState,
    pub node_with_port_points: Value,
    pub routes: Vec<Value>,
    pub via_diameter: f64,
    pub trace_thickness: f64,
    pub obstacle_margin: f64,
    pub solved_routes: Vec<Value>,
    pub bounds: Value,
}

impl SingleTransitionIntraNodeSolver {
    pub fn new(params: Value) -> Result<Self, String> { Self::new_with_math(params, SpecializedMath::default()) }

    pub fn new_with_math(params: Value, _math: SpecializedMath) -> Result<Self, String> {
        let mut solver = Self {
            base: BaseSolverState::default(),
            node_with_port_points: params.get("nodeWithPortPoints").ok_or("Node required")?.clone(),
            routes: Vec::new(),
            via_diameter: params["viaDiameter"].as_f64().unwrap_or(0.3),
            trace_thickness: params["traceThickness"].as_f64().unwrap_or(0.15),
            obstacle_margin: params["obstacleMargin"].as_f64().unwrap_or(0.1),
            solved_routes: Vec::new(), bounds: Value::Null,
        };
        solver.routes = solver.extract_routes_from_node();
        solver.bounds = solver.calculate_bounds();
        if solver.routes.len() != 1 {
            solver.base.failed = true;
            solver.base.error = Some(format!("Expected 1 route, but got {}", solver.routes.len()));
            return Ok(solver);
        }
        let route = &solver.routes[0];
        if route["A"].get("z").is_none() || route["B"].get("z").is_none() {
            solver.base.failed = true;
            solver.base.error = Some("Route points should have predefined z values".into());
            return Ok(solver);
        }
        if route["A"]["z"] == route["B"]["z"] {
            solver.base.failed = true;
            solver.base.error = Some("Only one route provided, but it has no transition".into());
            return Ok(solver);
        }
        let margin = solver.via_diameter / 2.0 + solver.obstacle_margin;
        let via = json!({
            "x":clamp_with_fallback((n(&route["A"]["x"])+n(&route["B"]["x"]))/2.0,n(&solver.bounds["minX"])+margin,n(&solver.bounds["maxX"])-margin),
            "y":clamp_with_fallback((n(&route["A"]["y"])+n(&route["B"]["y"]))/2.0,n(&solver.bounds["minY"])+margin,n(&solver.bounds["maxY"])-margin),
        });
        let output = solver.create_transition_route(&route["A"], &route["B"], &via, route["connectionName"].as_str().expect("Connection name"));
        solver.solved_routes.push(output);
        solver.base.solved = true;
        Ok(solver)
    }

    pub fn extract_routes_from_node(&self) -> Vec<Value> {
        let mut groups: IndexMap<&str, Vec<&Value>> = IndexMap::new();
        for point in self.node_with_port_points["portPoints"].as_array().expect("Port points") {
            groups.entry(point["connectionName"].as_str().expect("Connection name")).or_default().push(point);
        }
        let mut routes = Vec::new();
        for (name, points) in groups {
            for [a, b] in get_connection_port_point_pairs(&points) {
                routes.push(json!({"A":a,"B":b,"connectionName":name}));
            }
        }
        routes
    }

    pub fn calculate_bounds(&self) -> Value {
        let node = &self.node_with_port_points;
        json!({"minX":n(&node["center"]["x"])-n(&node["width"])/2.0,
            "maxX":n(&node["center"]["x"])+n(&node["width"])/2.0,
            "minY":n(&node["center"]["y"])-n(&node["height"])/2.0,
            "maxY":n(&node["center"]["y"])+n(&node["height"])/2.0})
    }

    pub fn create_transition_route(&self, start: &Value, end: &Value, via: &Value, name: &str) -> Value {
        let route = json!([
            {"x":start["x"],"y":start["y"],"z":start["z"]},
            {"x":via["x"],"y":via["y"],"z":start["z"]},
            {"x":via["x"],"y":via["y"],"z":end["z"]},
            {"x":end["x"],"y":end["y"],"z":end["z"]},
        ]);
        json!({"connectionName":name,"regionId":self.node_with_port_points["capacityMeshNodeId"],
            "route":route,"traceThickness":self.trace_thickness,"viaDiameter":self.via_diameter,"vias":[via]})
    }

    pub fn visualize(&self) -> Value {
        let mut graphics = json!({"lines":[],"points":[],"rects":[],"circles":[]});
        graphics["rects"].as_array_mut().unwrap().push(json!({
            "center":{"x":(n(&self.bounds["minX"])+n(&self.bounds["maxX"]))/2.0,"y":(n(&self.bounds["minY"])+n(&self.bounds["maxY"]))/2.0},
            "width":n(&self.bounds["maxX"])-n(&self.bounds["minX"]),"height":n(&self.bounds["maxY"])-n(&self.bounds["minY"]),
            "stroke":"rgba(0, 0, 0, 0.5)","fill":"rgba(240, 240, 240, 0.1)","label":"PCB Bounds"}));
        for route in &self.routes {
            let name = route["connectionName"].as_str().unwrap();
            for (key, label) in [("A", "start"), ("B", "end")] {
                let p = &route[key];
                graphics["points"].as_array_mut().unwrap().push(json!({"x":p["x"],"y":p["y"],"label":format!("{name} {label} (z={})",z_label(p)),"color":"orange"}));
            }
            graphics["lines"].as_array_mut().unwrap().push(json!({"points":[route["A"],route["B"]],"strokeColor":"rgba(255, 0, 0, 0.5)","label":format!("{name} direct")}));
        }
        for route in &self.solved_routes {
            let points = route["route"].as_array().unwrap();
            let name = route["connectionName"].as_str().unwrap();
            for pair in points.windows(2) {
                let mut line = json!({"points":pair,"strokeColor":"rgba(0, 255, 0, 0.75)"});
                if pair[0]["z"] != points[0]["z"] { line["strokeDash"] = json!([0.2,0.2]); }
                line["strokeWidth"] = route["traceThickness"].clone();
                line["label"] = json!(format!("{name} z={}",z_label(&pair[0])));
                graphics["lines"].as_array_mut().unwrap().push(line);
            }
            for via in route["vias"].as_array().unwrap() {
                graphics["circles"].as_array_mut().unwrap().push(json!({"center":via,"radius":self.via_diameter/2.0,"fill":"rgba(0, 0, 255, 0.8)","stroke":"black","label":"Solved Via"}));
                graphics["circles"].as_array_mut().unwrap().push(json!({"center":via,"radius":self.via_diameter/2.0+self.obstacle_margin,"fill":"rgba(0, 0, 255, 0.3)","stroke":"black","label":"Via Margin"}));
            }
        }
        graphics
    }
}

impl SpecializedSolver for SingleTransitionIntraNodeSolver {
    fn base(&self) -> &BaseSolverState { &self.base }
    fn base_mut(&mut self) -> &mut BaseSolverState { &mut self.base }
    fn get_solver_name(&self) -> &'static str { "SingleTransitionIntraNodeSolver" }
    fn _step(&mut self) -> Result<(), String> { self.base.solved = true; Ok(()) }
}
