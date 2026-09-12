use indexmap::{IndexMap, IndexSet};
use serde::{Serialize, Deserialize};
use serde_json::{Value, json};
use crate::bindings::high_density::specialized_base_solver::{BaseSolverState, SpecializedSolver};
use crate::bindings::high_density::specialized_utils::get_connection_port_point_pairs::get_connection_port_point_pairs;
use crate::bindings::high_density::specialized_utils::math::{Point, SpecializedMath, distance, do_segments_intersect, point_to_segment_distance};
use crate::utils::js_number::js_to_fixed;

const EPS: f64 = 1e-6;
const POINT_OFFSET: f64 = 0.02;

#[derive(Clone, Copy)]
pub struct Bounds { pub min_x: f64, pub max_x: f64, pub min_y: f64, pub max_y: f64 }
#[derive(Clone)]
pub struct ObstacleSegment { pub a: Point, pub b: Point, pub root_connection_name: String }

fn n(value: &Value) -> f64 { value.as_f64().expect("Required numeric coordinate") }
fn point(value: &Value) -> Point { Point { x: n(&value["x"]), y: n(&value["y"]) } }
fn root(value: &Value) -> &str { value.get("rootConnectionName").filter(|v| !v.is_null()).unwrap_or(&value["connectionName"]).as_str().expect("Root connection name") }

pub fn point_key(point: Point) -> String { format!("{},{}", js_to_fixed(point.x, 6), js_to_fixed(point.y, 6)) }
pub fn same_point(a: Point, b: Point) -> bool { (a.x-b.x).abs() < EPS && (a.y-b.y).abs() < EPS }

pub fn dedupe_points(points: Vec<Point>) -> Vec<Point> {
    let mut seen = IndexSet::new();
    let mut result = Vec::new();
    for point in points {
        if !seen.insert(point_key(point)) { continue; }
        result.push(point);
    }
    result
}

pub fn unique_available_z(node: &Value) -> Vec<f64> {
    let mut result = Vec::new();
    if let Some(layers) = node["availableZ"].as_array().filter(|layers| !layers.is_empty()) {
        for z in layers { let z = n(z); if !result.contains(&z) { result.push(z); } }
    } else {
        for p in node["portPoints"].as_array().expect("Port points") {
            let z = p["z"].as_f64().unwrap_or(0.0);
            if !result.contains(&z) { result.push(z); }
        }
    }
    result.sort_by(|a, b| (a-b).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal));
    result
}

pub fn get_bounds(node: &Value) -> Bounds {
    Bounds {
        min_x:n(&node["center"]["x"])-n(&node["width"])/2.0,
        max_x:n(&node["center"]["x"])+n(&node["width"])/2.0,
        min_y:n(&node["center"]["y"])-n(&node["height"])/2.0,
        max_y:n(&node["center"]["y"])+n(&node["height"])/2.0,
    }
}

pub fn get_edge(point: Point, bounds: Bounds) -> Option<&'static str> {
    if (point.y-bounds.min_y).abs() < 1e-3 { return Some("top"); }
    if (point.x-bounds.max_x).abs() < 1e-3 { return Some("right"); }
    if (point.y-bounds.max_y).abs() < 1e-3 { return Some("bottom"); }
    if (point.x-bounds.min_x).abs() < 1e-3 { return Some("left"); }
    None
}

pub fn is_inside_bounds(point: Point, bounds: Bounds) -> bool {
    point.x >= bounds.min_x-EPS && point.x <= bounds.max_x+EPS
        && point.y >= bounds.min_y-EPS && point.y <= bounds.max_y+EPS
}

pub fn segment_intersects_foreign_port(a: Point, b: Point, ports: &[Point]) -> bool {
    for &port in ports {
        if same_point(port,a) || same_point(port,b) { continue; }
        if point_to_segment_distance(port,a,b) < 1e-4 { return true; }
    }
    false
}

pub fn segment_intersects_obstacles(a: Point, b: Point, segments: &[ObstacleSegment]) -> bool {
    for segment in segments {
        if same_point(a,segment.a) || same_point(a,segment.b) || same_point(b,segment.a) || same_point(b,segment.b) { continue; }
        if do_segments_intersect(a,b,segment.a,segment.b) { return true; }
    }
    false
}

pub fn get_obstacle_segments(routes: &[Value], current_root: &str) -> Vec<ObstacleSegment> {
    let mut segments = Vec::new();
    for route in routes {
        let route_root = root(route);
        if route_root == current_root { continue; }
        for pair in route["route"].as_array().expect("Route points").windows(2) {
            if pair[0]["z"] != pair[1]["z"] { continue; }
            segments.push(ObstacleSegment { a:point(&pair[0]),b:point(&pair[1]),root_connection_name:route_root.to_owned() });
        }
    }
    segments
}

pub fn get_foreign_ports(node: &Value, current_root: &str) -> Vec<Point> {
    node["portPoints"].as_array().expect("Port points").iter().filter(|p| root(p) != current_root).map(point).collect()
}

// Visit yields in the same swap/recurse/swap order as the source generator;
// stop consuming immediately when the first successful order is returned.
fn permutations(items: &mut [Value], count: usize, visit: &mut impl FnMut(&[Value]) -> Option<Vec<Value>>) -> Option<Vec<Value>> {
    if count <= 1 { return visit(items); }
    for index in 0..count {
        items.swap(index,count-1);
        let result = permutations(items,count-1,visit);
        if result.is_some() { return result; }
        items.swap(index,count-1);
    }
    None
}

pub fn find_path(a: &Value, b: &Value, bounds: Bounds, obstacles: &[ObstacleSegment], foreign: &[Point]) -> Option<Vec<Value>> {
    let a_point = point(a);
    let b_point = point(b);
    let mut candidates = vec![
        a_point,b_point,
        Point { x:(bounds.min_x+bounds.max_x)/2.0,y:(bounds.min_y+bounds.max_y)/2.0 },
        Point { x:bounds.min_x,y:bounds.min_y },Point { x:bounds.max_x,y:bounds.min_y },
        Point { x:bounds.max_x,y:bounds.max_y },Point { x:bounds.min_x,y:bounds.max_y },
    ];
    let base: Vec<_> = obstacles.iter().flat_map(|s| [s.a,s.b]).chain(foreign.iter().copied()).chain([a_point,b_point]).collect();
    for p in base {
        for dx in [-POINT_OFFSET,0.0,POINT_OFFSET] {
            for dy in [-POINT_OFFSET,0.0,POINT_OFFSET] {
                let candidate = Point { x:p.x+dx,y:p.y+dy };
                if !is_inside_bounds(candidate,bounds) { continue; }
                candidates.push(candidate);
            }
        }
    }
    let nodes = dedupe_points(candidates);
    let start_key = point_key(a_point);
    let end_key = point_key(b_point);
    let by_key: IndexMap<_,_> = nodes.iter().map(|&p| (point_key(p),p)).collect();
    let mut distances: IndexMap<String,f64> = IndexMap::new();
    let mut previous: IndexMap<String,Option<String>> = IndexMap::new();
    let mut queue = IndexSet::new();
    for p in nodes {
        let key = point_key(p);
        distances.insert(key.clone(),if key == start_key {0.0} else {f64::INFINITY});
        previous.insert(key.clone(),None);
        queue.insert(key);
    }
    while !queue.is_empty() {
        let mut current: Option<String> = None;
        let mut current_distance = f64::INFINITY;
        for key in &queue {
            let d = distances.get(key).copied().unwrap_or(f64::INFINITY);
            if d < current_distance-EPS || ((d-current_distance).abs() <= EPS && current.as_ref().is_none_or(|current| key < current)) {
                current_distance = d;
                current = Some(key.clone());
            }
        }
        let Some(current) = current.filter(|key| !key.is_empty()) else { break; };
        if current_distance == f64::INFINITY { break; }
        queue.shift_remove(&current);
        if current == end_key { break; }
        let current_node = by_key[&current];
        for next in &queue {
            let next_node = by_key[next];
            if same_point(current_node,next_node) { continue; }
            if segment_intersects_obstacles(current_node,next_node,obstacles) { continue; }
            if segment_intersects_foreign_port(current_node,next_node,foreign) { continue; }
            let candidate_distance = current_distance+distance(current_node,next_node);
            let next_distance = distances.get(next).copied().unwrap_or(f64::INFINITY);
            let next_previous = previous.get(next).and_then(Option::as_ref);
            if candidate_distance < next_distance-EPS || ((candidate_distance-next_distance).abs() <= EPS && next_previous.is_none_or(|prior| &current < prior)) {
                distances.insert(next.clone(),candidate_distance);
                previous.insert(next.clone(),Some(current.clone()));
            }
        }
    }
    if distances.get(&end_key).copied().unwrap_or(f64::INFINITY) == f64::INFINITY { return None; }
    let mut path = Vec::new();
    let mut current = Some(end_key);
    while let Some(key) = current.filter(|key| !key.is_empty()) {
        path.push(by_key[&key]);
        current = previous.get(&key).cloned().flatten();
    }
    path.reverse();
    Some(path.into_iter().map(|p| {
        let mut result = json!({"x":p.x,"y":p.y});
        if let Some(z) = a.get("z") { result["z"] = z.clone(); }
        result
    }).collect())
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SingleLayerNoDifferentRootIntersectionsIntraNodeSolver {
    #[serde(flatten)] pub base: BaseSolverState,
    pub node_with_port_points: Value,
    pub trace_width: f64,
    pub via_diameter: f64,
    pub solved_routes: Vec<Value>,
    pub stats: Value,
}

impl SingleLayerNoDifferentRootIntersectionsIntraNodeSolver {
    pub fn new(params: Value) -> Result<Self,String> { Self::new_with_math(params,SpecializedMath::default()) }

    pub fn new_with_math(params: Value, _math: SpecializedMath) -> Result<Self,String> {
        let mut base = BaseSolverState::default();
        base.max_iterations = 1.0;
        Ok(Self { base,node_with_port_points:params.get("nodeWithPortPoints").ok_or("Node required")?.clone(),
            trace_width:params["traceWidth"].as_f64().unwrap_or(0.15),via_diameter:params["viaDiameter"].as_f64().unwrap_or(0.3),
            solved_routes:Vec::new(),stats:json!({}) })
    }

    pub fn is_applicable(node: &Value) -> bool {
        let layers = unique_available_z(node);
        if layers.len() != 1 { return false; }
        let ports = node["portPoints"].as_array().expect("Port points");
        if ports.len() > 12 { return false; }
        let bounds = get_bounds(node);
        if ports.iter().any(|p| get_edge(point(p),bounds).is_none()) { return false; }
        let mut counts: IndexMap<&str,usize> = IndexMap::new();
        for p in ports { *counts.entry(p["connectionName"].as_str().expect("Connection name")).or_default() += 1; }
        counts.values().any(|&count| count > 2)
    }

    pub fn build_task_groups(&self) -> IndexMap<String,Vec<Value>> {
        let mut groups: IndexMap<String,Vec<Value>> = IndexMap::new();
        for p in self.node_with_port_points["portPoints"].as_array().expect("Port points") {
            groups.entry(p["connectionName"].as_str().expect("Connection name").to_owned()).or_default().push(p.clone());
        }
        groups
    }

    pub fn try_solve_node(&self) -> Option<Vec<Value>> {
        let bounds = get_bounds(&self.node_with_port_points);
        let groups = self.build_task_groups();
        let mut tasks = Vec::new();
        for (name,points) in groups {
            for [a,b] in get_connection_port_point_pairs(&points.iter().collect::<Vec<_>>()) {
                let root = a.get("rootConnectionName").filter(|v| !v.is_null()).or_else(|| b.get("rootConnectionName").filter(|v| !v.is_null())).and_then(Value::as_str).unwrap_or(&name);
                tasks.push(json!({"connectionName":name,"rootConnectionName":root,"A":a,"B":b}));
            }
        }
        let mut try_order = |ordered: &[Value]| {
            let mut solved = Vec::new();
            for task in ordered {
                let root = task["rootConnectionName"].as_str().unwrap();
                let obstacles = get_obstacle_segments(&solved,root);
                let foreign = get_foreign_ports(&self.node_with_port_points,root);
                let path = find_path(&task["A"],&task["B"],bounds,&obstacles,&foreign)?;
                if path.len() < 2 { return None; }
                solved.push(json!({"connectionName":task["connectionName"],"rootConnectionName":task["rootConnectionName"],
                    "regionId":self.node_with_port_points["capacityMeshNodeId"],"traceThickness":self.trace_width,
                    "viaDiameter":self.via_diameter,"route":path,"vias":[]}));
            }
            Some(solved)
        };
        let count = tasks.len();
        if count <= 6 { permutations(&mut tasks,count,&mut try_order) } else { try_order(&tasks) }
    }

    pub fn visualize(&self) -> Value {
        let lines: Vec<_> = self.solved_routes.iter().map(|route| json!({"points":route["route"],"strokeColor":"cyan","strokeWidth":route["traceThickness"],
            "label":format!("{}\nroot: {}",route["connectionName"].as_str().unwrap(),root(route))})).collect();
        let points: Vec<_> = self.node_with_port_points["portPoints"].as_array().expect("Port points").iter().map(|p| json!({"x":p["x"],"y":p["y"],"color":"blue",
            "label":format!("{}\nroot: {}",p["connectionName"].as_str().unwrap(),root(p))})).collect();
        json!({"lines":lines,"points":points,"rects":[],"circles":[]})
    }
}

impl SpecializedSolver for SingleLayerNoDifferentRootIntersectionsIntraNodeSolver {
    fn base(&self) -> &BaseSolverState { &self.base }
    fn base_mut(&mut self) -> &mut BaseSolverState { &mut self.base }
    fn get_solver_name(&self) -> &'static str { "SingleLayerNoDifferentRootIntersectionsIntraNodeSolver" }
    fn _step(&mut self) -> Result<(),String> {
        let Some(routes) = self.try_solve_node() else {
            self.base.failed = true;
            self.base.error = Some("Failed to find a single-layer route set without different-root intersections".into());
            return Ok(());
        };
        self.solved_routes = routes;
        let distinct: IndexSet<_> = self.solved_routes.iter().map(root).collect();
        self.stats = json!({"routeCount":self.solved_routes.len(),"distinctRoots":distinct.len()});
        self.base.solved = true;
        Ok(())
    }
}
