use std::cell::{Cell, RefCell};
use rustc_hash::{FxHashMap as HashMap, FxHashSet as HashSet};
use std::rc::{Rc, Weak};

use serde_json::{json, Value};

use crate::solvers::high_density_solver::flatbush::Flatbush;
use crate::solvers::high_density_solver::connectivity_map::ConnectivityMap;
use crate::solvers::high_density_solver::geometry::{distance, do_segments_intersect, point_to_segment_distance};
use crate::data_structures::single_route_candidate_priority_queue::{Node, SingleRouteCandidatePriorityQueue};
use crate::solvers::high_density_solver::single_high_density_route_solver6_vert_horz_layer_future_cost::FutureCost;
use crate::types::high_density_types::{Bounds, Point, Point2, Route, RoutePoint};
pub use crate::types::high_density_types::FutureConnection;

pub struct SingleRouteSolverOptions {
    pub bounds: Bounds,
    pub endpoint_a: RoutePoint,
    pub endpoint_b: RoutePoint,
    pub obstacle_routes: Vec<Route>,
    pub future_connections: Vec<FutureConnection>,
    pub hyper_parameters: Value,
    pub conn_map: Option<ConnectivityMap>,
    pub connection_name: String,
    pub root_connection_name: Option<String>,
    pub region_id: Option<String>,
    pub layer_count: usize,
    pub available_z: Vec<f64>,
    pub via_diameter: f64,
    pub trace_thickness: f64,
    pub obstacle_margin: f64,
    pub nearby_segment_clearance: Option<f64>,
    pub min_dist_between_entering_points: f64,
    pub capture_search_debug: bool,
}

impl SingleRouteSolverOptions {
    pub fn from_value(mut opts: Value) -> Self {
        Self {
            bounds: serde_json::from_value(opts.get_mut("bounds").map(Value::take).unwrap_or(Value::Null)).expect("bounds"),
            endpoint_a: serde_json::from_value(opts.get_mut("A").map(Value::take).unwrap_or(Value::Null)).expect("A"),
            endpoint_b: serde_json::from_value(opts.get_mut("B").map(Value::take).unwrap_or(Value::Null)).expect("B"),
            obstacle_routes: serde_json::from_value(opts.get_mut("obstacleRoutes").map(Value::take).unwrap_or(Value::Null)).expect("obstacleRoutes"),
            future_connections: opts.get_mut("futureConnections")
                .map(|value| serde_json::from_value(value.take()).expect("futureConnections"))
                .unwrap_or_default(),
            hyper_parameters: opts.get_mut("hyperParameters").map(Value::take).unwrap_or_else(|| json!({})),
            conn_map: opts.get_mut("connMap").filter(|value| !value.is_null())
                .map(|value| serde_json::from_value(value.take()).expect("connMap")),
            connection_name: opts["connectionName"].as_str().expect("connectionName").to_owned(),
            root_connection_name: opts["rootConnectionName"].as_str().map(str::to_owned),
            region_id: opts["regionId"].as_str().map(str::to_owned),
            layer_count: opts["layerCount"].as_f64().unwrap_or(2.0) as usize,
            available_z: opts.get("availableZ").and_then(Value::as_array)
                .map(|values| values.iter().map(|value| value.as_f64().expect("availableZ number")).collect())
                .unwrap_or_default(),
            via_diameter: opts["viaDiameter"].as_f64().unwrap_or(0.3),
            trace_thickness: opts["traceThickness"].as_f64().unwrap_or(0.15),
            obstacle_margin: opts["obstacleMargin"].as_f64().unwrap_or(0.15),
            nearby_segment_clearance: opts.get("nearbySegmentClearance").filter(|value| !value.is_null())
                .map(|value| value.as_f64().unwrap_or(0.15)),
            min_dist_between_entering_points: opts["minDistBetweenEnteringPoints"].as_f64()
                .expect("minDistBetweenEnteringPoints"),
            capture_search_debug: opts["captureSearchDebug"].as_bool().unwrap_or(true),
        }
    }
}

#[derive(Clone, Debug)]
pub struct IndexedObstacleSegment {
    pub z: f64,
    pub a: Point,
    pub b: Point,
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
    pub connected_to_current_connection: bool,
}

pub struct PlanarObstacleQuery {
    pub layer: i64,
    pub segment_ids: Vec<usize>,
}

pub struct SingleHighDensityRouteSolver {
    pub diagnostic_id: usize,
    neighbor_scratch: Vec<Node>,
    planar_query_scratch: Vec<usize>,
    pub pow: fn(f64, f64) -> f64,
    pub exp: fn(f64) -> f64,
    pub solved: bool,
    pub failed: bool,
    pub iterations: usize,
    pub max_iterations: usize,
    pub progress: f64,
    pub error: Option<String>,
    pub obstacle_routes: Vec<Route>,
    pub bounds: Bounds,
    pub bounds_size: Point2,
    pub bounds_center: Point2,
    pub a: Point,
    pub b: Point,
    pub endpoint_a: RoutePoint,
    pub endpoint_b: RoutePoint,
    pub straight_line_distance: f64,
    pub via_diameter: f64,
    pub trace_thickness: f64,
    pub obstacle_margin: f64,
    pub layer_count: usize,
    pub available_z: Vec<f64>,
    pub min_cell_size: f64,
    pub cell_step: f64,
    pub greedy_multiplier: f64,
    pub num_routes: usize,
    pub via_penalty_factor: f64,
    pub cell_size_factor: f64,
    pub nearby_segment_clearance: f64,
    pub explored_nodes: HashSet<i64>,
    pub vias_in_path_by_node: RefCell<HashMap<usize, (Weak<Node>, Rc<Vec<Point2>>)>>,
    via_cache_sweep_threshold: Cell<usize>,
    pub grid_min_x_index: f64,
    pub grid_min_y_index: f64,
    pub grid_width: f64,
    pub grid_height: f64,
    pub candidates: SingleRouteCandidatePriorityQueue,
    pub connection_name: String,
    pub root_connection_name: Option<String>,
    pub region_id: Option<String>,
    pub solved_path: Option<Route>,
    pub future_connections: Vec<FutureConnection>,
    pub hyper_parameters: Value,
    pub conn_map: Option<ConnectivityMap>,
    pub obstacle_segments: Vec<IndexedObstacleSegment>,
    pub obstacle_segment_index: Option<Flatbush>,
    pub obstacle_segments_by_layer: HashMap<i64, Vec<IndexedObstacleSegment>>,
    pub obstacle_segment_index_by_layer: HashMap<i64, Flatbush>,
    pub obstacle_vias: Vec<Point2>,
    pub obstacle_via_index: Option<Flatbush>,
    pub debug_explored_nodes_ordered: Vec<(i64, Point)>,
    pub debug_nodes_too_close_to_obstacle: HashSet<i64>,
    pub debug_node_path_to_parent_intersects_obstacle: HashSet<i64>,
    pub debug_enabled: bool,
    pub initial_node_grid_offset: Point2,
    pub future_cost: Option<FutureCost>,
}

impl SingleHighDensityRouteSolver {
    pub fn get_solver_name(&self) -> &'static str {
        "SingleHighDensityRouteSolver"
    }

    pub fn new(opts: Value) -> Self {
        Self::new_typed(SingleRouteSolverOptions::from_value(opts))
    }

    pub fn new_typed(opts: SingleRouteSolverOptions) -> Self {
        let bounds = opts.bounds;
        let a = opts.endpoint_a.point();
        let b = opts.endpoint_b.point();
        let hyper_parameters = opts.hyper_parameters;
        let layer_count = opts.layer_count;
        let mut available_z = opts.available_z;
        if available_z.is_empty() {
            available_z = (0..layer_count).map(|z| z as f64).collect();
        } else {
            available_z.sort_by(|a, b| a.partial_cmp(b).expect("layer number"));
            available_z.dedup();
        }
        let mut solver = Self {
            diagnostic_id: 0,
            neighbor_scratch: Vec::new(), planar_query_scratch: Vec::new(),
            pow: f64::powf, exp: f64::exp,
            solved: false, failed: false, iterations: 0, max_iterations: 10000,
            progress: 0.0, error: None,
            obstacle_routes: opts.obstacle_routes,
            bounds,
            bounds_size: Point2 { x: bounds.max_x - bounds.min_x, y: bounds.max_y - bounds.min_y },
            bounds_center: Point2 { x: (bounds.min_x + bounds.max_x) / 2.0, y: (bounds.min_y + bounds.max_y) / 2.0 },
            endpoint_a: opts.endpoint_a,
            endpoint_b: opts.endpoint_b,
            a, b, straight_line_distance: distance(&a, &b),
            via_diameter: opts.via_diameter,
            trace_thickness: opts.trace_thickness,
            obstacle_margin: opts.obstacle_margin,
            layer_count, available_z,
            min_cell_size: 0.05, cell_step: 0.05, greedy_multiplier: 1.1,
            num_routes: 0, via_penalty_factor: 0.3,
            cell_size_factor: hyper_parameters["CELL_SIZE_FACTOR"].as_f64().unwrap_or(1.0),
            nearby_segment_clearance: opts.nearby_segment_clearance.unwrap_or(0.15),
            explored_nodes: HashSet::default(), vias_in_path_by_node: RefCell::new(HashMap::default()),
            via_cache_sweep_threshold: Cell::new(1024),
            grid_min_x_index: 0.0, grid_min_y_index: 0.0, grid_width: 0.0, grid_height: 0.0,
            candidates: SingleRouteCandidatePriorityQueue::new(vec![]),
            connection_name: opts.connection_name,
            root_connection_name: opts.root_connection_name,
            region_id: opts.region_id, solved_path: None,
            future_connections: opts.future_connections,
            hyper_parameters, conn_map: opts.conn_map,
            obstacle_segments: vec![], obstacle_segment_index: None,
            obstacle_segments_by_layer: HashMap::default(), obstacle_segment_index_by_layer: HashMap::default(),
            obstacle_vias: vec![], obstacle_via_index: None,
            debug_explored_nodes_ordered: vec![], debug_nodes_too_close_to_obstacle: HashSet::default(),
            debug_node_path_to_parent_intersects_obstacle: HashSet::default(),
            debug_enabled: opts.capture_search_debug,
            initial_node_grid_offset: Point2::default(), future_cost: None,
        };
        solver.num_routes = solver.obstacle_routes.len() + solver.future_connections.len();
        solver.build_obstacle_indexes();
        let best_row_or_column_count = (5.0 * (solver.num_routes as f64 + 1.0)).ceil();
        let min_dist = opts.min_dist_between_entering_points;
        let mut num_x_cells = solver.bounds_size.x / solver.cell_step;
        let mut num_y_cells = solver.bounds_size.y / solver.cell_step;
        while num_x_cells * num_y_cells > best_row_or_column_count.powi(2) {
            if solver.cell_step * 2.0 > min_dist { break; }
            solver.cell_step *= 2.0;
            num_x_cells = solver.bounds_size.x / solver.cell_step;
            num_y_cells = solver.bounds_size.y / solver.cell_step;
        }
        solver.cell_step *= solver.cell_size_factor;
        solver.grid_min_x_index = js_round(bounds.min_x / solver.cell_step) - 1.0;
        solver.grid_min_y_index = js_round(bounds.min_y / solver.cell_step) - 1.0;
        solver.grid_width = js_round(bounds.max_x / solver.cell_step) + 1.0 - solver.grid_min_x_index + 1.0;
        solver.grid_height = js_round(bounds.max_y / solver.cell_step) + 1.0 - solver.grid_min_y_index + 1.0;
        let is_on_same_edge = ((a.x - bounds.min_x).abs() < 0.001 && (b.x - bounds.min_x).abs() < 0.001)
            || ((a.x - bounds.max_x).abs() < 0.001 && (b.x - bounds.max_x).abs() < 0.001)
            || ((a.y - bounds.min_y).abs() < 0.001 && (b.y - bounds.min_y).abs() < 0.001)
            || ((a.y - bounds.max_y).abs() < 0.001 && (b.y - bounds.max_y).abs() < 0.001);
        if solver.future_connections.is_empty() && solver.obstacle_routes.is_empty() && !is_on_same_edge {
            solver.handle_simple_cases();
        }
        let initial_position = Point2 {
            x: js_round(a.x / (solver.cell_step / 2.0)) * (solver.cell_step / 2.0),
            y: js_round(a.y / (solver.cell_step / 2.0)) * (solver.cell_step / 2.0),
        };
        solver.initial_node_grid_offset = Point2 {
            x: initial_position.x - js_round(a.x / solver.cell_step) * solver.cell_step,
            y: initial_position.y - js_round(a.y / solver.cell_step) * solver.cell_step,
        };
        let initial_parent = Rc::new(Node { x: a.x, y: a.y, z: a.z, g: 0.0, h: 0.0, f: 0.0, parent: None });
        let rounded = Rc::new(Node { x: initial_position.x, y: initial_position.y, z: a.z,
            g: 0.0, h: 0.0, f: 0.0, parent: Some(initial_parent.clone()) });
        let differs = (rounded.x - a.x).abs() > 1e-9 || (rounded.y - a.y).abs() > 1e-9;
        let exact_start = differs && (solver.is_node_too_close_to_obstacle(&rounded, None, false, None)
            || solver.is_node_too_close_to_edge(&rounded, false)
            || solver.does_path_to_parent_intersect_obstacle(&rounded, None));
        solver.candidates = SingleRouteCandidatePriorityQueue::new(vec![if exact_start { initial_parent } else { rounded }]);
        solver
    }

    pub fn handle_simple_cases(&mut self) {
        self.solved = true;
        let route = if self.a.z == self.b.z { vec![self.endpoint_a.clone(), self.endpoint_b.clone()] } else {
            vec![self.endpoint_a.clone(), route_point(Point { x: self.bounds_center.x, y: self.bounds_center.y, z: self.a.z }),
                route_point(Point { x: self.bounds_center.x, y: self.bounds_center.y, z: self.b.z }), self.endpoint_b.clone()]
        };
        self.solved_path = Some(Route {
            connection_name: self.connection_name.clone(), root_connection_name: self.root_connection_name.clone(),
            region_id: self.region_id.clone(), route, simple_path: true,
            trace_thickness: self.trace_thickness, via_diameter: self.via_diameter,
            vias: if self.a.z == self.b.z { vec![] } else { vec![self.bounds_center] }, ..Default::default()
        });
    }

    pub fn via_penalty_distance(&self) -> f64 {
        self.cell_step + self.straight_line_distance * self.via_penalty_factor
    }

    pub fn is_node_too_close_to_obstacle(&self, node: &Node, margin: Option<f64>, is_via: bool, query: Option<&PlanarObstacleQuery>) -> bool {
        if self.is_node_too_close_to_obstacle_base(node, margin, is_via, query) { return true; }
        is_via && self.future_cost.is_some() && self.is_via_too_close_to_future_connection_trace(node)
    }

    pub fn is_node_too_close_to_obstacle_base(&self, node: &Node, margin: Option<f64>, is_via: bool, query: Option<&PlanarObstacleQuery>) -> bool {
        let margin = margin.unwrap_or(self.obstacle_margin);
        let position = node_point(node);
        if is_via {
            if let Some(parent) = &node.parent {
                for via in self.get_vias_in_node_path(parent).iter() {
                    if distance(&position, &Point { x: via.x, y: via.y, z: 0.0 }) < self.via_diameter / 2.0 + margin { return true; }
                }
            }
        }
        let trace_proximity = self.trace_thickness + margin;
        let indexed_segments = if let Some(query) = query { self.obstacle_segments_by_layer.get(&query.layer) }
            else if !is_via { self.obstacle_segments_by_layer.get(&(node.z as i64)) } else { Some(&self.obstacle_segments) };
        let searched_ids;
        let ids = if let Some(query) = query { query.segment_ids.as_slice() } else {
            let index = if !is_via { self.obstacle_segment_index_by_layer.get(&(node.z as i64)) } else { self.obstacle_segment_index.as_ref() };
            searched_ids = index.map(|index| index.search_reusing(node.x - trace_proximity, node.y - trace_proximity, node.x + trace_proximity, node.y + trace_proximity));
            searched_ids.as_deref().map(Vec::as_slice).unwrap_or(&[])
        };
        if let Some(segments) = indexed_segments {
            for &id in ids {
                let Some(segment) = segments.get(id) else { continue; };
                if segment.connected_to_current_connection || (!is_via && segment.z != node.z) { continue; }
                if query.is_some() && (node.x + trace_proximity < segment.min_x || node.y + trace_proximity < segment.min_y
                    || node.x - trace_proximity > segment.max_x || node.y - trace_proximity > segment.max_y) { continue; }
                if point_to_segment_distance(&position, &segment.a, &segment.b) < trace_proximity { return true; }
            }
        }
        let via_proximity = self.via_diameter / 2.0 + self.trace_thickness / 2.0 + margin;
        if let Some(index) = &self.obstacle_via_index {
            for &id in index.search_reusing(node.x - via_proximity, node.y - via_proximity, node.x + via_proximity, node.y + via_proximity).iter() {
                if let Some(via) = self.obstacle_vias.get(id) {
                    if distance(&position, &Point { x: via.x, y: via.y, z: 0.0 }) < via_proximity { return true; }
                }
            }
        }
        false
    }

    pub fn is_node_too_close_to_edge(&self, node: &Node, is_via: bool) -> bool {
        let margin = if is_via { self.via_diameter / 2.0 + self.obstacle_margin / 2.0 } else { self.obstacle_margin / 2.0 };
        let too_close = node.x < self.bounds.min_x + margin || node.x > self.bounds.max_x - margin
            || node.y < self.bounds.min_y + margin || node.y > self.bounds.max_y - margin;
        if too_close && !is_via && (distance(&node_point(node), &self.b) < margin * 2.0 || distance(&node_point(node), &self.a) < margin * 2.0) { return false; }
        too_close
    }

    pub fn does_path_to_parent_intersect_obstacle(&self, node: &Node, query: Option<&PlanarObstacleQuery>) -> bool {
        let Some(parent) = &node.parent else { return false; };
        let Some(segments) = self.obstacle_segments_by_layer.get(&query.map(|q| q.layer).unwrap_or(node.z as i64)) else { return false; };
        let clearance = if node.z == parent.z && !self.obstacle_segments.is_empty() { self.nearby_segment_clearance } else { 0.0 };
        let min_x = node.x.min(parent.x);
        let max_x = node.x.max(parent.x);
        let min_y = node.y.min(parent.y);
        let max_y = node.y.max(parent.y);
        let searched_ids;
        let ids = if let Some(query) = query { query.segment_ids.as_slice() } else {
            searched_ids = self.obstacle_segment_index_by_layer.get(&(node.z as i64))
                .map(|index| index.search_reusing(min_x - clearance, min_y - clearance, max_x + clearance, max_y + clearance));
            searched_ids.as_deref().map(Vec::as_slice).unwrap_or(&[])
        };
        for &id in ids {
            let Some(segment) = segments.get(id) else { continue; };
            if segment.connected_to_current_connection || segment.z != node.z { continue; }
            if query.is_some() && (max_x + clearance < segment.min_x || max_y + clearance < segment.min_y
                || min_x - clearance > segment.max_x || min_y - clearance > segment.max_y) { continue; }
            if do_segments_intersect(&node_point(node), &node_point(parent), &segment.a, &segment.b) { return true; }
            if clearance > 0.0 && get_segment_to_segment_centerline_distance(&node_point(node), &node_point(parent), &segment.a, &segment.b) < clearance { return true; }
        }
        false
    }

    pub fn get_planar_obstacle_query(&self, node: &Node) -> Option<PlanarObstacleQuery> {
        let mut query = PlanarObstacleQuery { layer: 0, segment_ids: Vec::new() };
        self.fill_planar_obstacle_query(node, &mut query).then_some(query)
    }

    fn fill_planar_obstacle_query(&self, node: &Node, query: &mut PlanarObstacleQuery) -> bool {
        let Some(parent) = node.parent.as_ref() else { return false; };
        let layer = node.z as i64;
        let Some(index) = self.obstacle_segment_index_by_layer.get(&layer) else { return false; };
        if !self.obstacle_segments_by_layer.contains_key(&layer) { return false; }
        let trace_proximity = self.trace_thickness + self.obstacle_margin;
        let clearance = if node.z == parent.z && !self.obstacle_segments.is_empty() { self.nearby_segment_clearance } else { 0.0 };
        query.layer = layer;
        index.search_into(
            (node.x - trace_proximity).min(parent.x - clearance), (node.y - trace_proximity).min(parent.y - clearance),
            (node.x + trace_proximity).max(parent.x + clearance), (node.y + trace_proximity).max(parent.y + clearance), &mut query.segment_ids);
        true
    }

    pub fn build_obstacle_indexes(&mut self) {
        if self.obstacle_routes.is_empty() {
            self.obstacle_segment_index = None;
            self.obstacle_segments_by_layer.clear();
            self.obstacle_segment_index_by_layer.clear();
            self.obstacle_via_index = None;
            return;
        }
        let mut segments = vec![];
        let mut vias = vec![];
        for route in &self.obstacle_routes {
            let connected = self.conn_map.as_ref().is_some_and(|map| map.are_ids_connected(&self.connection_name, &route.connection_name));
            for pair in route.route.windows(2) {
                if pair[0].z != pair[1].z { continue; }
                let a = pair[0].point();
                let b = pair[1].point();
                segments.push(IndexedObstacleSegment { z: a.z, a, b, min_x: a.x.min(b.x), min_y: a.y.min(b.y),
                    max_x: a.x.max(b.x), max_y: a.y.max(b.y), connected_to_current_connection: connected });
            }
            vias.extend(route.vias.iter().copied());
        }
        self.obstacle_segments = segments;
        self.obstacle_vias = vias;
        self.obstacle_segments_by_layer.clear();
        self.obstacle_segment_index_by_layer.clear();
        self.obstacle_segment_index = if self.obstacle_segments.is_empty() { None } else {
            let mut index = Flatbush::new(self.obstacle_segments.len());
            for segment in &self.obstacle_segments {
                index.add(segment.min_x, segment.min_y, segment.max_x, segment.max_y);
                if !segment.connected_to_current_connection {
                    self.obstacle_segments_by_layer.entry(segment.z as i64).or_default().push(segment.clone());
                }
            }
            index.finish();
            Some(index)
        };
        for (z, segments) in &self.obstacle_segments_by_layer {
            let mut index = Flatbush::new(segments.len());
            for segment in segments { index.add(segment.min_x, segment.min_y, segment.max_x, segment.max_y); }
            index.finish();
            self.obstacle_segment_index_by_layer.insert(*z, index);
        }
        self.obstacle_via_index = if self.obstacle_vias.is_empty() { None } else {
            let mut index = Flatbush::new(self.obstacle_vias.len());
            for via in &self.obstacle_vias { index.add(via.x, via.y, via.x, via.y); }
            index.finish();
            Some(index)
        };
    }

    pub fn compute_h(&self, node: &Node) -> f64 {
        if self.future_cost.is_some() { return self.compute_h_future(node); }
        distance(&node_point(node), &self.b) + if node.z != self.b.z { self.via_penalty_distance() } else { 0.0 }
    }

    pub fn compute_g(&self, node: &Node) -> f64 {
        if self.future_cost.is_some() { return self.compute_g_future(node); }
        let parent = node.parent.as_ref().expect("cost node parent");
        parent.g + if node.z == parent.z { 0.0 } else { self.via_penalty_distance() } + distance(&node_point(node), &node_point(parent))
    }

    pub fn compute_f(&self, g: f64, h: f64) -> f64 {
        g + h * self.greedy_multiplier
    }

    pub fn set_node_costs(&self, node: &mut Node) {
        if self.future_cost.is_some() { self.set_node_costs_future(node); return; }
        node.g = self.compute_g(node);
        node.h = self.compute_h(node);
        node.f = self.compute_f(node.g, node.h);
    }

    pub fn get_node_key(&self, node: &Node) -> i64 {
        let x_index = js_round(node.x / self.cell_step) - self.grid_min_x_index;
        let y_index = js_round(node.y / self.cell_step) - self.grid_min_y_index;
        ((node.z * self.grid_height + y_index) * self.grid_width + x_index) as i64
    }

    pub fn get_neighbors(&mut self, node: Rc<Node>) -> Vec<Rc<Node>> {
        let mut neighbors = Vec::new();
        self.fill_neighbors(node, &mut neighbors);
        neighbors.into_iter().map(Rc::new).collect()
    }

    fn fill_neighbors(&mut self, node: Rc<Node>, neighbors: &mut Vec<Node>) {
        neighbors.clear();
        let mut query_buffer = PlanarObstacleQuery { layer: 0, segment_ids: std::mem::take(&mut self.planar_query_scratch) };
        for x in -1..=1 {
            for y in -1..=1 {
                if x == 0 && y == 0 { continue; }
                let mut neighbor = Node { x: clamp(node.x + x as f64 * self.cell_step, self.bounds.min_x, self.bounds.max_x),
                    y: clamp(node.y + y as f64 * self.cell_step, self.bounds.min_y, self.bounds.max_y), z: node.z,
                    g: node.g, h: node.h, f: node.f, parent: Some(node.clone()) };
                let key = self.get_node_key(&neighbor);
                if self.explored_nodes.contains(&key) { continue; }
                let query = self.fill_planar_obstacle_query(&neighbor, &mut query_buffer).then_some(&query_buffer);
                if self.is_node_too_close_to_obstacle(&neighbor, None, false, query) {
                    if self.debug_enabled { self.debug_nodes_too_close_to_obstacle.insert(key); }
                    self.explored_nodes.insert(key);
                    continue;
                }
                if self.is_node_too_close_to_edge(&neighbor, false) { self.explored_nodes.insert(key); continue; }
                if self.does_path_to_parent_intersect_obstacle(&neighbor, query) {
                    if self.debug_enabled { self.debug_node_path_to_parent_intersects_obstacle.insert(key); }
                    self.explored_nodes.insert(key);
                    continue;
                }
                self.set_node_costs(&mut neighbor);
                neighbors.push(neighbor);
            }
        }
        for &new_z in &self.available_z {
            if new_z == node.z { continue; }
            let mut neighbor = Node { x: node.x, y: node.y, z: new_z, g: node.g, h: node.h, f: node.f, parent: Some(node.clone()) };
            if !self.explored_nodes.contains(&self.get_node_key(&neighbor))
                && !self.is_node_too_close_to_obstacle(&neighbor, Some(self.via_diameter / 2.0 + self.obstacle_margin / 2.0), true, None)
                && !self.is_node_too_close_to_edge(&neighbor, true) {
                self.set_node_costs(&mut neighbor);
                neighbors.push(neighbor);
            }
        }
        self.planar_query_scratch = query_buffer.segment_ids;
    }

    pub fn get_node_path(&self, node: Rc<Node>) -> Vec<Rc<Node>> {
        let mut path = vec![];
        let mut current = Some(node);
        while let Some(node) = current {
            current = node.parent.clone();
            path.push(node);
        }
        path
    }

    pub fn get_vias_in_node_path(&self, node: &Rc<Node>) -> Rc<Vec<Point2>> {
        let key = Rc::as_ptr(node) as usize;
        if let Some((weak, vias)) = self.vias_in_path_by_node.borrow().get(&key) {
            if weak.upgrade().is_some() { return vias.clone(); }
        }
        let parent_vias = node.parent.as_ref().map(|parent| self.get_vias_in_node_path(parent)).unwrap_or_else(|| Rc::new(vec![]));
        let vias = if node.parent.as_ref().is_some_and(|parent| node.z != parent.z) {
            let mut vias = vec![Point2 { x: node.x, y: node.y }];
            vias.extend(parent_vias.iter().copied());
            Rc::new(vias)
        } else { parent_vias };
        let mut cache = self.vias_in_path_by_node.borrow_mut();
        cache.insert(key, (Rc::downgrade(node), vias.clone()));
        if cache.len() >= self.via_cache_sweep_threshold.get() {
            // Match WeakMap lifetime: dead keys must not retain their allocation
            // and cached path forever. Live/observed node identities remain intact.
            cache.retain(|_, (node, _)| node.strong_count() != 0);
            self.via_cache_sweep_threshold.set(cache.len().saturating_mul(2).max(1024));
        }
        vias
    }

    pub fn set_solved_path(&mut self, node: Rc<Node>) {
        let mut path = self.get_node_path(node);
        path.reverse();
        let mut vias = vec![];
        for pair in path.windows(2) {
            if pair[0].z != pair[1].z { vias.push(Point2 { x: pair[0].x, y: pair[0].y }); }
        }
        let mut route: Vec<RoutePoint> = path.iter().map(|node| route_point(node_point(node))).collect();
        route.push(self.endpoint_b.clone());
        self.solved_path = Some(Route { connection_name: self.connection_name.clone(), root_connection_name: self.root_connection_name.clone(),
            region_id: self.region_id.clone(), trace_thickness: self.trace_thickness, via_diameter: self.via_diameter, route, vias, ..Default::default() });
    }

    pub fn compute_progress(&self, goal_dist: Option<f64>, is_on_layer: Option<bool>) -> f64 {
        let (Some(mut goal_dist), Some(is_on_layer)) = (goal_dist, is_on_layer) else { return f64::NAN; };
        if !is_on_layer { goal_dist += self.via_penalty_distance(); }
        let goal_dist_percent = 1.0 - goal_dist / self.straight_line_distance;
        let prior = if self.progress.is_nan() || self.progress == 0.0 { 0.0 } else { self.progress };
        let next = (2.0 / std::f64::consts::PI) * ((0.112 * goal_dist_percent) / (1.0 - goal_dist_percent)).atan();
        if next.is_nan() { f64::NAN } else { prior.max(next) }
    }

    pub fn step(&mut self) {
        if self.solved || self.failed { return; }
        self.iterations += 1;
        self.step_inner();
        if !self.solved && self.iterations > self.max_iterations {
            self.error = Some(format!("SingleHighDensityRouteSolver ran out of iterations (MAX_ITERATIONS={})", self.max_iterations));
            self.failed = true;
        }
        self.progress = self.compute_progress(None, None);
    }

    pub fn step_inner(&mut self) {
        let mut current = self.candidates.dequeue_pending();
        while let Some(node) = &current {
            let key = self.get_node_key(node.node());
            if key == 0 || !self.explored_nodes.contains(&key) { break; }
            current = self.candidates.dequeue_pending();
        }
        let Some(node) = current else {
            self.failed = true;
            self.error = Some("Ran out of candidate nodes to explore".into());
            return;
        };
        let key = self.get_node_key(node.node());
        if key == 0 {
            self.failed = true;
            self.error = Some("Ran out of candidate nodes to explore".into());
            return;
        }
        let node = node.into_node();
        self.explored_nodes.insert(key);
        if self.debug_enabled {
            self.debug_explored_nodes_ordered.push((key, Point {
                x: js_round(node.x / self.cell_step) * self.cell_step + self.initial_node_grid_offset.x,
                y: js_round(node.y / self.cell_step) * self.cell_step + self.initial_node_grid_offset.y, z: node.z }));
        }
        let goal_dist = distance(&node_point(&node), &self.b);
        self.progress = self.compute_progress(Some(goal_dist), Some(node.z == self.b.z));
        let last = Node { x: self.b.x, y: self.b.y, z: node.z, g: node.g, h: node.h, f: node.f, parent: Some(node.clone()) };
        if goal_dist <= self.cell_step * std::f64::consts::SQRT_2 && node.z == self.b.z && !self.does_path_to_parent_intersect_obstacle(&last, None) {
            self.solved = true;
            self.set_solved_path(node.clone());
        }
        let mut neighbors = std::mem::take(&mut self.neighbor_scratch);
        self.fill_neighbors(node, &mut neighbors);
        for neighbor in neighbors.drain(..) { self.candidates.enqueue_owned(neighbor); }
        self.neighbor_scratch = neighbors;
    }

    pub fn visualize(&self) -> Value {
        let mut lines = vec![];
        let mut points = vec![];
        let mut rects = vec![];
        let mut circles = vec![];
        points.push(json!({"x":self.a.x,"y":self.a.y,"label":connection_label(&self.connection_name,self.root_connection_name.as_deref(),&["Input A".into(),format!("z: {}",self.a.z)]),"color":"orange"}));
        points.push(json!({"x":self.b.x,"y":self.b.y,"label":connection_label(&self.connection_name,self.root_connection_name.as_deref(),&["Input B".into(),format!("z: {}",self.b.z)]),"color":"orange"}));
        lines.push(json!({"points":[self.endpoint_a,self.endpoint_b],"strokeColor":"rgba(255, 0, 0, 0.5)","label":connection_label(&self.connection_name,self.root_connection_name.as_deref(),&["Direct Input Connection".into()])}));
        for (route_index, route) in self.obstacle_routes.iter().enumerate() {
            for pair in route.route.windows(2) {
                lines.push(json!({"points":[pair[0],pair[1]],"strokeColor":if pair[0].z==0.0 {"rgba(255, 0, 0, 0.75)"}else{"rgba(255, 128, 0, 0.25)"},"strokeWidth":route.trace_thickness,
                    "label":connection_label(&route.connection_name,route.root_connection_name.as_deref(),&["Obstacle Route".into()]),"layer":format!("obstacle{}",route_index)}));
            }
        }
        for (i, (key, point)) in self.debug_explored_nodes_ordered.iter().enumerate() {
            if self.debug_nodes_too_close_to_obstacle.contains(key) || self.debug_node_path_to_parent_intersects_obstacle.contains(key) { continue; }
            let alpha = 0.3 - i as f64 / self.debug_explored_nodes_ordered.len() as f64 * 0.2;
            rects.push(json!({"center":{"x":point.x+point.z*self.cell_step/20.0,"y":point.y+point.z*self.cell_step/20.0},
                "fill":if point.z==0.0 {format!("rgba(255,0,255,{})",alpha)}else{format!("rgba(0,0,255,{})",alpha)},
                "width":self.cell_step*0.9,"height":self.cell_step*0.9,"label":format!("Explored (z={})",point.z)}));
        }
        if let Some(node) = self.candidates.peek() {
            rects.push(json!({"center":{"x":node.x+node.z*self.cell_step/20.0,"y":node.y+node.z*self.cell_step/20.0},"fill":"rgba(0, 255, 0, 0.8)","width":self.cell_step*0.9,"height":self.cell_step*0.9,"label":format!("Next (z={})",node.z)}));
        }
        for route in &self.obstacle_routes {
            for via in &route.vias { circles.push(json!({"center":via,"radius":self.via_diameter/2.0,"fill":"rgba(255, 0, 0, 0.5)","label":"Via"})); }
        }
        if let Some(route) = &self.solved_path {
            lines.push(json!({"points":route.route,"strokeColor":"green","label":connection_label(&route.connection_name,route.root_connection_name.as_deref(),&["Solved Route".into()])}));
            for via in &route.vias { circles.push(json!({"center":via,"radius":self.via_diameter/2.0,"fill":"green","label":connection_label(&route.connection_name,route.root_connection_name.as_deref(),&["Via".into()])})); }
        }
        json!({"lines":lines,"points":points,"rects":rects,"circles":circles})
    }
}

pub fn node_point(node: &Node) -> Point {
    Point { x: node.x, y: node.y, z: node.z }
}

fn route_point(point: Point) -> RoutePoint {
    RoutePoint { x: point.x, y: point.y, z: point.z, ..Default::default() }
}

fn js_round(value: f64) -> f64 {
    let floor = value.floor();
    if value - floor < 0.5 { floor } else { floor + 1.0 }
}

fn clamp(value: f64, min: f64, max: f64) -> f64 {
    min.max(value.min(max))
}

fn connection_label(name: &str, root: Option<&str>, extra: &[String]) -> String {
    let mut lines = vec![];
    if !name.is_empty() { lines.push(name.to_owned()); }
    if let Some(root) = root.filter(|root| !root.is_empty()) { lines.push(format!("rootConnectionName: {}", root)); }
    lines.extend(extra.iter().filter(|line| !line.is_empty()).cloned());
    lines.join("\n")
}

fn get_segment_to_segment_centerline_distance(left_a: &Point, left_b: &Point, right_a: &Point, right_b: &Point) -> f64 {
    point_to_segment_distance(left_a, right_a, right_b)
        .min(point_to_segment_distance(left_b, right_a, right_b))
        .min(point_to_segment_distance(right_a, left_a, left_b))
        .min(point_to_segment_distance(right_b, left_a, left_b))
}

#[cfg(test)]
mod via_cache_tests {
    use super::*;

    #[test]
    fn dead_via_cache_entries_are_reclaimed_without_changing_live_path_identity() {
        let solver = SingleHighDensityRouteSolver::new(json!({
            "bounds":{"minX":-2.0,"minY":-2.0,"maxX":2.0,"maxY":2.0},
            "A":{"x":-1.0,"y":0.0,"z":0.0},"B":{"x":1.0,"y":0.0,"z":0.0},
            "obstacleRoutes":[],"connectionName":"a","minDistBetweenEnteringPoints":0.1
        }));
        let ancestor = Rc::new(Node {x:0.0,y:0.0,z:0.0,g:0.0,h:0.0,f:0.0,parent:None});
        let live = Rc::new(Node {x:0.0,y:0.0,z:1.0,g:0.0,h:0.0,f:0.0,parent:Some(ancestor.clone())});
        let ancestor_path = solver.get_vias_in_node_path(&ancestor);
        let live_path = solver.get_vias_in_node_path(&live);
        assert_eq!(live_path.len(),1);
        let dead = Rc::new(Node {x:1.0,y:0.0,z:1.0,g:0.0,h:0.0,f:0.0,parent:Some(ancestor.clone())});
        let dead_key = Rc::as_ptr(&dead) as usize;
        let dead_path = solver.get_vias_in_node_path(&dead);
        let dead_path_weak = Rc::downgrade(&dead_path);
        drop(dead_path);
        drop(dead);
        for index in 0..2100 {
            let transient = Rc::new(Node {x:index as f64,y:0.0,z:1.0,g:0.0,h:0.0,f:0.0,parent:Some(ancestor.clone())});
            solver.get_vias_in_node_path(&transient);
        }
        assert!(dead_path_weak.upgrade().is_none());
        // An allocator may reuse dead_key after reclamation, so inspect its weak
        // target rather than assuming the numeric address remains absent.
        if let Some((weak, _)) = solver.vias_in_path_by_node.borrow().get(&dead_key) {
            assert!(weak.upgrade().is_none());
        }
        assert!(solver.vias_in_path_by_node.borrow().len() < 1024);
        assert!(Rc::ptr_eq(&ancestor_path,&solver.get_vias_in_node_path(&ancestor)));
        assert!(Rc::ptr_eq(&live_path,&solver.get_vias_in_node_path(&live)));
    }
}
