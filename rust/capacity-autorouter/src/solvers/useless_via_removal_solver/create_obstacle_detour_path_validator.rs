use std::collections::HashMap;
use std::rc::Rc;
use crate::bindings::trace_simplification::types::{ConnectivityMap, Point, PointRef, RouteRef};
use crate::bindings::trace_simplification::high_density_route_spatial_index::HighDensityRouteSpatialIndex;
use crate::data_structures::obstacle_tree::ObstacleSpatialHashIndex;
use crate::bindings::trace_simplification::math_utils::segment_to_box_min_distance;
use crate::bindings::trace_simplification::types::Point2;
use crate::utils::js_number::js_number_to_string;

#[derive(Hash, Eq, PartialEq)]
enum SegmentKey { Text(String), Number(u64) }

pub struct ObstacleDetourPathValidator<'a> {
    target_z: f64,
    connection_name: String,
    root_connection_name: Option<String>,
    thickness: f64,
    default_thickness: f64,
    trace_margin: f64,
    route_search_margin: f64,
    obstacle_search_margin: f64,
    hd_routes: &'a HighDensityRouteSpatialIndex,
    obstacles: &'a ObstacleSpatialHashIndex,
    conn_map: &'a ConnectivityMap,
    use_numeric_keys: bool,
    point_ids: HashMap<(u64, u64), usize>,
    next_point_id: usize,
    segment_clearance_cache: HashMap<SegmentKey, bool>,
    obstacle_same_net_cache: HashMap<usize, bool>,
    route_same_net_cache: HashMap<usize, bool>,
}

pub fn create_obstacle_detour_path_validator<'a>(
    target_z: f64, route: &RouteRef, hd_routes: &'a HighDensityRouteSpatialIndex,
    obstacles: &'a ObstacleSpatialHashIndex, conn_map: &'a ConnectivityMap,
    default_thickness: f64, obstacle_margin: f64, trace_margin: f64, use_numeric_keys: bool,
) -> ObstacleDetourPathValidator<'a> {
    let route = route.borrow();
    let thickness = if route.metadata.get("traceThickness").is_none_or(|value| value.is_null()) { default_thickness } else { route.trace_thickness };
    ObstacleDetourPathValidator {
        target_z, connection_name: route.connection_name.clone(), root_connection_name: route.root_connection_name.clone(),
        thickness, default_thickness, trace_margin,
        route_search_margin: thickness / 2.0 + trace_margin,
        obstacle_search_margin: thickness / 2.0 + obstacle_margin,
        hd_routes, obstacles, conn_map, use_numeric_keys,
        point_ids: HashMap::new(), next_point_id: 0, segment_clearance_cache: HashMap::new(),
        obstacle_same_net_cache: HashMap::new(), route_same_net_cache: HashMap::new(),
    }
}

impl ObstacleDetourPathValidator<'_> {
    fn get_point_id(&mut self, point: &Point) -> usize {
        let key = (
            if point.x == 0.0 { 0 } else if point.x.is_nan() { f64::NAN.to_bits() } else { point.x.to_bits() },
            if point.y == 0.0 { 0 } else if point.y.is_nan() { f64::NAN.to_bits() } else { point.y.to_bits() },
        );
        if let Some(id) = self.point_ids.get(&key) { return *id; }
        let id = self.next_point_id;
        self.next_point_id += 1;
        self.point_ids.insert(key, id);
        id
    }

    fn get_segment_clearance_cache_key(&mut self, start: &Point, end: &Point) -> SegmentKey {
        if self.use_numeric_keys {
            let start_id = self.get_point_id(start) as f64;
            let end_id = self.get_point_id(end) as f64;
            let high = start_id.max(end_id);
            let low = start_id.min(end_id);
            return SegmentKey::Number(((high * (high + 1.0)) / 2.0 + low).to_bits());
        }
        let start_first = start.x < end.x || (start.x == end.x && start.y <= end.y);
        let (a, b) = if start_first { (start, end) } else { (end, start) };
        SegmentKey::Text(format!("{}:{}|{}:{}", js_number_to_string(a.x), js_number_to_string(a.y), js_number_to_string(b.x), js_number_to_string(b.y)))
    }

    fn is_connected_to_route(&self, id: &str) -> bool {
        id == self.connection_name || self.conn_map.are_ids_connected(id, &self.connection_name)
            || self.root_connection_name.as_ref().is_some_and(|root| {
                id == root || self.conn_map.are_ids_connected(id, root)
            })
    }

    pub fn validate(&mut self, path: &[PointRef], first_segment_index: usize) -> Result<bool, String> {
        let count = path.len().saturating_sub(1);
        for order_index in 0..count {
            let index = if first_segment_index == 0 { order_index }
                else if order_index == 0 { first_segment_index }
                else if order_index - 1 >= first_segment_index { order_index }
                else { order_index - 1 };
            let start = path[index].borrow();
            let end = path[index + 1].borrow();
            let a = Point { x: start.x, y: start.y, z: self.target_z };
            let b = Point { x: end.x, y: end.y, z: self.target_z };
            let key = self.get_segment_clearance_cache_key(&a, &b);
            if let Some(clear) = self.segment_clearance_cache.get(&key) {
                if !clear { return Ok(false); }
                continue;
            }
            for obstacle in self.obstacles.search_area((a.x + b.x) / 2.0, (a.y + b.y) / 2.0,
                (a.x - b.x).abs() + self.obstacle_search_margin * 2.0,
                (a.y - b.y).abs() + self.obstacle_search_margin * 2.0)? {
                let identity = Rc::as_ptr(&obstacle) as usize;
                let obstacle = obstacle.borrow();
                let same = if let Some(same) = self.obstacle_same_net_cache.get(&identity) { *same } else {
                    let same = obstacle.connected_to.iter().any(|id| self.is_connected_to_route(id));
                    self.obstacle_same_net_cache.insert(identity, same);
                    same
                };
                if same { continue; }
                if obstacle.z_layers.contains(&self.target_z) {
                    if ((a.x - obstacle.center.x).abs() < 0.01 && (a.y - obstacle.center.y).abs() < 0.01)
                        || ((b.x - obstacle.center.x).abs() < 0.01 && (b.y - obstacle.center.y).abs() < 0.01) { continue; }
                }
                if segment_to_box_min_distance(Point2 { x: a.x, y: a.y }, Point2 { x: b.x, y: b.y }, obstacle.center, obstacle.width, obstacle.height) < self.obstacle_search_margin {
                    self.segment_clearance_cache.insert(key, false);
                    return Ok(false);
                }
            }
            for conflict in self.hd_routes.get_conflicting_routes_for_segment(&a, &b, self.route_search_margin) {
                let identity = Rc::as_ptr(&conflict.conflicting_route) as usize;
                let route = conflict.conflicting_route.borrow();
                let same = if let Some(same) = self.route_same_net_cache.get(&identity) { *same } else {
                    let same = self.is_connected_to_route(&route.connection_name)
                        || route.root_connection_name.as_deref().is_some_and(|id| self.is_connected_to_route(id));
                    self.route_same_net_cache.insert(identity, same);
                    same
                };
                if same { continue; }
                let other_thickness = if route.metadata.get("traceThickness").is_none_or(|value| value.is_null()) { self.default_thickness } else { route.trace_thickness };
                let radius = crate::bindings::trace_simplification::math_utils::max(other_thickness / 2.0, route.via_diameter / 2.0);
                if conflict.distance < self.thickness / 2.0 + radius + self.trace_margin {
                    self.segment_clearance_cache.insert(key, false);
                    return Ok(false);
                }
            }
            self.segment_clearance_cache.insert(key, true);
        }
        Ok(true)
    }
}
