use std::collections::HashSet;
use std::rc::Rc;

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::data_structures::high_density_route_spatial_index::HighDensityRouteSpatialIndex;
use crate::data_structures::single_route_candidate_priority_queue::Node;
use crate::solvers::high_density_solver::connectivity_map::ConnectivityMap;
use crate::solvers::high_density_solver::single_high_density_route_solver::{
    SingleHighDensityRouteSolver, SingleRouteSolverOptions,
};
use crate::types::high_density_types::{FutureConnection, Point, Route, RoutePoint};
use crate::utils::clone_and_shuffle_array::clone_and_shuffle_array;
use crate::utils::get_bounds_from_node_with_port_points::get_bounds_from_node_with_port_points;
use crate::utils::get_min_dist_between_entering_points::get_min_dist_between_entering_points;
use crate::utils::js_number::{js_number_to_string, js_to_fixed};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnsolvedConnection {
    pub connection_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root_connection_name: Option<String>,
    pub points: Vec<Point>,
}

fn connection_label(
    connection_name: &str,
    root_connection_name: Option<&str>,
    extra_lines: &[String],
) -> String {
    let mut lines = vec![connection_name.to_owned()];
    if let Some(root) = root_connection_name.filter(|root| !root.is_empty()) {
        lines.push(format!("rootConnectionName: {root}"));
    }
    lines.extend(extra_lines.iter().filter(|line| !line.is_empty()).cloned());
    lines.retain(|line| !line.is_empty());
    lines.join("\n")
}

fn dedupe_connection_points(points: &[Point]) -> Vec<Point> {
    let mut seen = HashSet::new();
    let mut deduped = Vec::new();
    for point in points {
        let key = format!(
            "{},{},{}",
            js_to_fixed(point.x, 6),
            js_to_fixed(point.y, 6),
            js_number_to_string(point.z)
        );
        if seen.insert(key) {
            deduped.push(*point);
        }
    }
    deduped
}

pub struct IntraNodeRouteSolver {
    pub observed_child_ids: HashSet<usize>,
    pub retired_children: Vec<SingleHighDensityRouteSolver>,
    next_child_id: usize,
    pub pow: fn(f64, f64) -> f64,
    pub exp: fn(f64) -> f64,
    pub node_with_port_points: Value,
    pub color_map: IndexMap<String, String>,
    pub unsolved_connections: Vec<UnsolvedConnection>,
    pub original_connection_points_by_name: IndexMap<String, Vec<Point>>,
    pub root_connection_name_by_connection_name: IndexMap<String, String>,
    pub total_connections: usize,
    pub solved_routes: Vec<Route>,
    pub failed_sub_solvers: Vec<SingleHighDensityRouteSolver>,
    pub hyper_parameters: Value,
    pub min_dist_between_entering_points: f64,
    pub via_diameter: f64,
    pub trace_width: f64,
    pub obstacle_margin: f64,
    pub capture_search_debug: bool,
    pub reroute_attempts_by_connection: IndexMap<String, usize>,
    pub postroute_via_trace_clearance: f64,
    pub max_postroute_repair_attempts: usize,
    pub active_sub_solver: Option<SingleHighDensityRouteSolver>,
    pub conn_map: Option<ConnectivityMap>,
    pub solved: bool,
    pub failed: bool,
    pub iterations: usize,
    pub max_iterations: f64,
    pub progress: f64,
    pub error: Option<String>,
    pub stats: Value,
}

impl IntraNodeRouteSolver {
    pub fn new(mut params: Value) -> Self {
        let node_with_port_points = params
            .get_mut("nodeWithPortPoints")
            .map(Value::take)
            .unwrap_or(Value::Null);
        let color_map = params
            .get_mut("colorMap")
            .filter(|v| !v.is_null())
            .map(|v| serde_json::from_value(v.take()).expect("invalid colorMap"))
            .unwrap_or_default();
        let hyper_parameters = params
            .get_mut("hyperParameters")
            .filter(|v| !v.is_null())
            .map(Value::take)
            .unwrap_or_else(|| json!({}));
        let mut unsolved_connections_map: IndexMap<String, Vec<Point>> = IndexMap::new();
        let mut root_connection_name_by_connection_name = IndexMap::new();
        for point in node_with_port_points["portPoints"]
            .as_array()
            .expect("portPoints must be an array")
        {
            let connection_name = point["connectionName"]
                .as_str()
                .expect("connectionName required")
                .to_owned();
            if let Some(root) = point["rootConnectionName"]
                .as_str()
                .filter(|root| !root.is_empty())
            {
                root_connection_name_by_connection_name
                    .insert(connection_name.clone(), root.to_owned());
            }
            unsolved_connections_map
                .entry(connection_name)
                .or_default()
                .push(Point {
                    x: point["x"].as_f64().expect("point x required"),
                    y: point["y"].as_f64().expect("point y required"),
                    z: point["z"].as_f64().unwrap_or(0.0),
                });
        }
        let original_connection_points_by_name = unsolved_connections_map
            .iter()
            .map(|(name, points)| (name.clone(), dedupe_connection_points(points)))
            .collect();
        let mut unsolved_connections: Vec<UnsolvedConnection> = unsolved_connections_map
            .into_iter()
            .map(|(connection_name, points)| UnsolvedConnection {
                root_connection_name: root_connection_name_by_connection_name
                    .get(&connection_name)
                    .cloned(),
                connection_name,
                points: dedupe_connection_points(&points),
            })
            .collect();
        let seed = hyper_parameters["SHUFFLE_SEED"].as_f64().unwrap_or(0.0);
        if seed != 0.0 && !seed.is_nan() {
            unsolved_connections = clone_and_shuffle_array(&unsolved_connections, seed);
            for (i, connection) in unsolved_connections.iter_mut().enumerate() {
                connection.points =
                    clone_and_shuffle_array(&connection.points, i as f64 * 7117.0 + seed);
            }
        }
        let total_connections = unsolved_connections.len();
        let min_dist_between_entering_points =
            get_min_dist_between_entering_points(&node_with_port_points);
        let conn_map = params
            .get_mut("connMap")
            .filter(|value| !value.is_null())
            .map(|value| serde_json::from_value(value.take()).expect("invalid connMap snapshot"));
        Self {
            observed_child_ids: HashSet::new(),
            retired_children: Vec::new(),
            next_child_id: 1,
            pow: f64::powf,
            exp: f64::exp,
            node_with_port_points,
            color_map,
            unsolved_connections,
            original_connection_points_by_name,
            root_connection_name_by_connection_name,
            total_connections,
            solved_routes: Vec::new(),
            failed_sub_solvers: Vec::new(),
            hyper_parameters,
            min_dist_between_entering_points,
            via_diameter: params["viaDiameter"].as_f64().unwrap_or(0.3),
            trace_width: params["traceWidth"].as_f64().unwrap_or(0.15),
            obstacle_margin: params["obstacleMargin"].as_f64().unwrap_or(0.15),
            capture_search_debug: params["captureSearchDebug"].as_bool().unwrap_or(true),
            reroute_attempts_by_connection: IndexMap::new(),
            postroute_via_trace_clearance: 0.1,
            max_postroute_repair_attempts: 2,
            active_sub_solver: None,
            conn_map,
            solved: false,
            failed: false,
            iterations: 0,
            max_iterations: 1000.0 * (total_connections as f64).powf(1.5),
            progress: 0.0,
            error: None,
            stats: json!({}),
        }
    }

    pub fn compute_progress(&self) -> f64 {
        let active_progress = self
            .active_sub_solver
            .as_ref()
            .map(|solver| solver.progress)
            .unwrap_or(0.0);
        let active_progress = if active_progress.is_nan() {
            0.0
        } else {
            active_progress
        };
        (self.solved_routes.len() as f64 + active_progress) / self.total_connections as f64
    }

    fn get_single_route_solver_opts(
        &self,
        connection: &UnsolvedConnection,
    ) -> SingleRouteSolverOptions {
        let points = &connection.points;
        let obstacle_routes: Vec<Route> = self
            .solved_routes
            .iter()
            .filter(|route| {
                !self
                    .conn_map
                    .as_ref()
                    .map(|map| {
                        map.are_ids_connected(&route.connection_name, &connection.connection_name)
                    })
                    .unwrap_or(false)
            })
            .map(|route| {
                let mut obstacle = route.clone();
                // The former JSON boundary omitted this serialization-only marker.
                obstacle.simple_path = false;
                obstacle
            })
            .collect();
        let port_points = self.node_with_port_points["portPoints"]
            .as_array()
            .expect("portPoints must be an array");
        let layer_count = port_points.iter().fold(2.0_f64, |max, point| {
            max.max(point["z"].as_f64().unwrap_or(0.0) + 1.0)
        });
        let available_z: Vec<f64> = match self.node_with_port_points["availableZ"]
            .as_array()
            .filter(|layers| !layers.is_empty())
        {
            Some(layers) => layers
                .iter()
                .map(|z| z.as_f64().expect("layer must be numeric"))
                .collect(),
            None => self.get_available_z_layers(),
        };
        let a = points.first().expect("connection requires first point");
        let b = points.last().expect("connection requires last point");
        SingleRouteSolverOptions {
            connection_name: connection.connection_name.clone(),
            root_connection_name: connection.root_connection_name.clone(),
            region_id: self.node_with_port_points["capacityMeshNodeId"]
                .as_str()
                .map(str::to_owned),
            min_dist_between_entering_points: self.min_dist_between_entering_points,
            bounds: get_bounds_from_node_with_port_points(&self.node_with_port_points),
            endpoint_a: RoutePoint {
                x: a.x,
                y: a.y,
                z: a.z,
                ..Default::default()
            },
            endpoint_b: RoutePoint {
                x: b.x,
                y: b.y,
                z: b.z,
                ..Default::default()
            },
            obstacle_routes,
            future_connections: self
                .unsolved_connections
                .iter()
                .map(|connection| FutureConnection {
                    connection_name: connection.connection_name.clone(),
                    root_connection_name: connection.root_connection_name.clone(),
                    region_id: None,
                    points: connection.points.clone(),
                })
                .collect(),
            layer_count: layer_count as usize,
            available_z,
            hyper_parameters: self.hyper_parameters.clone(),
            conn_map: self.conn_map.clone(),
            via_diameter: self.via_diameter,
            trace_thickness: self.trace_width,
            obstacle_margin: self.obstacle_margin,
            nearby_segment_clearance: None,
            capture_search_debug: self.capture_search_debug,
        }
    }

    fn try_solve_same_point_layer_change(&mut self, connection: &UnsolvedConnection) -> bool {
        let opts = self.get_single_route_solver_opts(connection);
        let mut checker = SingleHighDensityRouteSolver::new_future_cost_typed(opts);
        checker.pow = self.pow;
        checker.exp = self.exp;
        let a = connection
            .points
            .first()
            .expect("connection requires first point");
        let b = connection
            .points
            .last()
            .expect("connection requires last point");
        if !is_endpoint_via_safe(&checker, a, b) {
            return false;
        }
        let points = [
            *a,
            Point {
                x: a.x,
                y: a.y,
                z: a.z,
            },
            Point {
                x: a.x,
                y: a.y,
                z: b.z,
            },
            *b,
        ];
        let route: Vec<Point> = points
            .iter()
            .enumerate()
            .filter(|(i, point)| {
                *i == 0
                    || (point.x - points[*i - 1].x).abs() > 1e-6
                    || (point.y - points[*i - 1].y).abs() > 1e-6
                    || point.z != points[*i - 1].z
            })
            .map(|(_, point)| *point)
            .collect();
        let mut output = json!({
            "connectionName": connection.connection_name,
            "regionId": self.node_with_port_points["capacityMeshNodeId"],
            "traceThickness": self.trace_width,
            "viaDiameter": self.via_diameter,
            "route": route,
            "vias": [{"x": a.x, "y": a.y}],
        });
        if let Some(root) = &connection.root_connection_name {
            output["rootConnectionName"] = json!(root);
        }
        self.solved_routes
            .push(serde_json::from_value(output).expect("invalid generated route"));
        true
    }

    fn queue_extra_branches_for_multi_point_connection(
        &mut self,
        connection: &UnsolvedConnection,
    ) -> bool {
        let points = dedupe_connection_points(&connection.points);
        if points.len() <= 2 {
            return false;
        }
        let origin = points[0];
        for point in points.into_iter().skip(1) {
            self.unsolved_connections.push(UnsolvedConnection {
                connection_name: connection.connection_name.clone(),
                root_connection_name: connection.root_connection_name.clone(),
                points: vec![origin, point],
            });
        }
        true
    }

    fn get_available_z_layers(&self) -> Vec<f64> {
        let mut layers = match self.node_with_port_points["availableZ"]
            .as_array()
            .filter(|layers| !layers.is_empty())
        {
            Some(layers) => layers
                .iter()
                .map(|z| z.as_f64().expect("layer must be numeric"))
                .collect::<Vec<_>>(),
            None => self.node_with_port_points["portPoints"]
                .as_array()
                .expect("portPoints must be an array")
                .iter()
                .map(|point| point["z"].as_f64().unwrap_or(0.0))
                .collect(),
        };
        layers.sort_by(|a, b| a.partial_cmp(b).expect("layer must be ordered"));
        layers.dedup();
        layers
    }

    fn get_first_solved_via_trace_conflict(&self) -> Option<(String, f64, f64, String)> {
        if self.solved_routes.len() < 2 {
            return None;
        }
        let spatial_index = HighDensityRouteSpatialIndex::new(self.solved_routes.clone(), 1.0);
        let available_z = self.get_available_z_layers();
        for route in &self.solved_routes {
            let margin = route.via_diameter / 2.0 + self.postroute_via_trace_clearance;
            for via in &route.vias {
                for z in &available_z {
                    let conflicts = spatial_index.get_conflicting_routes_near_point(
                        &Point {
                            x: via.x,
                            y: via.y,
                            z: *z,
                        },
                        margin,
                    );
                    for conflict in conflicts {
                        if conflict.conflicting_route.connection_name == route.connection_name {
                            continue;
                        }
                        if self
                            .conn_map
                            .as_ref()
                            .map(|map| {
                                map.are_ids_connected(
                                    &route.connection_name,
                                    &conflict.conflicting_route.connection_name,
                                )
                            })
                            .unwrap_or(false)
                        {
                            continue;
                        }
                        return Some((
                            route.connection_name.clone(),
                            via.x,
                            via.y,
                            conflict.conflicting_route.connection_name.clone(),
                        ));
                    }
                }
            }
        }
        None
    }

    fn queue_connection_for_postroute_repair(&mut self, connection_name: &str) -> bool {
        let Some(points) = self.original_connection_points_by_name.get(connection_name) else {
            return false;
        };
        if points.len() < 2 {
            return false;
        }
        self.solved_routes
            .retain(|route| route.connection_name != connection_name);
        self.unsolved_connections.push(UnsolvedConnection {
            connection_name: connection_name.to_owned(),
            root_connection_name: self
                .root_connection_name_by_connection_name
                .get(connection_name)
                .cloned(),
            points: points.clone(),
        });
        *self
            .reroute_attempts_by_connection
            .entry(connection_name.to_owned())
            .or_insert(0) += 1;
        true
    }

    pub fn step(&mut self) {
        if self.solved || self.failed {
            return;
        }
        self.iterations += 1;
        self.step_inner();
        if !self.solved && self.iterations as f64 > self.max_iterations {
            self.error = Some(format!(
                "IntraNodeRouteSolver ran out of iterations (MAX_ITERATIONS={})",
                js_number_to_string(self.max_iterations)
            ));
            self.failed = true;
        }
        self.progress = self.compute_progress();
    }

    pub fn step_inner(&mut self) {
        if let Some(solver) = self.active_sub_solver.as_mut() {
            solver.step();
            self.progress = self.compute_progress();
            let solver = self
                .active_sub_solver
                .as_ref()
                .expect("active solver disappeared");
            if solver.solved {
                self.solved_routes.push(
                    solver
                        .solved_path
                        .clone()
                        .expect("solved search requires path"),
                );
                let child = self
                    .active_sub_solver
                    .take()
                    .expect("solved child disappeared");
                if self.observed_child_ids.contains(&child.diagnostic_id) {
                    self.retired_children.push(child);
                }
            } else if solver.failed {
                self.failed_sub_solvers.push(
                    self.active_sub_solver
                        .take()
                        .expect("failed active solver disappeared"),
                );
                self.error = Some(
                    self.failed_sub_solvers
                        .iter()
                        .map(|solver| solver.error.as_deref().unwrap_or(""))
                        .collect::<Vec<_>>()
                        .join("\n"),
                );
                self.failed = true;
            }
            return;
        }
        let unsolved_connection = self.unsolved_connections.pop();
        self.progress = self.compute_progress();
        let Some(connection) = unsolved_connection else {
            if let Some((route_name, via_x, via_y, conflict_name)) =
                self.get_first_solved_via_trace_conflict()
            {
                let attempts = self
                    .reroute_attempts_by_connection
                    .get(&route_name)
                    .copied()
                    .unwrap_or(0);
                if attempts >= self.max_postroute_repair_attempts {
                    self.error = Some(format!(
                        "Post-route via/trace clearance repair exceeded retry budget\nroute: {route_name}\nconflicts with: {conflict_name}\nvia: ({}, {})",
                        js_to_fixed(via_x, 3),
                        js_to_fixed(via_y, 3)
                    ));
                    self.failed = true;
                    return;
                }
                if self.queue_connection_for_postroute_repair(&route_name) {
                    self.progress = self.compute_progress();
                    return;
                }
            }
            self.solved = self.failed_sub_solvers.is_empty();
            return;
        };
        if connection.points.len() == 1 {
            return;
        }
        if connection.points.len() > 2
            && self.queue_extra_branches_for_multi_point_connection(&connection)
        {
            return;
        }
        if connection.points.len() == 2 {
            let a = connection.points[0];
            let b = connection.points[1];
            let same_x = (a.x - b.x).abs() < 1e-6;
            let same_y = (a.y - b.y).abs() < 1e-6;
            if same_x && same_y && a.z == b.z {
                return;
            }
            if same_x && same_y && a.z != b.z && self.try_solve_same_point_layer_change(&connection)
            {
                return;
            }
        }
        let mut child = SingleHighDensityRouteSolver::new_future_cost_typed(
            self.get_single_route_solver_opts(&connection),
        );
        child.diagnostic_id = self.next_child_id;
        self.next_child_id += 1;
        child.pow = self.pow;
        child.exp = self.exp;
        self.active_sub_solver = Some(child);
    }

    pub fn visualize_with_transparentize(
        &self,
        transparentize: &dyn Fn(&str, f64) -> String,
    ) -> Value {
        let mut graphics = json!({"lines": [], "points": [], "rects": [], "circles": []});
        for point in self.node_with_port_points["portPoints"]
            .as_array()
            .expect("portPoints must be an array")
        {
            let name = point["connectionName"]
                .as_str()
                .expect("connectionName required");
            let layer = point["z"]
                .as_f64()
                .map(js_number_to_string)
                .unwrap_or_else(|| "undefined".to_owned());
            graphics["points"].as_array_mut().unwrap().push(json!({
                "x": point["x"], "y": point["y"],
                "label": connection_label(name, point["rootConnectionName"].as_str(), &[format!("layer: {layer}")]),
                "color": self.color_map.get(name).map(String::as_str).unwrap_or("blue"),
            }));
        }
        for (route_index, route) in self.solved_routes.iter().enumerate() {
            if route.route.is_empty() {
                continue;
            }
            let color = self
                .color_map
                .get(&route.connection_name)
                .map(String::as_str)
                .unwrap_or("blue");
            let root = route.root_connection_name.as_deref().or_else(|| {
                self.root_connection_name_by_connection_name
                    .get(&route.connection_name)
                    .map(String::as_str)
            });
            for segment in route.route.windows(2) {
                let p1 = &segment[0];
                graphics["lines"].as_array_mut().unwrap().push(json!({
                    "points": segment,
                    "label": connection_label(&route.connection_name, root, &[format!("layer: {}", js_number_to_string(p1.z))]),
                    "strokeColor": transparentize(color, if p1.z == 0.0 { 0.2 } else { 0.8 }),
                    "layer": format!("route-layer-{}", js_number_to_string(p1.z)),
                    "step": route_index, "strokeWidth": route.trace_thickness,
                }));
            }
            for via in &route.vias {
                graphics["circles"].as_array_mut().unwrap().push(json!({
                    "center": {"x": via.x, "y": via.y}, "radius": route.via_diameter / 2.0,
                    "fill": transparentize(color, 0.5), "layer": "via", "step": route_index,
                    "label": connection_label(&route.connection_name, root, &["via".to_owned()]),
                }));
            }
        }
        let bounds = get_bounds_from_node_with_port_points(&self.node_with_port_points);
        graphics["lines"].as_array_mut().unwrap().push(json!({
            "points": [
                {"x": bounds.min_x, "y": bounds.min_y}, {"x": bounds.max_x, "y": bounds.min_y},
                {"x": bounds.max_x, "y": bounds.max_y}, {"x": bounds.min_x, "y": bounds.max_y},
                {"x": bounds.min_x, "y": bounds.min_y},
            ],
            "strokeColor": "rgba(255, 0, 0, 0.25)", "strokeDash": "4 4", "layer": "border",
        }));
        graphics
    }
}

fn is_endpoint_via_safe(checker: &SingleHighDensityRouteSolver, a: &Point, _b: &Point) -> bool {
    let via_node = Node {
        x: a.x,
        y: a.y,
        z: a.z,
        g: 0.0,
        h: 0.0,
        f: 0.0,
        parent: Some(Rc::new(Node {
            x: a.x,
            y: a.y,
            z: a.z,
            g: 0.0,
            h: 0.0,
            f: 0.0,
            parent: None,
        })),
    };
    if checker.is_node_too_close_to_obstacle(
        &via_node,
        Some(checker.via_diameter / 2.0 + checker.obstacle_margin / 2.0),
        true,
        None,
    ) {
        return false;
    }
    if checker.is_node_too_close_to_edge(&via_node, true) {
        return false;
    }
    true
}
