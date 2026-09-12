use serde_json::Value;
use crate::clearance_math::*;
use crate::internal_types::{Bounds2D as Bounds, MutableRoute, Point};
use crate::net_utils::{get_root_connection_name, shares_interned_resolved_net, RepairConnectivityMap, InternedResolvedNetId, ResolvedNetInterner};
use crate::solver_config::{get_via_edge_to_pad_edge_clearance, POSITION_EPSILON};
use crate::solver_helpers::RepairMath;
use autorouting_drc::math_utils::{get_bounds_from_points, get_segment_intersection, point_to_segment_closest_point};
use autorouting_drc::transformation_matrix::{apply_to_point, apply_to_points, compose, inverse, Matrix, rotate_deg_with_math, translate};

#[derive(Clone, Debug)]
pub enum Boundary {
    Line { start: Point, end: Point, bounds: Bounds },
    Circle { center: Point, radius: f64, bounds: Bounds },
}

impl Boundary {
    pub fn bounds(&self) -> &Bounds {
        match self { Self::Line { bounds, .. } | Self::Circle { bounds, .. } => bounds }
    }
}

struct PadRegion {
    center: Point,
    half_width: f64,
    half_height: f64,
    local_to_world: Matrix,
    world_to_local: Matrix,
    circular: bool,
    clearance: f64,
    bounds: Bounds,
}

fn project_to_bounds(point: &Point, bounds: &Bounds) -> Point {
    Point { x: clamp(point.x, bounds.min_x, bounds.max_x), y: clamp(point.y, bounds.min_y, bounds.max_y) }
}

fn distance_to_pad(point: &Point, pad: &PadRegion, math: &RepairMath) -> f64 {
    let dx = point.x - pad.center.x;
    let dy = point.y - pad.center.y;
    if pad.circular { return js_max(0.0, (math.hypot)(dx, dy) - pad.half_width); }
    point_to_bounds_distance(&apply_to_point(&pad.world_to_local, point), &Bounds {
        min_x: -pad.half_width, max_x: pad.half_width,
        min_y: -pad.half_height, max_y: pad.half_height,
    })
}

pub fn create_line(start: Point, end: Point) -> Boundary {
    Boundary::Line { start, end, bounds: get_bounds_from_points(&[start, end]).expect("Two points have bounds") }
}

pub fn create_circle(center: Point, radius: f64) -> Boundary {
    Boundary::Circle { center, radius, bounds: get_bound_from_centered_rect(&center, radius * 2.0, radius * 2.0) }
}

fn get_pad_boundaries(pad: &PadRegion) -> Vec<Boundary> {
    let margin = pad.clearance + POSITION_EPSILON;
    if pad.circular { return vec![create_circle(pad.center, pad.half_width + margin)]; }
    let world = |x: f64, y: f64| apply_to_point(&pad.local_to_world, &Point { x, y });
    let w = pad.half_width;
    let h = pad.half_height;
    vec![
        create_line(world(-w, -h - margin), world(w, -h - margin)),
        create_line(world(w + margin, -h), world(w + margin, h)),
        create_line(world(w, h + margin), world(-w, h + margin)),
        create_line(world(-w - margin, h), world(-w - margin, -h)),
        create_circle(world(-w, -h), margin),
        create_circle(world(w, -h), margin),
        create_circle(world(w, h), margin),
        create_circle(world(-w, h), margin),
    ]
}

pub fn boundary_projections(point: &Point, boundary: &Boundary, math: &RepairMath) -> Vec<Point> {
    match boundary {
        Boundary::Circle { center, radius, .. } => {
            let dx = point.x - center.x;
            let dy = point.y - center.y;
            let length = (math.hypot)(dx, dy);
            if length == 0.0 {
                return vec![Point { x: center.x + radius, y: center.y }, Point { x: center.x - radius, y: center.y },
                    Point { x: center.x, y: center.y + radius }, Point { x: center.x, y: center.y - radius }];
            }
            vec![Point { x: center.x + (dx * radius) / length, y: center.y + (dy * radius) / length }]
        }
        Boundary::Line { start, end, .. } => vec![*start, *end, point_to_segment_closest_point(point, start, end)],
    }
}

fn line_circle_intersections(start: &Point, end: &Point, center: &Point, radius: f64) -> Vec<Point> {
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    let ox = start.x - center.x;
    let oy = start.y - center.y;
    let a = dx * dx + dy * dy;
    if a == 0.0 { return vec![]; }
    let b = 2.0 * (ox * dx + oy * dy);
    let c = ox * ox + oy * oy - radius * radius;
    let discriminant = b * b - 4.0 * a * c;
    if discriminant < 0.0 { return vec![]; }
    let root = discriminant.sqrt();
    [(-b - root) / (2.0 * a), (-b + root) / (2.0 * a)].into_iter()
        .filter(|&t| t >= 0.0 && t <= 1.0)
        .map(|t| Point { x: start.x + dx * t, y: start.y + dy * t }).collect()
}

pub fn boundary_intersections(left: &Boundary, right: &Boundary, math: &RepairMath) -> Vec<Point> {
    match (left, right) {
        (Boundary::Line { start, end, .. }, Boundary::Circle { center, radius, .. })
        | (Boundary::Circle { center, radius, .. }, Boundary::Line { start, end, .. }) => line_circle_intersections(start, end, center, *radius),
        (Boundary::Line { start: a, end: b, .. }, Boundary::Line { start: c, end: d, .. }) =>
            get_segment_intersection(a, b, c, d).into_iter().collect(),
        (Boundary::Circle { center: left, radius: left_radius, .. }, Boundary::Circle { center: right, radius: right_radius, .. }) => {
            let dx = right.x - left.x;
            let dy = right.y - left.y;
            let d = (math.hypot)(dx, dy);
            if d == 0.0 || d > left_radius + right_radius || d < (left_radius - right_radius).abs() { return vec![]; }
            let along = (left_radius * left_radius - right_radius * right_radius + d * d) / (2.0 * d);
            let perpendicular = js_max(0.0, left_radius * left_radius - along * along).sqrt();
            let x = left.x + (dx * along) / d;
            let y = left.y + (dy * along) / d;
            vec![Point { x: x - (dy * perpendicular) / d, y: y + (dx * perpendicular) / d },
                Point { x: x + (dy * perpendicular) / d, y: y - (dx * perpendicular) / d }]
        }
    }
}

struct PadObstacle {
    layers: Vec<String>,
    connected_to: Vec<String>,
    connected_net_ids: Vec<InternedResolvedNetId>,
    center: Point,
    half_width: f64,
    half_height: f64,
    local_to_world: Matrix,
    world_to_local: Matrix,
    circular: bool,
    bounds: Bounds,
}

pub struct PadClearanceContext {
    resolved_nets: ResolvedNetInterner,
    board: Bounds,
    layer_count: f64,
    min_board_edge_clearance: f64,
    via_edge_to_pad_edge_clearance: f64,
    obstacles: Vec<PadObstacle>,
}

impl PadClearanceContext {
    pub fn new(srj: &Value, math: &RepairMath, conn_map: Option<&RepairConnectivityMap>) -> Self {
        let resolved_nets = ResolvedNetInterner::new();
        let raw_board = &srj["bounds"];
        let board = Bounds {
            min_x: raw_board["minX"].as_f64().expect("Board minX is required"),
            max_x: raw_board["maxX"].as_f64().expect("Board maxX is required"),
            min_y: raw_board["minY"].as_f64().expect("Board minY is required"),
            max_y: raw_board["maxY"].as_f64().expect("Board maxY is required"),
        };
        let obstacles = srj["obstacles"].as_array().expect("SRJ obstacles are required").iter()
            .filter(|obstacle| !obstacle["isCopperPour"].as_bool().unwrap_or(false))
            .map(|obstacle| {
                let layers: Vec<String> = obstacle["layers"].as_array().expect("Obstacle layers are required").iter()
                    .map(|layer| layer.as_str().expect("Obstacle layer must be a string").to_owned()).collect();
                let connected_to: Vec<String> = obstacle.get("connectedTo").filter(|value| !value.is_null())
                    .map(|value| value.as_array().expect("Obstacle connectedTo must be an array").iter()
                        .map(|id| id.as_str().expect("Obstacle connected id must be a string").to_owned()).collect()).unwrap_or_default();
                let rotation = obstacle["ccwRotationDegrees"].as_f64().filter(|angle| angle.is_finite());
                let width = obstacle["width"].as_f64().expect("Obstacle width is required");
                let height = obstacle["height"].as_f64().expect("Obstacle height is required");
                let circular = rotation.is_none() && layers.len() > 1 && (width - height).abs() < 0.001;
                let center = Point { x: obstacle["center"]["x"].as_f64().expect("Obstacle center x is required"), y: obstacle["center"]["y"].as_f64().expect("Obstacle center y is required") };
                let local_to_world = compose(&[translate(center.x, center.y), rotate_deg_with_math(rotation.unwrap_or(0.0), math.sin, math.cos)]);
                let half_width = if circular { js_max(width, height) / 2.0 } else { width / 2.0 };
                let half_height = if circular { half_width } else { height / 2.0 };
                let bounds = get_bounds_from_points(&apply_to_points(&local_to_world, &[
                    Point { x: -half_width, y: -half_height }, Point { x: half_width, y: -half_height },
                    Point { x: half_width, y: half_height }, Point { x: -half_width, y: half_height },
                ])).expect("Four points have bounds");
                let connected_net_ids = connected_to.iter().map(|id| resolved_nets.resolve(id, conn_map)).collect();
                PadObstacle { layers, connected_to, connected_net_ids, center, half_width, half_height, local_to_world,
                    world_to_local: inverse(&local_to_world), circular, bounds }
            }).collect();
        Self { resolved_nets, board, obstacles,
            layer_count: srj["layerCount"].as_f64().expect("SRJ layerCount is required"),
            min_board_edge_clearance: srj["minBoardEdgeClearance"].as_f64().unwrap_or(0.0),
            via_edge_to_pad_edge_clearance: get_via_edge_to_pad_edge_clearance(srj),
        }
    }

    pub fn set_connectivity(&mut self, conn_map: Option<&RepairConnectivityMap>) {
        for obstacle in &mut self.obstacles {
            obstacle.connected_net_ids = obstacle.connected_to.iter()
                .map(|id| self.resolved_nets.resolve(id, conn_map))
                .collect();
        }
    }

    fn get_pad_regions(&self, route: &MutableRoute, via_radius: f64, z_layers: &[f64], conn_map: Option<&RepairConnectivityMap>) -> Vec<PadRegion> {
        let min_z = z_layers.iter().copied().fold(f64::INFINITY, js_min);
        let max_z = z_layers.iter().copied().fold(f64::NEG_INFINITY, js_max);
        let layers: Vec<String> = range(min_z, Some(max_z + 1.0), 1.0).iter().map(|&z| map_z_to_layer_name(z, self.layer_count)).collect();
        let root = self.resolved_nets.resolve(get_root_connection_name(route), conn_map);
        let connection = self.resolved_nets.resolve(&route.connection_name, conn_map);
        self.obstacles.iter().filter(|obstacle| obstacle.layers.iter().any(|layer| layers.contains(layer))).map(|obstacle| {
            let same_net = obstacle.connected_net_ids.iter().any(|&id| shares_interned_resolved_net(root, id))
                || obstacle.connected_net_ids.iter().any(|&id| shares_interned_resolved_net(connection, id));
            let clearance = via_radius + if same_net { 0.0 } else { self.via_edge_to_pad_edge_clearance };
            let margin = clearance + POSITION_EPSILON;
            PadRegion { center: obstacle.center, half_width: obstacle.half_width, half_height: obstacle.half_height,
                local_to_world: obstacle.local_to_world, world_to_local: obstacle.world_to_local,
                circular: obstacle.circular, clearance,
                bounds: Bounds { min_x: obstacle.bounds.min_x - margin, max_x: obstacle.bounds.max_x + margin,
                    min_y: obstacle.bounds.min_y - margin, max_y: obstacle.bounds.max_y + margin } }
        }).collect()
    }
}

pub struct PadPlacement {
    pub point: Option<Point>,
    pub is_preferred: bool,
}

pub fn find_pad_clearance_via_position(srj: &Value, route: &MutableRoute, preferred: Point, via_radius: f64, z_layers: &[f64], conn_map: Option<&RepairConnectivityMap>, math: &RepairMath) -> Option<Point> {
    find_pad_clearance_via_position_with_identity(srj, route, preferred, via_radius, z_layers, conn_map, math).point
}

pub fn find_pad_clearance_via_position_with_identity(srj: &Value, route: &MutableRoute, preferred: Point, via_radius: f64, z_layers: &[f64], conn_map: Option<&RepairConnectivityMap>, math: &RepairMath) -> PadPlacement {
    PadClearanceContext::new(srj, math, conn_map).find_with_identity(route, preferred, via_radius, z_layers, conn_map, math)
}

impl PadClearanceContext {
    // conn_map must match the snapshot supplied to new or set_connectivity;
    // obstacle mappings are compiled there, while route mappings are read here.
    pub fn find_with_identity(&self, route: &MutableRoute, preferred: Point, via_radius: f64, z_layers: &[f64], conn_map: Option<&RepairConnectivityMap>, math: &RepairMath) -> PadPlacement {
        let board_margin = via_radius + self.min_board_edge_clearance;
        let board = Bounds {
            min_x: self.board.min_x + board_margin,
            max_x: self.board.max_x - board_margin,
            min_y: self.board.min_y + board_margin,
            max_y: self.board.max_y - board_margin,
        };
        if board.min_x > board.max_x || board.min_y > board.max_y { return PadPlacement { point: None, is_preferred: false }; }
        let pads = self.get_pad_regions(route, via_radius, z_layers, conn_map);
        let is_feasible = |point: &Point| is_point_inside_bounds(point, &board) && pads.iter().all(|pad| distance_to_pad(point, pad, math) >= pad.clearance);
        let projected = project_to_bounds(&preferred, &board);
        if is_feasible(&projected) {
            let is_preferred = is_point_inside_bounds(&preferred, &board);
            return PadPlacement { point: Some(if is_preferred { preferred } else { projected }), is_preferred };
        }

        let mut component: Vec<usize> = pads.iter().enumerate().filter(|(_, pad)| distance_to_pad(&projected, pad, math) < pad.clearance).map(|(i, _)| i).collect();
        let mut included = vec![false; pads.len()];
        for &i in &component { included[i] = true; }
        let mut index = 0;
        while index < component.len() {
            for (i, pad) in pads.iter().enumerate() {
                if !included[i] && do_bounds_overlap(&pads[component[index]].bounds, &pad.bounds) {
                    included[i] = true;
                    component.push(i);
                }
            }
            index += 1;
        }
        let mut boundaries: Vec<Boundary> = component.iter().flat_map(|&i| get_pad_boundaries(&pads[i])).collect();
        let bottom_left = Point { x: board.min_x, y: board.min_y };
        let bottom_right = Point { x: board.max_x, y: board.min_y };
        let top_right = Point { x: board.max_x, y: board.max_y };
        let top_left = Point { x: board.min_x, y: board.max_y };
        boundaries.extend([create_line(bottom_left, bottom_right), create_line(bottom_right, top_right), create_line(top_right, top_left), create_line(top_left, bottom_left)]);
        let mut best = None;
        let mut best_distance = f64::INFINITY;
        let consider = |candidate: Point, best: &mut Option<Point>, best_distance: &mut f64| {
            let candidate_distance = dist_sq(&candidate, &preferred);
            if candidate_distance < *best_distance && is_feasible(&candidate) {
                *best = Some(candidate);
                *best_distance = candidate_distance;
            }
        };
        for boundary in &boundaries {
            for point in boundary_projections(&preferred, boundary, math) { consider(point, &mut best, &mut best_distance); }
        }
        for left in 0..boundaries.len() {
            let a = &boundaries[left];
            if dist_sq(&preferred, &project_to_bounds(&preferred, a.bounds())) > best_distance { continue; }
            for b in &boundaries[left + 1..] {
                if !do_bounds_overlap(a.bounds(), b.bounds()) { continue; }
                if dist_sq(&preferred, &project_to_bounds(&preferred, b.bounds())) > best_distance { continue; }
                for point in boundary_intersections(a, b, math) { consider(point, &mut best, &mut best_distance); }
            }
        }
        PadPlacement { point: best, is_preferred: false }
    }
}
