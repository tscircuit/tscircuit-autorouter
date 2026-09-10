use std::cell::RefCell;

use serde_json::Value;

use crate::geometry::{distance, point_to_segment_distance};
use crate::single_high_density_route_solver::{node_point, SingleHighDensityRouteSolver};
use crate::single_route_candidate_priority_queue::Node;
use crate::types::Point;

pub struct SingleHighDensityRouteSolver6VertHorzLayerFutureCost {
    pub base: SingleHighDensityRouteSolver,
}

impl SingleHighDensityRouteSolver6VertHorzLayerFutureCost {
    pub fn new(opts: Value) -> Self {
        Self { base: SingleHighDensityRouteSolver::new_future_cost(opts) }
    }
}

impl std::ops::Deref for SingleHighDensityRouteSolver6VertHorzLayerFutureCost {
    type Target = SingleHighDensityRouteSolver;

    fn deref(&self) -> &Self::Target {
        &self.base
    }
}

impl std::ops::DerefMut for SingleHighDensityRouteSolver6VertHorzLayerFutureCost {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.base
    }
}

pub struct FutureConnectionSegment {
    pub connection_name: String,
    pub start: Point,
    pub end: Point,
}

pub struct FutureCost {
    pub future_connection_prox_trace_penalty_factor: f64,
    pub future_connection_prox_via_penalty_factor: f64,
    pub future_connection_proximity_vd: f64,
    pub misaligned_dist_penalty_factor: f64,
    pub via_penalty_factor_2: f64,
    pub flip_trace_alignment_direction: bool,
    pub future_connection_via_trace_clearance: f64,
    pub future_connection_points: Vec<Point>,
    pub future_connection_segments_cache: RefCell<Option<Vec<FutureConnectionSegment>>>,
}

impl SingleHighDensityRouteSolver {
    pub fn new_future_cost(mut opts: Value) -> Self {
        if opts.get("nearbySegmentClearance").is_none_or(Value::is_null) {
            opts["nearbySegmentClearance"] = Value::from(opts["traceThickness"].as_f64().unwrap_or(0.15) / 2.0
                + opts["obstacleMargin"].as_f64().unwrap_or(0.15));
        }
        let mut solver = Self::new(opts);
        let hp = &solver.hyper_parameters;
        let future_cost = FutureCost {
            future_connection_prox_trace_penalty_factor: hp["FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR"].as_f64().unwrap_or(2.0),
            future_connection_prox_via_penalty_factor: hp["FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR"].as_f64().unwrap_or(1.0),
            future_connection_proximity_vd: hp["FUTURE_CONNECTION_PROXIMITY_VD"].as_f64().unwrap_or(10.0),
            misaligned_dist_penalty_factor: hp["MISALIGNED_DIST_PENALTY_FACTOR"].as_f64().unwrap_or(5.0),
            via_penalty_factor_2: hp["VIA_PENALTY_FACTOR_2"].as_f64().unwrap_or(1.0),
            flip_trace_alignment_direction: hp["FLIP_TRACE_ALIGNMENT_DIRECTION"].as_bool().unwrap_or(false),
            future_connection_via_trace_clearance: hp["FUTURE_CONNECTION_VIA_TRACE_CLEARANCE"].as_f64().unwrap_or(0.1),
            future_connection_points: solver.future_connections.iter().flat_map(|connection| connection.points.iter().copied()).collect(),
            future_connection_segments_cache: RefCell::new(None),
        };
        if let Some(value) = hp["GREEDY_MULTIPLER"].as_f64() { solver.greedy_multiplier = value; }
        if let Some(value) = hp["NEARBY_SEGMENT_CLEARANCE"].as_f64() { solver.nearby_segment_clearance = value; }
        if let Some(value) = hp["VIA_PENALTY_FACTOR"].as_f64() { solver.via_penalty_factor = value; }
        if let Some(value) = hp["CELL_SIZE_FACTOR"].as_f64() { solver.cell_size_factor = value; }
        if let Some(value) = hp["MAX_ITERATIONS"].as_u64() { solver.max_iterations = value as usize; }
        if let Some(value) = hp["minCellSize"].as_f64() { solver.min_cell_size = value; }
        if let Some(value) = hp["cellStep"].as_f64() { solver.cell_step = value; }
        if let Some(value) = hp["viaDiameter"].as_f64() { solver.via_diameter = value; }
        if let Some(value) = hp["traceThickness"].as_f64() { solver.trace_thickness = value; }
        if let Some(value) = hp["obstacleMargin"].as_f64() { solver.obstacle_margin = value; }
        if let Some(value) = hp["straightLineDistance"].as_f64() { solver.straight_line_distance = value; }
        if let Some(value) = hp["numRoutes"].as_u64() { solver.num_routes = value as usize; }
        if let Some(value) = hp["gridMinXIndex"].as_f64() { solver.grid_min_x_index = value; }
        if let Some(value) = hp["gridMinYIndex"].as_f64() { solver.grid_min_y_index = value; }
        if let Some(value) = hp["gridWidth"].as_f64() { solver.grid_width = value; }
        if let Some(value) = hp["gridHeight"].as_f64() { solver.grid_height = value; }
        if let Some(value) = hp["debugEnabled"].as_bool() { solver.debug_enabled = value; }
        let vias_that_can_fit_horz = solver.bounds_size.x / solver.via_diameter;
        let route_count = solver.num_routes.max(1) as f64;
        solver.via_penalty_factor = 0.3 * (vias_that_can_fit_horz / route_count) * future_cost.via_penalty_factor_2;
        solver.future_cost = Some(future_cost);
        solver
    }

    pub fn get_closest_future_connection_point(&self, node: &Node) -> Option<Point> {
        let mut min_dist = f64::INFINITY;
        let mut closest_point = None;
        for point in &self.future_cost.as_ref().expect("future cost").future_connection_points {
            let dist = distance(&node_point(node), point) + if node.z != point.z { self.via_penalty_distance() } else { 0.0 };
            if dist < min_dist {
                min_dist = dist;
                closest_point = Some(*point);
            }
        }
        closest_point
    }

    pub fn get_future_connection_segments(&self) -> std::cell::Ref<'_, Vec<FutureConnectionSegment>> {
        let cache = &self.future_cost.as_ref().expect("future cost").future_connection_segments_cache;
        if cache.borrow().is_none() {
            let mut segments = vec![];
            for connection in &self.future_connections {
                let connected = connection.connection_name == self.connection_name || self.conn_map.as_ref()
                    .is_some_and(|map| map.are_ids_connected(&self.connection_name, &connection.connection_name));
                if connected { continue; }
                let Some((start, rest)) = connection.points.split_first() else { continue; };
                for end in rest {
                    if (start.x - end.x).abs() < 1e-9 && (start.y - end.y).abs() < 1e-9 { continue; }
                    segments.push(FutureConnectionSegment { connection_name: connection.connection_name.clone(), start: *start, end: *end });
                }
            }
            *cache.borrow_mut() = Some(segments);
        }
        std::cell::Ref::map(cache.borrow(), |cache| cache.as_ref().expect("populated future segments"))
    }

    pub fn is_via_too_close_to_future_connection_trace(&self, node: &Node) -> bool {
        let min_centerline_distance = self.via_diameter / 2.0 + self.trace_thickness / 2.0
            + self.future_cost.as_ref().expect("future cost").future_connection_via_trace_clearance;
        for segment in self.get_future_connection_segments().iter() {
            if point_to_segment_distance(&node_point(node), &segment.start, &segment.end) < min_centerline_distance { return true; }
        }
        false
    }

    pub fn diminish_close_to_goal(&self, node: &Node) -> f64 {
        let goal_dist = distance(&node_point(node), &self.b);
        1.0 - ((-goal_dist / self.straight_line_distance) * 5.0).exp()
    }

    pub fn get_future_connection_penalty(&self, node: &Node, is_via: bool) -> f64 {
        let mut future_connection_penalty = 0.0;
        let closest_future_point = self.get_closest_future_connection_point(node);
        let goal_dist = distance(&node_point(node), &self.b);
        if let Some(point) = closest_future_point {
            let dist_to_future_point = distance(&node_point(node), &point);
            if goal_dist <= dist_to_future_point { return 0.0; }
            let future_cost = self.future_cost.as_ref().expect("future cost");
            let max_dist = self.via_diameter * future_cost.future_connection_proximity_vd;
            let dist_ratio = dist_to_future_point / max_dist;
            let max_penalty = if is_via { self.straight_line_distance * future_cost.future_connection_prox_via_penalty_factor }
                else { self.straight_line_distance * future_cost.future_connection_prox_trace_penalty_factor };
            future_connection_penalty = max_penalty * (-dist_ratio * 5.0).exp();
        }
        future_connection_penalty
    }

    pub fn compute_h_future(&self, node: &Node) -> f64 {
        let goal_dist = distance(&node_point(node), &self.b).powf(1.6);
        let _goal_dist_ratio = goal_dist / self.straight_line_distance;
        let base_cost = goal_dist + if node.z != self.b.z { self.via_penalty_distance() } else { 0.0 };
        base_cost + self.get_future_connection_penalty(node, node.parent.as_ref().is_none_or(|parent| node.z != parent.z))
    }

    pub fn compute_g_future(&self, node: &Node) -> f64 {
        let parent = node.parent.as_ref().expect("cost node parent");
        let dx = (node.x - parent.x).abs();
        let dy = (node.y - parent.y).abs();
        let dist = (dx.powi(2) + dy.powi(2)).sqrt();
        let is_even_layer = node.z % 2.0 == 0.0;
        let future_cost = self.future_cost.as_ref().expect("future cost");
        let misaligned_dist = if !future_cost.flip_trace_alignment_direction {
            if is_even_layer { dy } else { dx }
        } else if is_even_layer { dx } else { dy };
        let base_cost = parent.g + if node.z == parent.z { 0.0 } else { self.via_penalty_distance() }
            + dist + misaligned_dist * future_cost.misaligned_dist_penalty_factor;
        base_cost + self.get_future_connection_penalty(node, node.z != parent.z)
    }

    pub fn set_node_costs_future(&self, node: &mut Node) {
        let parent = node.parent.as_ref().expect("cost node parent");
        let dx = (node.x - parent.x).abs();
        let dy = (node.y - parent.y).abs();
        let dist = (dx.powi(2) + dy.powi(2)).sqrt();
        let is_even_layer = node.z % 2.0 == 0.0;
        let future_cost = self.future_cost.as_ref().expect("future cost");
        let misaligned_dist = if !future_cost.flip_trace_alignment_direction {
            if is_even_layer { dy } else { dx }
        } else if is_even_layer { dx } else { dy };
        let base_g = parent.g + if node.z == parent.z { 0.0 } else { self.via_penalty_distance() }
            + dist + misaligned_dist * future_cost.misaligned_dist_penalty_factor;
        let goal_dist = distance(&node_point(node), &self.b).powf(1.6);
        let base_h = goal_dist + if node.z != self.b.z { self.via_penalty_distance() } else { 0.0 };
        let future_connection_penalty = self.get_future_connection_penalty(node, node.z != parent.z);
        node.g = base_g + future_connection_penalty;
        node.h = base_h + future_connection_penalty;
        node.f = self.compute_f(node.g, node.h);
    }
}
