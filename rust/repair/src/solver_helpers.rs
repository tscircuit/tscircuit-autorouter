use crate::find_pad_clearance_via_position::PadClearanceContext;
use std::rc::Rc;
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};
use indexmap::IndexSet;
use serde_json::{Value, json};
use crate::internal_types::*;
use crate::solver_config::*;
use crate::spatial_index::*;
use crate::net_utils::*;
use crate::get_drc_errors::PREFERRED_VIA_TO_VIA_CLEARANCE;
use crate::drc_presets::RELAXED_TRACE_CLEARANCE;
use autorouting_drc::math_utils::{point_to_segment_distance, segment_to_segment_min_distance};

#[derive(Clone, Copy)]
pub struct RepairMath {
    pub hypot: fn(f64, f64) -> f64,
    pub sin: fn(f64) -> f64,
    pub cos: fn(f64) -> f64,
    pub round: fn(f64) -> f64,
}

impl Default for RepairMath {
    fn default() -> Self {
        Self { hypot: f64::hypot, sin: f64::sin, cos: f64::cos, round: js_round }
    }
}

pub struct BroadRepulsionEngine {
    pub(crate) pad_context: PadClearanceContext,
    pub(crate) srj: RepairSrj,
    pub(crate) conn_map: Option<RepairConnectivityMap>,
    pub(crate) math: RepairMath,
}

pub(crate) struct RepairSrj {
    resolved_nets: ResolvedNetInterner,
    pub(crate) source: Value,
    pub(crate) layer_count: usize,
    pub(crate) min_board_edge_clearance: Option<f64>,
    pub(crate) bounds: Bounds2D,
    pub(crate) outline: Vec<Point>,
    pub(crate) min_via_diameter: f64,
    pub(crate) min_trace_width: f64,
    pub(crate) default_obstacle_margin: f64,
    pub(crate) trace_to_pad_clearance: f64,
    pub(crate) via_to_pad_clearance: f64,
    pub(crate) obstacles: Vec<RepairObstacle>,
}

pub(crate) struct RepairObstacle {
    pub(crate) center: Point,
    pub(crate) width: f64,
    pub(crate) height: f64,
    pub(crate) is_copper_pour: bool,
    pub(crate) z_layers: Vec<f64>,
    pub(crate) connected_to: Vec<String>,
    pub(crate) connected_to_net_ids: Vec<Option<String>>,
    pub(crate) interned_connected_to: Vec<InternedResolvedNetId>,
}

impl RepairSrj {
    pub(crate) fn from_value(srj: &Value, conn_map: Option<&RepairConnectivityMap>) -> Self {
        let resolved_nets = ResolvedNetInterner::new();
        let b = &srj["bounds"];
        let layer_count = n(&srj["layerCount"]) as usize;
        let obstacles = srj["obstacles"].as_array().expect("Obstacles required").iter().map(|obstacle| {
            let connected_to: Vec<String> = obstacle.get("connectedTo").filter(|v| !v.is_null()).map(|v| {
                v.as_array().expect("Obstacle connectedTo must be an array").iter().map(|id| id.as_str().expect("Obstacle connected ID must be a string").to_owned()).collect()
            }).unwrap_or_default();
            let connected_to_net_ids = connected_to.iter().map(|id| resolve_net_id(id, conn_map).net_id.map(str::to_owned)).collect();
            RepairObstacle {
                center: p(&obstacle["center"]),
                width: n(&obstacle["width"]),
                height: n(&obstacle["height"]),
                is_copper_pour: obstacle["isCopperPour"].as_bool() == Some(true),
                z_layers: get_obstacle_z_layers(obstacle, layer_count),
                interned_connected_to: connected_to.iter().map(|id| resolved_nets.resolve(id, conn_map)).collect(),
                connected_to, connected_to_net_ids,
            }
        }).collect();
        Self {
            resolved_nets, source: srj.clone(), layer_count, min_board_edge_clearance: srj["minBoardEdgeClearance"].as_f64(),
            bounds: Bounds2D { min_x: n(&b["minX"]), min_y: n(&b["minY"]), max_x: n(&b["maxX"]), max_y: n(&b["maxY"]) },
            outline: srj["outline"].as_array().map(|a| a.iter().map(p).collect()).unwrap_or_default(),
            min_via_diameter: opt_n(&srj["minViaDiameter"], 0.3),
            min_trace_width: n(&srj["minTraceWidth"]),
            default_obstacle_margin: opt_n(&srj["defaultObstacleMargin"], 0.0),
            trace_to_pad_clearance: get_trace_to_pad_edge_clearance(srj),
            via_to_pad_clearance: get_via_edge_to_pad_edge_clearance(srj),
            obstacles,
        }
    }
}

#[derive(Clone, Copy)]
struct Projection { x: f64, y: f64, t: f64 }

#[derive(Clone, Copy)]
pub(crate) struct Repulsion { pub(crate) direction: Point, pub(crate) penetration: f64 }

#[derive(Clone, Copy)]
struct SegmentRepulsion { direction: Point, penetration: f64, normality: f64, t: f64 }

fn n(value: &Value) -> f64 { value.as_f64().expect("Expected number") }
fn opt_n(value: &Value, default: f64) -> f64 { value.as_f64().unwrap_or(default) }
fn p(value: &Value) -> Point { Point { x: n(&value["x"]), y: n(&value["y"]) } }
fn point_xy(point: &RoutePoint) -> Point { Point { x: point.x, y: point.y } }
fn via_xy(via: &ViaNode) -> Point { Point { x: via.x, y: via.y } }
fn are_same_xy(left: Point, right: Point) -> bool {
    (left.x - right.x).abs() <= COORDINATE_EPSILON && (left.y - right.y).abs() <= COORDINATE_EPSILON
}

pub fn collect_via_nodes(routes: &[MutableRoute], default_via_diameter: f64) -> Vec<ViaNode> {
    let mut vias = Vec::new();
    for (route_index, route) in routes.iter().enumerate() {
        let mut seen_indexes = vec![false; route.route.len()];
        for index in 0..route.route.len().saturating_sub(1) {
            let current = route.route[index].borrow();
            let next = route.route[index + 1].borrow();
            if current.z == next.z || !are_same_xy(point_xy(&current), point_xy(&next)) { continue; }
            let mut indexes = vec![index, index + 1];
            for cursor in (0..index).rev() {
                if !are_same_xy(point_xy(&route.route[cursor].borrow()), point_xy(&current)) { break; }
                indexes.push(cursor);
            }
            for cursor in index + 2..route.route.len() {
                if !are_same_xy(point_xy(&route.route[cursor].borrow()), point_xy(&current)) { break; }
                indexes.push(cursor);
            }
            // The initial pair and the two disjoint cursor ranges contain no duplicate indices.
            if indexes.iter().any(|&i| seen_indexes[i]) { continue; }
            for &i in &indexes { seen_indexes[i] = true; }
            let endpoints: Vec<_> = indexes.iter().filter(|&&i| i == 0 || i == route.route.len() - 1).copied().collect();
            let has_tagged_terminal = endpoints.iter().any(|&i| route.route[i].borrow().metadata["pcb_port_id"].as_str().is_some_and(|s| !s.is_empty()));
            let mut z_layers = Vec::new();
            for &i in &indexes {
                let z = route.route[i].borrow().z;
                if !z_layers.contains(&z) { z_layers.push(z); }
            }
            vias.push(ViaNode { route_index, root_connection_name: get_root_connection_name(route).to_owned(), point_indexes: indexes, z_layers, x: current.x, y: current.y, radius: route.via_diameter.unwrap_or(default_via_diameter) / 2.0, movable: endpoints.is_empty(), can_canonicalize: endpoints.is_empty() || !has_tagged_terminal });
        }
    }
    vias
}

pub(crate) fn collect_segments_for_route(route: &MutableRoute, route_index: usize) -> Vec<Segment> {
    let mut segments = Vec::new();
    for index in 0..route.route.len().saturating_sub(1) {
        let start = route.route[index].borrow();
        let end = route.route[index + 1].borrow();
        if start.z != end.z || are_same_xy(point_xy(&start), point_xy(&end)) { continue; }
        segments.push(Segment { route_index, root_connection_name: get_root_connection_name(route).to_owned(), start_index: index, end_index: index + 1, start: route.route[index].clone(), end: route.route[index + 1].clone(), z: start.z, radius: route.trace_thickness.unwrap_or(0.1) / 2.0 });
    }
    segments
}

pub(crate) fn collect_segments(routes: &[MutableRoute]) -> Vec<Segment> {
    routes.iter().enumerate().flat_map(|(i, route)| collect_segments_for_route(route, i)).collect()
}

fn get_via_bounds(via: &ViaNode) -> Bounds2D {
    Bounds2D { min_x: via.x, min_y: via.y, max_x: via.x, max_y: via.y }
}

fn get_segment_bounds(segment: &Segment) -> Bounds2D {
    let start = segment.start.borrow();
    let end = segment.end.borrow();
    Bounds2D { min_x: start.x.min(end.x), min_y: start.y.min(end.y), max_x: start.x.max(end.x), max_y: start.y.max(end.y) }
}

fn get_obstacle_bounds(obstacle: &RepairObstacle) -> Bounds2D {
    let center = obstacle.center;
    let width = obstacle.width;
    let height = obstacle.height;
    Bounds2D { min_x: center.x - width / 2.0, min_y: center.y - height / 2.0, max_x: center.x + width / 2.0, max_y: center.y + height / 2.0 }
}

pub fn get_obstacle_z_layers(obstacle: &Value, layer_count: usize) -> Vec<f64> {
    if let Some(layers) = obstacle["zLayers"].as_array().filter(|a| !a.is_empty()) { return layers.iter().map(n).collect(); }
    let layers = obstacle["layers"].as_array().expect("Obstacle layers required");
    let z_layers: Vec<f64> = (0..layer_count).filter(|&z| {
        let name = if z == 0 { "top".to_owned() } else if z == layer_count - 1 { "bottom".to_owned() } else { format!("inner{z}") };
        layers.iter().any(|l| l.as_str() == Some(name.as_str()))
    }).map(|z| z as f64).collect();
    if z_layers.is_empty() { (0..layer_count).map(|z| z as f64).collect() } else { z_layers }
}

fn get_broad_spatial_interaction_distance(srj: &RepairSrj, vias: &[ViaNode], segments: &[Segment]) -> f64 {
    let max_via = vias.iter().fold(srj.min_via_diameter / 2.0, |m, v| m.max(v.radius));
    let max_segment = segments.iter().fold(srj.min_trace_width / 2.0, |m, s| m.max(s.radius));
    let trace_clearance = RELAXED_TRACE_CLEARANCE + CLEARANCE_SLACK;
    (max_via * 2.0 + PREFERRED_VIA_TO_VIA_CLEARANCE + CLEARANCE_SLACK)
        .max(max_via + max_segment + trace_clearance)
        .max(max_segment * 2.0 + trace_clearance)
        .max(max_segment + srj.trace_to_pad_clearance + CLEARANCE_SLACK)
        .max(max_via + srj.via_to_pad_clearance + CLEARANCE_SLACK)
}

fn project_point_onto_line_segment(point: Point, start: Point, end: Point) -> Projection {
    let segment_x = end.x - start.x;
    let segment_y = end.y - start.y;
    let length_squared = segment_x * segment_x + segment_y * segment_y;
    if length_squared <= POSITION_EPSILON { return Projection { x: start.x, y: start.y, t: 0.0 }; }
    let t = clamp_value(((point.x - start.x) * segment_x + (point.y - start.y) * segment_y) / length_squared, 0.0, 1.0);
    Projection { x: start.x + segment_x * t, y: start.y + segment_y * t, t }
}

fn point_to_segment_projection(point: Point, segment: &Segment) -> Projection {
    project_point_onto_line_segment(point, point_xy(&segment.start.borrow()), point_xy(&segment.end.borrow()))
}

pub(crate) fn get_rect_repulsion(point: Point, obstacle: &RepairObstacle, required_distance: f64, math: RepairMath) -> Option<Repulsion> {
    let half_width = obstacle.width / 2.0;
    let half_height = obstacle.height / 2.0;
    let center = obstacle.center;
    let closest_x = clamp_value(point.x, center.x - half_width, center.x + half_width);
    let closest_y = clamp_value(point.y, center.y - half_height, center.y + half_height);
    let mut separation_x = point.x - closest_x;
    let mut separation_y = point.y - closest_y;
    let mut distance = (math.hypot)(separation_x, separation_y);
    if distance <= POSITION_EPSILON {
        let dx_to_side = half_width - (point.x - center.x).abs();
        let dy_to_side = half_height - (point.y - center.y).abs();
        if dx_to_side < dy_to_side {
            separation_x = if point.x >= center.x { 1.0 } else { -1.0 };
            separation_y = 0.0;
        } else {
            separation_x = 0.0;
            separation_y = if point.y >= center.y { 1.0 } else { -1.0 };
        }
        distance = 0.0;
    }
    let penetration = required_distance - distance;
    if penetration <= 0.0 { return None; }
    let length = (math.hypot)(separation_x, separation_y);
    Some(Repulsion { direction: Point { x: if length > POSITION_EPSILON { separation_x / length } else { 1.0 }, y: if length > POSITION_EPSILON { separation_y / length } else { 0.0 } }, penetration })
}

fn get_coincident_point_indexes(route: &MutableRoute, point_index: usize) -> Vec<usize> {
    let Some(point) = route.route.get(point_index) else { return Vec::new(); };
    let point = point.borrow();
    let mut indexes = vec![point_index];
    for cursor in (0..point_index).rev() {
        if !are_same_xy(point_xy(&route.route[cursor].borrow()), point_xy(&point)) { break; }
        indexes.push(cursor);
    }
    for cursor in point_index + 1..route.route.len() {
        if !are_same_xy(point_xy(&route.route[cursor].borrow()), point_xy(&point)) { break; }
        indexes.push(cursor);
    }
    indexes
}

fn get_movable_coincident_point_indexes(route: &MutableRoute, index: usize) -> Option<Vec<usize>> {
    if index == 0 || index >= route.route.len().saturating_sub(1) { return None; }
    let indexes = get_coincident_point_indexes(route, index);
    if indexes.contains(&0) || indexes.contains(&(route.route.len() - 1)) { return None; }
    Some(indexes)
}

fn point_is_inside_bounds(point: Point, bounds: Bounds2D) -> bool {
    point.x >= bounds.min_x - COORDINATE_EPSILON && point.x <= bounds.max_x + COORDINATE_EPSILON && point.y >= bounds.min_y - COORDINATE_EPSILON && point.y <= bounds.max_y + COORDINATE_EPSILON
}

fn get_point_bounds_clearance(point: Point, bounds: Bounds2D) -> f64 {
    (point.x - bounds.min_x).min(bounds.max_x - point.x).min(point.y - bounds.min_y).min(bounds.max_y - point.y)
}

fn point_is_on_segment(point: Point, start: Point, end: Point) -> bool {
    let sx = end.x - start.x;
    let sy = end.y - start.y;
    let px = point.x - start.x;
    let py = point.y - start.y;
    if (sx * py - sy * px).abs() > COORDINATE_EPSILON { return false; }
    point.x >= start.x.min(end.x) - COORDINATE_EPSILON && point.x <= start.x.max(end.x) + COORDINATE_EPSILON && point.y >= start.y.min(end.y) - COORDINATE_EPSILON && point.y <= start.y.max(end.y) + COORDINATE_EPSILON
}

fn point_is_inside_outline(point: Point, outline: &[Point]) -> bool {
    if outline.len() < 3 { return true; }
    for i in 0..outline.len() { if point_is_on_segment(point, outline[i], outline[(i + 1) % outline.len()]) { return true; } }
    let mut inside = false;
    let mut previous_index = outline.len() - 1;
    for current in outline {
        let previous = outline[previous_index];
        let intersects = (current.y > point.y) != (previous.y > point.y) && point.x < ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x;
        if intersects { inside = !inside; }
        previous_index = (previous_index + 1) % outline.len();
    }
    inside
}

fn get_point_outline_clearance(point: Point, outline: &[Point]) -> f64 {
    let mut distance = f64::INFINITY;
    for i in 0..outline.len() { distance = distance.min(point_to_segment_distance(&point, &outline[i], &outline[(i + 1) % outline.len()])); }
    distance
}

fn normalize_vector(x: f64, y: f64, math: RepairMath) -> Option<Point> {
    let length = (math.hypot)(x, y);
    if length <= POSITION_EPSILON { None } else { Some(Point { x: x / length, y: y / length }) }
}

fn get_outline_signed_area(outline: &[Point]) -> f64 {
    let mut signed_area = 0.0;
    for i in 0..outline.len() { let a = outline[i]; let b = outline[(i + 1) % outline.len()]; signed_area += a.x * b.y - b.x * a.y; }
    signed_area / 2.0
}

fn get_bounds_inward_normal(point: Point, bounds: Bounds2D, math: RepairMath) -> Option<Point> {
    let left = point.x - bounds.min_x;
    let right = bounds.max_x - point.x;
    let bottom = point.y - bounds.min_y;
    let top = bounds.max_y - point.y;
    let min = left.min(right).min(bottom).min(top);
    let mut x = 0.0;
    let mut y = 0.0;
    if left <= min + COORDINATE_EPSILON { x += 1.0; }
    if right <= min + COORDINATE_EPSILON { x -= 1.0; }
    if bottom <= min + COORDINATE_EPSILON { y += 1.0; }
    if top <= min + COORDINATE_EPSILON { y -= 1.0; }
    normalize_vector(x, y, math)
}

fn get_outline_inward_normal(point: Point, outline: &[Point], math: RepairMath) -> Option<Point> {
    let inside = point_is_inside_outline(point, outline);
    let mut nearest: Option<(Projection, Point, Point, f64)> = None;
    for i in 0..outline.len() {
        let start = outline[i];
        let end = outline[(i + 1) % outline.len()];
        let projection = project_point_onto_line_segment(point, start, end);
        let distance = (math.hypot)(point.x - projection.x, point.y - projection.y);
        if nearest.is_none_or(|n| distance < n.3) { nearest = Some((projection, start, end, distance)); }
    }
    let (projection, start, end, _) = nearest?;
    if let Some(normal) = normalize_vector(if inside { point.x - projection.x } else { projection.x - point.x }, if inside { point.y - projection.y } else { projection.y - point.y }, math) { return Some(normal); }
    let edge_x = end.x - start.x;
    let edge_y = end.y - start.y;
    let length = (math.hypot)(edge_x, edge_y);
    if length <= POSITION_EPSILON { return None; }
    let ccw = get_outline_signed_area(outline) >= 0.0;
    Some(Point { x: if ccw { -edge_y / length } else { edge_y / length }, y: if ccw { edge_x / length } else { -edge_x / length } })
}

fn get_point_board_inward_normal(srj: &RepairSrj, point: Point, math: RepairMath) -> Option<Point> {
    let outline = &srj.outline;
    if outline.len() >= 3 { get_outline_inward_normal(point, &outline, math) } else { get_bounds_inward_normal(point, srj.bounds, math) }
}

fn get_point_board_clearance(srj: &RepairSrj, point: Point) -> f64 {
    let outline = &srj.outline;
    if outline.len() >= 3 {
        let clearance = get_point_outline_clearance(point, &outline);
        if point_is_inside_outline(point, &outline) { clearance } else { -clearance }
    } else { get_point_bounds_clearance(point, srj.bounds) }
}

fn get_segment_board_clearance(srj: &RepairSrj, start: Point, end: Point) -> f64 {
    if are_same_xy(start, end) { return get_point_board_clearance(srj, start).min(get_point_board_clearance(srj, end)); }
    let outline = &srj.outline;
    if outline.len() >= 3 {
        if !point_is_inside_outline(start, &outline) || !point_is_inside_outline(end, &outline) { return get_point_board_clearance(srj, start).min(get_point_board_clearance(srj, end)); }
        let mut distance = f64::INFINITY;
        for i in 0..outline.len() { distance = distance.min(segment_to_segment_min_distance(&start, &end, &outline[i], &outline[(i + 1) % outline.len()])); }
        return distance;
    }
    if !point_is_inside_bounds(start, srj.bounds) || !point_is_inside_bounds(end, srj.bounds) { return get_point_board_clearance(srj, start).min(get_point_board_clearance(srj, end)); }
    get_point_bounds_clearance(start, srj.bounds).min(get_point_bounds_clearance(end, srj.bounds))
}

fn get_board_edge_proximity_threshold(srj: &RepairSrj, radius: f64) -> f64 {
    radius + PREFERRED_TRACE_TO_PAD_CLEARANCE.max(srj.default_obstacle_margin).max(RELAXED_TRACE_CLEARANCE)
}

fn move_reduces_clearance_into_board_edge_zone(current: f64, next: f64, threshold: f64) -> bool {
    next < current - COORDINATE_EPSILON && current.min(next) <= threshold + COORDINATE_EPSILON
}

fn clip_translation_against_board_edge(dx: f64, dy: f64, normal: Point, current: f64, threshold: f64) -> Point {
    let dot = dx * normal.x + dy * normal.y;
    let max_outward = (current - threshold).max(0.0);
    let min_dot = -max_outward;
    if dot >= min_dot - COORDINATE_EPSILON { return Point { x: dx, y: dy }; }
    let adjustment = min_dot - dot;
    Point { x: dx + normal.x * adjustment, y: dy + normal.y * adjustment }
}

fn clip_point_translation_away_from_board_edge(srj: &RepairSrj, point: Point, dx: f64, dy: f64, radius: f64, math: RepairMath) -> Point {
    let Some(normal) = get_point_board_inward_normal(srj, point, math) else { return Point { x: dx, y: dy }; };
    clip_translation_against_board_edge(dx, dy, normal, get_point_board_clearance(srj, point), get_board_edge_proximity_threshold(srj, radius))
}

fn clip_point_indexes_translation_away_from_board_edge(srj: &RepairSrj, route: &MutableRoute, indexes: &[usize], dx: f64, dy: f64, radius: f64, math: RepairMath) -> Point {
    let unique: BTreeSet<usize> = indexes.iter().copied().collect();
    let mut translation = Point { x: dx, y: dy };
    let threshold = get_board_edge_proximity_threshold(srj, radius);
    for _ in 0..unique.len().max(1) {
        let mut changed = false;
        for &index in &unique {
            let Some(point) = route.route.get(index) else { continue; };
            let point = point_xy(&point.borrow());
            let Some(normal) = get_point_board_inward_normal(srj, point, math) else { continue; };
            let clipped = clip_translation_against_board_edge(translation.x, translation.y, normal, get_point_board_clearance(srj, point), threshold);
            if (clipped.x - translation.x).abs() > POSITION_EPSILON || (clipped.y - translation.y).abs() > POSITION_EPSILON {
                translation = clipped;
                changed = true;
            }
        }
        if !changed { break; }
    }
    translation
}

fn get_route_point_indexes_min_board_clearance(srj: &RepairSrj, route: &MutableRoute, indexes: &[usize], translated: Option<&BTreeMap<usize, Point>>) -> f64 {
    let unique: BTreeSet<usize> = indexes.iter().copied().collect();
    if unique.is_empty() { return f64::INFINITY; }
    let get_point = |index: usize| -> Option<Point> {
        translated.and_then(|t| t.get(&index).copied()).or_else(|| route.route.get(index).map(|p| point_xy(&p.borrow())))
    };
    let mut clearance = f64::INFINITY;
    for &index in &unique {
        if let Some(point) = get_point(index) { clearance = clearance.min(get_point_board_clearance(srj, point)); }
    }
    for index in 0..route.route.len().saturating_sub(1) {
        if !unique.contains(&index) && !unique.contains(&(index + 1)) { continue; }
        if let (Some(start), Some(end)) = (get_point(index), get_point(index + 1)) { clearance = clearance.min(get_segment_board_clearance(srj, start, end)); }
    }
    clearance
}

fn get_safe_translation_for_point_indexes(srj: &RepairSrj, route: &MutableRoute, indexes: &[usize], dx: f64, dy: f64, radius: f64, math: RepairMath) -> Option<Point> {
    let sorted: Vec<usize> = indexes.iter().copied().collect::<BTreeSet<_>>().into_iter().collect();
    if sorted.is_empty() { return None; }
    let translation = clip_point_indexes_translation_away_from_board_edge(srj, route, &sorted, dx, dy, radius, math);
    if translation.x.abs() <= POSITION_EPSILON && translation.y.abs() <= POSITION_EPSILON { return None; }
    let mut translated = BTreeMap::new();
    for &index in &sorted {
        if let Some(point) = route.route.get(index) {
            let point = point.borrow();
            translated.insert(index, Point { x: point.x + translation.x, y: point.y + translation.y });
        }
    }
    let current = get_route_point_indexes_min_board_clearance(srj, route, &sorted, None);
    let next = get_route_point_indexes_min_board_clearance(srj, route, &sorted, Some(&translated));
    if next < radius - COORDINATE_EPSILON { return None; }
    if move_reduces_clearance_into_board_edge_zone(current, next, get_board_edge_proximity_threshold(srj, radius)) { return None; }
    Some(translation)
}

fn move_route_point(routes: &mut [MutableRoute], route_index: usize, point_index: usize, dx: f64, dy: f64, srj: &RepairSrj, radius: f64, math: RepairMath) -> bool {
    let Some(route) = routes.get_mut(route_index) else { return false; };
    let Some(indexes) = get_movable_coincident_point_indexes(route, point_index) else { return false; };
    let Some(translation) = get_safe_translation_for_point_indexes(srj, route, &indexes, dx, dy, radius, math) else { return false; };
    let mut changed = false;
    for index in indexes {
        if let Some(point) = route.route.get(index) {
            let mut point = point.borrow_mut();
            point.x += translation.x;
            point.y += translation.y;
            let b = srj.bounds;
            point.x = clamp_value(point.x, b.min_x, b.max_x);
            point.y = clamp_value(point.y, b.min_y, b.max_y);
            changed = true;
        }
    }
    changed
}

fn translate_via(routes: &mut [MutableRoute], via: &mut ViaNode, dx: f64, dy: f64, srj: &RepairSrj, math: RepairMath) -> bool {
    let Some(route) = routes.get_mut(via.route_index) else { return false; };
    let translation = clip_point_translation_away_from_board_edge(srj, via_xy(via), dx, dy, via.radius, math);
    if translation.x.abs() <= POSITION_EPSILON && translation.y.abs() <= POSITION_EPSILON { return false; }
    let next = Point { x: via.x + translation.x, y: via.y + translation.y };
    let current_clearance = get_point_board_clearance(srj, via_xy(via));
    let next_clearance = get_point_board_clearance(srj, next);
    if next_clearance < via.radius - COORDINATE_EPSILON { return false; }
    if move_reduces_clearance_into_board_edge_zone(current_clearance, next_clearance, get_board_edge_proximity_threshold(srj, via.radius)) { return false; }
    via.x += translation.x;
    via.y += translation.y;
    let b = srj.bounds;
    via.x = clamp_value(via.x, b.min_x, b.max_x);
    via.y = clamp_value(via.y, b.min_y, b.max_y);
    for &index in &via.point_indexes {
        if let Some(point) = route.route.get(index) { let mut point = point.borrow_mut(); point.x = via.x; point.y = via.y; }
    }
    true
}

fn get_same_root_via_site(routes: &[MutableRoute], via: &ViaNode, math: RepairMath) -> Vec<ViaNode> {
    let current = collect_via_nodes(routes, 0.3);
    let Some(found) = current.iter().find(|candidate| candidate.route_index == via.route_index && candidate.point_indexes.iter().any(|i| via.point_indexes.contains(i))) else { return Vec::new(); };
    current.iter().filter(|candidate| candidate.root_connection_name == found.root_connection_name && (math.hypot)(candidate.x - found.x, candidate.y - found.y) <= COORDINATE_EPSILON).cloned().collect()
}

fn translate_same_root_via_site(routes: &mut [MutableRoute], via: &ViaNode, dx: f64, dy: f64, srj: &RepairSrj, math: RepairMath) -> bool {
    let mut site = get_same_root_via_site(routes, via, math);
    if site.is_empty() || site.iter().any(|c| !c.movable || routes.get(c.route_index).is_none()) { return false; }
    let mut representative = 0;
    for i in 1..site.len() { if site[i].radius > site[representative].radius { representative = i; } }
    if !translate_via(routes, &mut site[representative], dx, dy, srj, math) { return false; }
    let x = site[representative].x;
    let y = site[representative].y;
    for (i, candidate) in site.iter_mut().enumerate() {
        if i == representative { continue; }
        candidate.x = x;
        candidate.y = y;
        for &index in &candidate.point_indexes {
            if let Some(point) = routes[candidate.route_index].route.get(index) { let mut point = point.borrow_mut(); point.x = x; point.y = y; }
        }
    }
    true
}

fn move_via(routes: &mut [MutableRoute], via: &mut ViaNode, dx: f64, dy: f64, srj: &RepairSrj, math: RepairMath) -> bool {
    via.movable && get_same_root_via_site(routes, via, math).len() <= 1 && translate_via(routes, via, dx, dy, srj, math)
}

#[derive(Clone, Copy)]
struct SegmentDistanceCandidate { left_t: f64, right_t: f64, left_point: Point, right_point: Point }

fn get_segment_distance_candidates(left: &Segment, right: &Segment, math: RepairMath) -> Vec<SegmentDistanceCandidate> {
    let ls = point_xy(&left.start.borrow());
    let le = point_xy(&left.end.borrow());
    let rs = point_xy(&right.start.borrow());
    let re = point_xy(&right.end.borrow());
    let lsp = point_to_segment_projection(ls, right);
    let lep = point_to_segment_projection(le, right);
    let rsp = point_to_segment_projection(rs, left);
    let rep = point_to_segment_projection(re, left);
    let mut candidates = vec![
        SegmentDistanceCandidate { left_t: 0.0, right_t: lsp.t, left_point: ls, right_point: Point { x: lsp.x, y: lsp.y } },
        SegmentDistanceCandidate { left_t: 1.0, right_t: lep.t, left_point: le, right_point: Point { x: lep.x, y: lep.y } },
        SegmentDistanceCandidate { left_t: rsp.t, right_t: 0.0, left_point: Point { x: rsp.x, y: rsp.y }, right_point: rs },
        SegmentDistanceCandidate { left_t: rep.t, right_t: 1.0, left_point: Point { x: rep.x, y: rep.y }, right_point: re },
    ];
    candidates.sort_by(|a, b| {
        let ad = (math.hypot)(a.left_point.x - a.right_point.x, a.left_point.y - a.right_point.y);
        let bd = (math.hypot)(b.left_point.x - b.right_point.x, b.left_point.y - b.right_point.y);
        (ad - bd).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal)
    });
    candidates
}

fn move_segment_by_distribution(routes: &mut [MutableRoute], segment: &Segment, dx: f64, dy: f64, srj: &RepairSrj, t: f64, math: RepairMath) -> bool {
    let t = clamp_value(t, 0.0, 1.0);
    let start_weight = 1.0 - t;
    let end_weight = t;
    let moved_start = move_route_point(routes, segment.route_index, segment.start_index, dx * start_weight, dy * start_weight, srj, segment.radius, math);
    let moved_end = move_route_point(routes, segment.route_index, segment.end_index, dx * end_weight, dy * end_weight, srj, segment.radius, math);
    moved_start || moved_end
}

fn push_via_via_pair(routes: &mut [MutableRoute], left: &mut ViaNode, right: &mut ViaNode, srj: &RepairSrj, conn_map: Option<&RepairConnectivityMap>, max_move: f64, allow_same_net: bool, math: RepairMath) -> bool {
    if !allow_same_net && shares_net(&left.root_connection_name, Some(&right.root_connection_name), conn_map) { return false; }
    let required = left.radius + right.radius + PREFERRED_VIA_TO_VIA_CLEARANCE + CLEARANCE_SLACK;
    let sx = left.x - right.x;
    let sy = left.y - right.y;
    let distance = (math.hypot)(sx, sy);
    let penetration = required - distance;
    if penetration <= 0.0 { return false; }
    let angle = (left.route_index * 97 + right.route_index * 13) as f64 * 1.618;
    let dx = if distance > POSITION_EPSILON { sx / distance } else { (math.cos)(angle) };
    let dy = if distance > POSITION_EPSILON { sy / distance } else { (math.sin)(angle) };
    let movable = usize::from(left.movable) + usize::from(right.movable);
    if movable == 0 { return false; }
    let movement = max_move.min(penetration / movable as f64);
    let moved_left = move_via(routes, left, dx * movement, dy * movement, srj, math);
    let moved_right = move_via(routes, right, -dx * movement, -dy * movement, srj, math);
    moved_left || moved_right
}

fn push_via_segment_pair(routes: &mut [MutableRoute], via: &mut ViaNode, segment: &Segment, srj: &RepairSrj, conn_map: Option<&RepairConnectivityMap>, max_move: f64, move_divisor: f64, translate_shared_via_site: bool, math: RepairMath) -> bool {
    if shares_net(&via.root_connection_name, Some(&segment.root_connection_name), conn_map) { return false; }
    let projection = point_to_segment_projection(via_xy(via), segment);
    let sx = via.x - projection.x;
    let sy = via.y - projection.y;
    let distance = (math.hypot)(sx, sy);
    let required = via.radius + segment.radius + RELAXED_TRACE_CLEARANCE + CLEARANCE_SLACK;
    let penetration = required - distance;
    if penetration <= 0.0 { return false; }
    let segment_x = segment.end.borrow().x - segment.start.borrow().x;
    let segment_y = segment.end.borrow().y - segment.start.borrow().y;
    let length = (math.hypot)(segment_x, segment_y);
    let sign = if via.route_index % 2 == 0 { 1.0 } else { -1.0 };
    let dx = if distance > POSITION_EPSILON { sx / distance } else if length > POSITION_EPSILON { (-segment_y / length) * sign } else { 1.0 };
    let dy = if distance > POSITION_EPSILON { sy / distance } else if length > POSITION_EPSILON { (segment_x / length) * sign } else { 0.0 };
    let movement = max_move.min(penetration / move_divisor);
    let moved_via = if translate_shared_via_site { translate_same_root_via_site(routes, via, dx * movement, dy * movement, srj, math) } else { move_via(routes, via, dx * movement, dy * movement, srj, math) };
    let moved_segment = move_segment_by_distribution(routes, segment, -dx * movement, -dy * movement, srj, projection.t, math);
    moved_via || moved_segment
}

fn push_segment_segment_pair(routes: &mut [MutableRoute], left: &Segment, right: &Segment, srj: &RepairSrj, conn_map: Option<&RepairConnectivityMap>, math: RepairMath) -> bool {
    if left.z != right.z || shares_net(&left.root_connection_name, Some(&right.root_connection_name), conn_map) { return false; }
    let candidates = get_segment_distance_candidates(left, right, math);
    let Some(candidate) = candidates.first() else { return false; };
    let sx = candidate.left_point.x - candidate.right_point.x;
    let sy = candidate.left_point.y - candidate.right_point.y;
    let distance = (math.hypot)(sx, sy);
    let required = left.radius + right.radius + RELAXED_TRACE_CLEARANCE + CLEARANCE_SLACK;
    let penetration = required - distance;
    if penetration <= 0.0 { return false; }
    let vx = left.end.borrow().x - left.start.borrow().x;
    let vy = left.end.borrow().y - left.start.borrow().y;
    let length = (math.hypot)(vx, vy);
    let sign = if (left.route_index + right.route_index) % 2 == 0 { 1.0 } else { -1.0 };
    let dx = if distance > POSITION_EPSILON { sx / distance } else if length > POSITION_EPSILON { (-vy / length) * sign } else { 1.0 };
    let dy = if distance > POSITION_EPSILON { sy / distance } else if length > POSITION_EPSILON { (vx / length) * sign } else { 0.0 };
    let movement = BROAD_MAX_MOVE.min(penetration / 2.0);
    let moved_left = move_segment_by_distribution(routes, left, dx * movement, dy * movement, srj, candidate.left_t, math);
    let moved_right = move_segment_by_distribution(routes, right, -dx * movement, -dy * movement, srj, candidate.right_t, math);
    moved_left || moved_right
}

fn obstacle_applies_to_segment(obstacle: &RepairObstacle, segment: &Segment) -> bool {
    obstacle.z_layers.contains(&segment.z)
}

fn repair_obstacle_shares_net(root: &str, obstacle: &RepairObstacle, conn_map: Option<&RepairConnectivityMap>) -> bool {
    repair_obstacle_shares_resolved_net(resolve_net_id(root, conn_map), obstacle)
}

fn repair_obstacle_shares_resolved_net(root: ResolvedNetId<'_>, obstacle: &RepairObstacle) -> bool {
    obstacle.connected_to.iter().zip(&obstacle.connected_to_net_ids).any(|(id, net_id)| {
        shares_resolved_net(root, ResolvedNetId { id, net_id: net_id.as_deref() })
    })
}

fn get_segment_rect_repulsion(segment: &Segment, obstacle: &RepairObstacle, required: f64, math: RepairMath) -> Option<SegmentRepulsion> {
    let half_width = obstacle.width / 2.0;
    let half_height = obstacle.height / 2.0;
    let center = obstacle.center;
    let corners = [Point { x: center.x - half_width, y: center.y - half_height }, Point { x: center.x + half_width, y: center.y - half_height }, Point { x: center.x + half_width, y: center.y + half_height }, Point { x: center.x - half_width, y: center.y + half_height }];
    let projected: Vec<_> = std::iter::once(center).chain(corners).map(|p| point_to_segment_projection(p, segment)).collect();
    let start = point_xy(&segment.start.borrow());
    let end = point_xy(&segment.end.borrow());
    let mut candidates = vec![(start, 0.0), (end, 1.0), (Point { x: (start.x + end.x) / 2.0, y: (start.y + end.y) / 2.0 }, 0.5)];
    candidates.extend(projected.into_iter().map(|p| (Point { x: p.x, y: p.y }, p.t)));
    let mut best: Option<SegmentRepulsion> = None;
    let length = (math.hypot)(end.x - start.x, end.y - start.y);
    for (point, t) in candidates {
        let Some(repulsion) = get_rect_repulsion(point, obstacle, required, math) else { continue; };
        let normality = if length > POSITION_EPSILON { (((end.x - start.x) * repulsion.direction.y - (end.y - start.y) * repulsion.direction.x) / length).abs() } else { 0.0 };
        if best.is_none_or(|b| repulsion.penetration > b.penetration + POSITION_EPSILON || ((repulsion.penetration - b.penetration).abs() <= POSITION_EPSILON && normality > b.normality)) {
            best = Some(SegmentRepulsion { direction: repulsion.direction, penetration: repulsion.penetration, normality, t });
        }
    }
    best
}

fn push_movables_away_from_obstacles(srj: &RepairSrj, routes: &mut [MutableRoute], vias: &mut [ViaNode], segments: &[Segment], via_index: &SpatialIndex, segment_index: &SpatialIndex, cell_size: f64, conn_map: Option<&RepairConnectivityMap>, math: RepairMath) -> bool {
    let mut changed = false;
    let trace_clearance = srj.trace_to_pad_clearance;
    let maximum_radius = segments.iter().fold(0.0f64, |m, s| m.max(s.radius));
    let search_distance = maximum_radius + trace_clearance + CLEARANCE_SLACK;
    let via_distance = srj.min_via_diameter / 2.0 + srj.via_to_pad_clearance + CLEARANCE_SLACK;
    for obstacle in &srj.obstacles {
        if obstacle.is_copper_pour { continue; }
        let bounds = get_obstacle_bounds(obstacle);
        for index in get_spatial_candidate_indexes(via_index, &expand_bounds_2d(&bounds, via_distance), cell_size) {
            let Some(via) = vias.get_mut(index) else { continue; };
            if repair_obstacle_shares_net(&via.root_connection_name, obstacle, conn_map) { continue; }
            let Some(repulsion) = get_rect_repulsion(via_xy(via), obstacle, via_distance, math) else { continue; };
            let movement = BROAD_MAX_MOVE.min(repulsion.penetration);
            changed = move_via(routes, via, repulsion.direction.x * movement, repulsion.direction.y * movement, srj, math) || changed;
        }
        for index in get_spatial_candidate_indexes(segment_index, &expand_bounds_2d(&bounds, search_distance), cell_size) {
            let Some(segment) = segments.get(index) else { continue; };
            if repair_obstacle_shares_net(&segment.root_connection_name, obstacle, conn_map) || !obstacle_applies_to_segment(obstacle, segment) { continue; }
            let Some(repulsion) = get_segment_rect_repulsion(segment, obstacle, segment.radius + trace_clearance + CLEARANCE_SLACK, math) else { continue; };
            let movement = BROAD_MAX_MOVE.min(repulsion.penetration);
            changed = move_segment_by_distribution(routes, segment, repulsion.direction.x * movement, repulsion.direction.y * movement, srj, repulsion.t, math) || changed;
        }
    }
    changed
}

fn apply_broad_repulsion_pass(srj: &RepairSrj, routes: &mut [MutableRoute], conn_map: Option<&RepairConnectivityMap>, allow_same_net_via_pairs: bool, math: RepairMath) -> bool {
    let mut changed = false;
    let mut vias = collect_via_nodes(routes, 0.3);
    let segments = collect_segments(routes);
    let distance = get_broad_spatial_interaction_distance(srj, &vias, &segments);
    let cell_size = BROAD_SPATIAL_CELL_SIZE_MIN.max(distance * 2.0);
    let via_index = create_spatial_index(&vias, get_via_bounds, cell_size);
    let segment_index = create_spatial_index(&segments, get_segment_bounds, cell_size);
    for left_index in 0..vias.len() {
        let nearby = get_spatial_candidate_indexes(&via_index, &expand_bounds_2d(&get_via_bounds(&vias[left_index]), distance), cell_size);
        for right_index in nearby {
            if right_index <= left_index || right_index >= vias.len() { continue; }
            let (before, after) = vias.split_at_mut(right_index);
            changed = push_via_via_pair(routes, &mut before[left_index], &mut after[0], srj, conn_map, BROAD_MAX_MOVE, allow_same_net_via_pairs, math) || changed;
        }
    }
    for via in &mut vias {
        let nearby = get_spatial_candidate_indexes(&segment_index, &expand_bounds_2d(&get_via_bounds(via), distance), cell_size);
        for index in nearby {
            let Some(segment) = segments.get(index) else { continue; };
            changed = push_via_segment_pair(routes, via, segment, srj, conn_map, BROAD_MAX_MOVE, 2.0, false, math) || changed;
        }
    }
    for left_index in 0..segments.len() {
        let left = &segments[left_index];
        let nearby = get_spatial_candidate_indexes(&segment_index, &expand_bounds_2d(&get_segment_bounds(left), distance), cell_size);
        for right_index in nearby {
            if right_index <= left_index { continue; }
            let Some(right) = segments.get(right_index) else { continue; };
            changed = push_segment_segment_pair(routes, left, right, srj, conn_map, math) || changed;
        }
    }
    push_movables_away_from_obstacles(srj, routes, &mut vias, &segments, &via_index, &segment_index, cell_size, conn_map, math) || changed
}

fn apply_broad_via_segment_cleanup_pass(srj: &RepairSrj, routes: &mut [MutableRoute], conn_map: Option<&RepairConnectivityMap>, math: RepairMath) -> bool {
    let mut changed = false;
    let mut vias = collect_via_nodes(routes, 0.3);
    let segments = collect_segments(routes);
    let distance = get_broad_spatial_interaction_distance(srj, &vias, &segments);
    let cell_size = BROAD_SPATIAL_CELL_SIZE_MIN.max(distance * 2.0);
    let segment_index = create_spatial_index(&segments, get_segment_bounds, cell_size);
    for via in &mut vias {
        let nearby = get_spatial_candidate_indexes(&segment_index, &expand_bounds_2d(&get_via_bounds(via), distance), cell_size);
        for index in nearby {
            let Some(segment) = segments.get(index) else { continue; };
            changed = push_via_segment_pair(routes, via, segment, srj, conn_map, BROAD_MAX_MOVE, 1.75, false, math) || changed;
        }
    }
    changed
}

pub(crate) fn apply_broad_repulsion_forces_compiled(srj: &RepairSrj, routes: &mut [MutableRoute], effort: f64, pass_multiplier: f64, conn_map: Option<&RepairConnectivityMap>, allow_same_net_via_pairs: bool, run_final_cleanup: bool, math: RepairMath) -> bool {
    let max_passes = 2.0f64.max((math.round)(BROAD_FORCE_PASSES as f64 * effort.max(1.0) * pass_multiplier));
    let mut changed = false;
    for _ in 0..max_passes as usize {
        if !apply_broad_repulsion_pass(srj, routes, conn_map, allow_same_net_via_pairs, math) { break; }
        changed = true;
    }
    if changed && run_final_cleanup { apply_broad_via_segment_cleanup_pass(srj, routes, conn_map, math); }
    changed
}

pub fn apply_broad_repulsion_forces(srj: &Value, routes: &mut [MutableRoute], effort: f64, pass_multiplier: f64, conn_map: Option<&Value>, allow_same_net_via_pairs: bool, run_final_cleanup: bool, math: RepairMath) -> bool {
    let conn_map: Option<RepairConnectivityMap> = conn_map.map(|value| serde_json::from_value(value.clone()).expect("Invalid connectivity snapshot"));
    let compiled_srj = RepairSrj::from_value(srj, conn_map.as_ref());
    apply_broad_repulsion_forces_compiled(&compiled_srj, routes, effort, pass_multiplier, conn_map.as_ref(), allow_same_net_via_pairs, run_final_cleanup, math)
}

pub(crate) fn derive_vias(route: &MutableRoute) -> Vec<Value> {
    let mut vias: Vec<Value> = Vec::new();
    for index in 0..route.route.len().saturating_sub(1) {
        let current = route.route[index].borrow();
        let next = route.route[index + 1].borrow();
        if current.metadata["toNextSegmentType"] == "through_obstacle" { continue; }
        if current.z == next.z || !are_same_xy(point_xy(&current), point_xy(&next)) { continue; }
        let via = json!({ "x": current.x, "y": current.y });
        if vias.last().is_some_and(|previous| are_same_xy(p(previous), p(&via))) { continue; }
        vias.push(via);
    }
    vias
}

fn materialize_route(route: &mut MutableRoute) -> Value {
    route.identity = crate::internal_types::next_identity();
    route.via_array_identity = crate::internal_types::next_identity();
    route.vias = derive_vias(route);
    route.to_value()
}

pub fn materialize_routes(routes: &mut [MutableRoute]) -> Value {
    Value::Array(routes.iter_mut().map(materialize_route).collect())
}

pub(crate) fn get_drc_error_type(error: &Value) -> Option<&str> {
    error["type"].as_str().or_else(|| error["error_type"].as_str())
}

pub(crate) fn is_trace_obstacle_drc_error(error: &Value) -> bool {
    if get_drc_error_type(error) == Some("pcb_pad_trace_clearance_error") { return true; }
    let message = error["message"].as_str().unwrap_or("").to_lowercase();
    (message.contains("pcb_trace") || message.contains("pcb trace")) && ["pcb_smtpad", "pcb_plated_hole", "pcb_hole", "pcb_keepout"].iter().any(|kind| message.contains(kind))
}

pub(crate) fn get_point_to_obstacle_distance(point: Point, obstacle: &RepairObstacle, math: RepairMath) -> f64 {
    let half_width = obstacle.width / 2.0;
    let half_height = obstacle.height / 2.0;
    let dx = ((point.x - obstacle.center.x).abs() - half_width).max(0.0);
    let dy = ((point.y - obstacle.center.y).abs() - half_height).max(0.0);
    (math.hypot)(dx, dy)
}

fn point_is_inside_rect_obstacle(point: Point, obstacle: &RepairObstacle) -> bool {
    point.x >= obstacle.center.x - obstacle.width / 2.0 - COORDINATE_EPSILON && point.x <= obstacle.center.x + obstacle.width / 2.0 + COORDINATE_EPSILON && point.y >= obstacle.center.y - obstacle.height / 2.0 - COORDINATE_EPSILON && point.y <= obstacle.center.y + obstacle.height / 2.0 + COORDINATE_EPSILON
}

fn get_same_net_obstacle_containing_point<'a>(srj: &'a RepairSrj, route: &MutableRoute, point: &RoutePoint, conn_map: Option<&RepairConnectivityMap>) -> Option<&'a RepairObstacle> {
    srj.obstacles.iter().find(|obstacle| repair_obstacle_shares_net(get_root_connection_name(route), obstacle, conn_map) && obstacle.z_layers.contains(&point.z) && point_is_inside_rect_obstacle(point_xy(point), obstacle))
}

fn get_nearest_obstacle_near_point<'a>(srj: &'a RepairSrj, point: Point, max_distance: f64, predicate: Option<&dyn Fn(&RepairObstacle) -> bool>, math: RepairMath) -> Option<&'a RepairObstacle> {
    let mut nearest: Option<(&RepairObstacle, f64)> = None;
    for obstacle in &srj.obstacles {
        if predicate.is_some_and(|test| !test(obstacle)) { continue; }
        let distance = get_point_to_obstacle_distance(point, obstacle, math);
        if distance > max_distance { continue; }
        if nearest.is_none_or(|n| distance < n.1) { nearest = Some((obstacle, distance)); }
    }
    nearest.map(|n| n.0)
}

fn get_repulsion_point_for_error(srj: &RepairSrj, error: &Value, center: Point, math: RepairMath) -> Point {
    if !error["message"].as_str().is_some_and(|message| message.contains("pcb_")) { return center; }
    let referenced: Vec<&str> = error["pcb_pad_ids"].as_array().map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
    if let Some(obstacle) = srj.obstacles.iter().find(|obstacle| referenced.iter().any(|id| obstacle.connected_to.iter().any(|connected| connected == id))) { return obstacle.center; }
    get_nearest_obstacle_near_point(srj, center, 0.6, None, math).map(|o| o.center).unwrap_or(center)
}

fn point_is_inside_board(srj: &RepairSrj, point: Point) -> bool {
    if srj.outline.len() >= 3 { point_is_inside_outline(point, &srj.outline) } else { point_is_inside_bounds(point, srj.bounds) }
}

fn get_endpoint_point_indexes_if_translation_preserves_connection(srj: &RepairSrj, route: &MutableRoute, index: usize, dx: f64, dy: f64, conn_map: Option<&RepairConnectivityMap>) -> Option<Vec<usize>> {
    let point = route.route.get(index)?.borrow();
    if point.metadata["pcb_port_id"].as_str().is_some_and(|s| !s.is_empty()) || (index != 0 && index != route.route.len() - 1) { return None; }
    let obstacle = get_same_net_obstacle_containing_point(srj, route, &point, conn_map)?;
    let next = Point { x: point.x + dx, y: point.y + dy };
    if !point_is_inside_board(srj, next) || !point_is_inside_rect_obstacle(next, obstacle) { return None; }
    get_coincident_point_indexes(route, index).into()
}

fn get_movable_or_connected_endpoint_point_indexes(srj: &RepairSrj, route: &MutableRoute, index: usize, dx: f64, dy: f64, conn_map: Option<&RepairConnectivityMap>) -> Option<Vec<usize>> {
    get_movable_coincident_point_indexes(route, index).or_else(|| get_endpoint_point_indexes_if_translation_preserves_connection(srj, route, index, dx, dy, conn_map))
}

fn move_segment_by_translation(routes: &mut [MutableRoute], segment: &Segment, dx: f64, dy: f64, srj: &RepairSrj, conn_map: Option<&RepairConnectivityMap>, math: RepairMath) -> bool {
    let Some(route) = routes.get_mut(segment.route_index) else { return false; };
    let Some(start) = get_movable_or_connected_endpoint_point_indexes(srj, route, segment.start_index, dx, dy, conn_map) else { return false; };
    let Some(end) = get_movable_or_connected_endpoint_point_indexes(srj, route, segment.end_index, dx, dy, conn_map) else { return false; };
    let indexes: Vec<usize> = start.into_iter().chain(end).collect::<IndexSet<_>>().into_iter().collect();
    move_route_point_indexes_by_translation(route, &indexes, dx, dy, srj, segment.radius, math)
}

fn move_route_point_indexes_by_translation(route: &mut MutableRoute, indexes: &[usize], dx: f64, dy: f64, srj: &RepairSrj, radius: f64, math: RepairMath) -> bool {
    let Some(translation) = get_safe_translation_for_point_indexes(srj, route, indexes, dx, dy, radius, math) else { return false; };
    let mut changed = false;
    for &index in indexes {
        let Some(point) = route.route.get(index) else { continue; };
        let mut point = point.borrow_mut();
        point.x += translation.x;
        point.y += translation.y;
        point.x = clamp_value(point.x, srj.bounds.min_x, srj.bounds.max_x);
        point.y = clamp_value(point.y, srj.bounds.min_y, srj.bounds.max_y);
        changed = true;
    }
    changed
}

fn route_endpoint_preserves_connection_after_translation(srj: &RepairSrj, route: &MutableRoute, index: usize, dx: f64, dy: f64, conn_map: Option<&RepairConnectivityMap>) -> bool {
    let Some(point) = route.route.get(index) else { return false; };
    let point = point.borrow();
    if point.metadata["pcb_port_id"].as_str().is_some_and(|s| !s.is_empty()) { return false; }
    let Some(obstacle) = get_same_net_obstacle_containing_point(srj, route, &point, conn_map) else { return false; };
    point_is_inside_rect_obstacle(Point { x: point.x + dx, y: point.y + dy }, obstacle)
}

fn get_endpoint_connection_obstacle<'a>(srj: &'a RepairSrj, route: &MutableRoute, index: usize, conn_map: Option<&RepairConnectivityMap>) -> Option<&'a RepairObstacle> {
    let point = route.route.get(index)?.borrow();
    if point.metadata["pcb_port_id"].as_str().is_some_and(|s| !s.is_empty()) { return None; }
    get_same_net_obstacle_containing_point(srj, route, &point, conn_map)
}

fn clamp_translation_to_endpoint_connection_obstacles(srj: &RepairSrj, route: &MutableRoute, dx: f64, dy: f64, conn_map: Option<&RepairConnectivityMap>) -> Option<Point> {
    let mut min_dx = f64::NEG_INFINITY;
    let mut max_dx = f64::INFINITY;
    let mut min_dy = f64::NEG_INFINITY;
    let mut max_dy = f64::INFINITY;
    for index in [0, route.route.len().checked_sub(1)?] {
        let point = route.route.get(index)?.borrow();
        let obstacle = get_endpoint_connection_obstacle(srj, route, index, conn_map)?;
        min_dx = min_dx.max(obstacle.center.x - obstacle.width / 2.0 - point.x);
        max_dx = max_dx.min(obstacle.center.x + obstacle.width / 2.0 - point.x);
        min_dy = min_dy.max(obstacle.center.y - obstacle.height / 2.0 - point.y);
        max_dy = max_dy.min(obstacle.center.y + obstacle.height / 2.0 - point.y);
    }
    if min_dx > max_dx || min_dy > max_dy { return None; }
    Some(Point { x: clamp_value(dx, min_dx, max_dx), y: clamp_value(dy, min_dy, max_dy) })
}

fn move_route_by_translation_preserving_endpoint_connections(routes: &mut [MutableRoute], route_index: usize, dx: f64, dy: f64, srj: &RepairSrj, radius: f64, conn_map: Option<&RepairConnectivityMap>, math: RepairMath) -> bool {
    let Some(route) = routes.get_mut(route_index).filter(|r| !r.route.is_empty()) else { return false; };
    let Some(endpoint_translation) = clamp_translation_to_endpoint_connection_obstacles(srj, route, dx, dy, conn_map) else { return false; };
    let indexes: Vec<_> = (0..route.route.len()).collect();
    let Some(translation) = get_safe_translation_for_point_indexes(srj, route, &indexes, endpoint_translation.x, endpoint_translation.y, radius, math) else { return false; };
    if !route_endpoint_preserves_connection_after_translation(srj, route, 0, translation.x, translation.y, conn_map) || !route_endpoint_preserves_connection_after_translation(srj, route, route.route.len() - 1, translation.x, translation.y, conn_map) { return false; }
    let mut changed = false;
    for point in &route.route {
        let mut point = point.borrow_mut();
        point.x += translation.x;
        point.y += translation.y;
        point.x = clamp_value(point.x, srj.bounds.min_x, srj.bounds.max_x);
        point.y = clamp_value(point.y, srj.bounds.min_y, srj.bounds.max_y);
        changed = true;
    }
    changed
}

fn route_has_internal_layer_transition(route: &MutableRoute) -> bool {
    route.route.windows(2).any(|pair| {
        let a = pair[0].borrow(); let b = pair[1].borrow();
        a.z != b.z && are_same_xy(point_xy(&a), point_xy(&b))
    })
}

fn segment_vectors_are_collinear(left: Point, middle: Point, right: Point) -> bool {
    let lx = middle.x - left.x;
    let ly = middle.y - left.y;
    let rx = right.x - middle.x;
    let ry = right.y - middle.y;
    (lx * ry - ly * rx).abs() <= COORDINATE_EPSILON
}

fn point_is_on_segment_line(point: &RoutePoint, segment: &Segment) -> bool {
    if point.z != segment.z { return false; }
    let start = segment.start.borrow(); let end = segment.end.borrow();
    let sx = end.x - start.x;
    let sy = end.y - start.y;
    let px = point.x - start.x;
    let py = point.y - start.y;
    (sx * py - sy * px).abs() <= COORDINATE_EPSILON
}

fn get_collinear_run_point_indexes(route: &MutableRoute, segment: &Segment) -> Vec<usize> {
    let start = segment.start.borrow(); let end = segment.end.borrow();
    let sx = end.x - start.x; let sy = end.y - start.y;
    let tolerance = COORDINATE_EPSILON.max(route.trace_thickness.unwrap_or(0.1) * 0.12);
    let horizontal = sy.abs() <= tolerance;
    let vertical = sx.abs() <= tolerance;
    let mut start_index = segment.start_index;
    let mut end_index = segment.end_index;
    if horizontal || vertical {
        let coordinate = if horizontal { (start.y + end.y) / 2.0 } else { (start.x + end.x) / 2.0 };
        while start_index > 0 {
            let Some(previous) = route.route.get(start_index - 1) else { break; };
            let previous = previous.borrow();
            if previous.z != segment.z || ((if horizontal { previous.y } else { previous.x }) - coordinate).abs() > tolerance { break; }
            start_index -= 1;
        }
        while end_index < route.route.len().saturating_sub(1) {
            let next = route.route[end_index + 1].borrow();
            if next.z != segment.z || ((if horizontal { next.y } else { next.x }) - coordinate).abs() > tolerance { break; }
            end_index += 1;
        }
        return (start_index..=end_index).collect();
    }
    while start_index > 0 {
        let (Some(previous), Some(current), Some(next)) = (route.route.get(start_index - 1), route.route.get(start_index), route.route.get(start_index + 1)) else { break; };
        let previous = previous.borrow(); let current = current.borrow(); let next = next.borrow();
        if previous.z != segment.z || !point_is_on_segment_line(&previous, segment) || !segment_vectors_are_collinear(point_xy(&previous), point_xy(&current), point_xy(&next)) { break; }
        start_index -= 1;
    }
    while end_index < route.route.len().saturating_sub(1) {
        let Some(previous) = end_index.checked_sub(1).and_then(|i| route.route.get(i)) else { break; };
        let (Some(current), Some(next)) = (route.route.get(end_index), route.route.get(end_index + 1)) else { break; };
        let previous = previous.borrow(); let current = current.borrow(); let next = next.borrow();
        if next.z != segment.z || !point_is_on_segment_line(&next, segment) || !segment_vectors_are_collinear(point_xy(&previous), point_xy(&current), point_xy(&next)) { break; }
        end_index += 1;
    }
    (start_index..=end_index).collect()
}

fn get_movable_collinear_run_point_indexes(route: &MutableRoute, segment: &Segment) -> Option<Vec<usize>> {
    let indexes = get_collinear_run_point_indexes(route, segment);
    if indexes.len() <= 2 { return None; }
    let mut movable = IndexSet::new();
    for index in indexes { movable.extend(get_movable_coincident_point_indexes(route, index)?); }
    Some(movable.into_iter().collect())
}

fn move_collinear_segment_run_by_translation(routes: &mut [MutableRoute], segment: &Segment, dx: f64, dy: f64, srj: &RepairSrj, math: RepairMath) -> bool {
    let Some(route) = routes.get_mut(segment.route_index) else { return false; };
    let Some(indexes) = get_movable_collinear_run_point_indexes(route, segment) else { return false; };
    move_route_point_indexes_by_translation(route, &indexes, dx, dy, srj, segment.radius, math)
}

fn route_point_is_layer_transition(route: &MutableRoute, index: usize) -> bool {
    let Some(point) = route.route.get(index) else { return false; };
    let point = point.borrow();
    let previous = index.checked_sub(1).and_then(|i| route.route.get(i));
    let next = route.route.get(index + 1);
    previous.into_iter().chain(next).any(|other| { let other = other.borrow(); other.z != point.z && are_same_xy(point_xy(&other), point_xy(&point)) })
}

fn route_point_can_move_as_local_span(route: &MutableRoute, index: usize) -> bool {
    index > 0 && index < route.route.len().saturating_sub(1) && !route_point_is_layer_transition(route, index)
}

fn segment_overlaps_bounds(segment: &Segment, bounds: Bounds2D) -> bool {
    let b = get_segment_bounds(segment);
    b.max_x >= bounds.min_x - COORDINATE_EPSILON && b.min_x <= bounds.max_x + COORDINATE_EPSILON && b.max_y >= bounds.min_y - COORDINATE_EPSILON && b.min_y <= bounds.max_y + COORDINATE_EPSILON
}

fn route_segment_can_join_local_obstacle_span(route: &MutableRoute, segment: &Segment, bounds: Bounds2D) -> bool {
    let (Some(start), Some(end)) = (route.route.get(segment.start_index), route.route.get(segment.end_index)) else { return false; };
    if start.borrow().z != segment.z || end.borrow().z != segment.z || !segment_overlaps_bounds(segment, bounds) { return false; }
    route_point_can_move_as_local_span(route, segment.start_index) || route_point_can_move_as_local_span(route, segment.end_index)
}

fn get_local_obstacle_span_point_indexes(route: &MutableRoute, segment: &Segment, obstacle: &RepairObstacle, required: f64) -> Vec<usize> {
    let bounds = expand_bounds_2d(&get_obstacle_bounds(obstacle), required);
    let mut start = segment.start_index;
    let mut end = segment.start_index;
    while start > 0 {
        let (Some(a), Some(b)) = (route.route.get(start - 1), route.route.get(start)) else { break; };
        let left = Segment { start_index: start - 1, end_index: start, start: a.clone(), end: b.clone(), ..segment.clone() };
        if !route_segment_can_join_local_obstacle_span(route, &left, bounds) { break; }
        start -= 1;
    }
    while end < route.route.len().saturating_sub(2) {
        let (Some(a), Some(b)) = (route.route.get(end + 1), route.route.get(end + 2)) else { break; };
        let right = Segment { start_index: end + 1, end_index: end + 2, start: a.clone(), end: b.clone(), ..segment.clone() };
        if !route_segment_can_join_local_obstacle_span(route, &right, bounds) { break; }
        end += 1;
    }
    (start..=end + 1).filter(|&i| route_point_can_move_as_local_span(route, i)).collect()
}

fn move_local_obstacle_span_by_translation(routes: &mut [MutableRoute], segment: &Segment, obstacle: &RepairObstacle, required: f64, dx: f64, dy: f64, srj: &RepairSrj, math: RepairMath) -> bool {
    let Some(route) = routes.get_mut(segment.route_index) else { return false; };
    let indexes = get_local_obstacle_span_point_indexes(route, segment, obstacle, required);
    if indexes.len() <= 2 { return false; }
    move_route_point_indexes_by_translation(route, &indexes, dx, dy, srj, segment.radius, math)
}

fn get_direction_away_from_point(segment: &Segment, point: Point, math: RepairMath) -> (Projection, Point) {
    let projection = point_to_segment_projection(point, segment);
    let sx = projection.x - point.x; let sy = projection.y - point.y;
    let distance = (math.hypot)(sx, sy);
    let vx = segment.end.borrow().x - segment.start.borrow().x;
    let vy = segment.end.borrow().y - segment.start.borrow().y;
    let length = (math.hypot)(vx, vy);
    let sign = if segment.route_index % 2 == 0 { 1.0 } else { -1.0 };
    let direction = if distance > POSITION_EPSILON { Point { x: sx / distance, y: sy / distance } } else if length > POSITION_EPSILON { Point { x: (-vy / length) * sign, y: (vx / length) * sign } } else { Point { x: 1.0, y: 0.0 } };
    (projection, direction)
}

fn insert_detour_point_away_from_point(routes: &mut [MutableRoute], segment: &Segment, point: Point, srj: &RepairSrj, scale: f64, math: RepairMath) -> bool {
    let Some(route) = routes.get_mut(segment.route_index) else { return false; };
    let (projection, direction) = get_direction_away_from_point(segment, point, math);
    let translation = clip_point_translation_away_from_board_edge(srj, Point { x: projection.x, y: projection.y }, direction.x * MAX_ERROR_MOVE * scale, direction.y * MAX_ERROR_MOVE * scale, segment.radius, math);
    if translation.x.abs() <= POSITION_EPSILON && translation.y.abs() <= POSITION_EPSILON { return false; }
    let mut detour = route.route[segment.start_index].borrow().clone();
    detour.x = clamp_value(projection.x + translation.x, srj.bounds.min_x, srj.bounds.max_x);
    detour.y = clamp_value(projection.y + translation.y, srj.bounds.min_y, srj.bounds.max_y);
    let detour_xy = point_xy(&detour);
    if point_to_segment_distance(&detour_xy, &point_xy(&segment.start.borrow()), &point_xy(&segment.end.borrow())) <= COORDINATE_EPSILON { return false; }
    let (Some(start), Some(end)) = (route.route.get(segment.start_index), route.route.get(segment.end_index)) else { return false; };
    let start = point_xy(&start.borrow()); let end = point_xy(&end.borrow());
    let current = get_segment_board_clearance(srj, start, end);
    let next = get_point_board_clearance(srj, detour_xy).min(get_segment_board_clearance(srj, start, detour_xy)).min(get_segment_board_clearance(srj, detour_xy, end));
    if next < segment.radius - COORDINATE_EPSILON || move_reduces_clearance_into_board_edge_zone(current, next, get_board_edge_proximity_threshold(srj, segment.radius)) { return false; }
    route.route.insert(segment.end_index, std::rc::Rc::new(std::cell::RefCell::new(detour)));
    true
}

fn move_segment_away_from_point(routes: &mut [MutableRoute], segment: &Segment, point: Point, srj: &RepairSrj, scale: f64, math: RepairMath) -> bool {
    let (projection, direction) = get_direction_away_from_point(segment, point, math);
    let movement = MAX_ERROR_MOVE * scale;
    let start_weight = 1.0 - projection.t;
    let end_weight = projection.t;
    let start = move_route_point(routes, segment.route_index, segment.start_index, direction.x * movement * start_weight, direction.y * movement * start_weight, srj, segment.radius, math);
    let end = move_route_point(routes, segment.route_index, segment.end_index, direction.x * movement * end_weight, direction.y * movement * end_weight, srj, segment.radius, math);
    if start || end { return true; }
    insert_detour_point_away_from_point(routes, segment, point, srj, scale, math)
}

fn move_segment_away_from_obstacle(routes: &mut [MutableRoute], segment: &Segment, obstacle: &RepairObstacle, srj: &RepairSrj, conn_map: Option<&RepairConnectivityMap>, scale: f64, math: RepairMath) -> bool {
    let required = segment.radius + srj.trace_to_pad_clearance + CLEARANCE_SLACK;
    let Some(repulsion) = get_segment_rect_repulsion(segment, obstacle, required, math) else { return false; };
    let movement = (TRACE_PAD_REPAIR_MAX_MOVE * scale.abs()).min(repulsion.penetration + CLEARANCE_SLACK);
    let dx = repulsion.direction.x * movement;
    let dy = repulsion.direction.y * movement;
    let Some(route) = routes.get(segment.route_index) else { return false; };
    let try_translation_first = !route_has_internal_layer_transition(route);
    if try_translation_first && move_route_by_translation_preserving_endpoint_connections(routes, segment.route_index, dx, dy, srj, segment.radius, conn_map, math) { return true; }
    if move_local_obstacle_span_by_translation(routes, segment, obstacle, required, dx, dy, srj, math) || move_collinear_segment_run_by_translation(routes, segment, dx, dy, srj, math) || move_segment_by_translation(routes, segment, dx, dy, srj, conn_map, math) { return true; }
    if !try_translation_first && move_route_by_translation_preserving_endpoint_connections(routes, segment.route_index, dx, dy, srj, segment.radius, conn_map, math) { return true; }
    let route = &mut routes[segment.route_index];
    let half_width = obstacle.width / 2.0;
    let half_height = obstacle.height / 2.0;
    let mut points = [route.route[segment.start_index].borrow().clone(), route.route[segment.start_index].borrow().clone()];
    if repulsion.direction.y.abs() >= repulsion.direction.x.abs() {
        points[0].x = obstacle.center.x - half_width - required;
        points[0].y = obstacle.center.y + repulsion.direction.y * (half_height + required);
        points[1].x = obstacle.center.x + half_width + required;
        points[1].y = obstacle.center.y + repulsion.direction.y * (half_height + required);
    } else {
        points[0].x = obstacle.center.x + repulsion.direction.x * (half_width + required);
        points[0].y = obstacle.center.y - half_height - required;
        points[1].x = obstacle.center.x + repulsion.direction.x * (half_width + required);
        points[1].y = obstacle.center.y + half_height + required;
    }
    let mut ordered: Vec<_> = points.into_iter().map(|mut point| {
        let t = point_to_segment_projection(point_xy(&point), segment).t;
        let start = point_xy(&segment.start.borrow()); let end = point_xy(&segment.end.borrow());
        let projection = Point { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
        let translation = clip_point_translation_away_from_board_edge(srj, projection, point.x - projection.x, point.y - projection.y, segment.radius, math);
        point.x = clamp_value(projection.x + translation.x, srj.bounds.min_x, srj.bounds.max_x);
        point.y = clamp_value(projection.y + translation.y, srj.bounds.min_y, srj.bounds.max_y);
        let moved = translation.x.abs() > POSITION_EPSILON || translation.y.abs() > POSITION_EPSILON;
        let away = translation.x * repulsion.direction.x + translation.y * repulsion.direction.y;
        (point, t, moved, away)
    }).collect();
    ordered.sort_by(|a, b| (a.1 - b.1).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal));
    if !ordered.iter().any(|p| p.2) || !ordered.iter().any(|p| p.3 > COORDINATE_EPSILON) { return false; }
    let points: Vec<RoutePoint> = ordered.into_iter().map(|p| p.0).collect();
    if points.iter().all(|point| point_to_segment_distance(&point_xy(point), &point_xy(&segment.start.borrow()), &point_xy(&segment.end.borrow())) <= COORDINATE_EPSILON) { return false; }
    if points.iter().any(|point| !point_is_inside_board(srj, point_xy(point))) { return false; }
    let (Some(start), Some(end)) = (route.route.get(segment.start_index), route.route.get(segment.end_index)) else { return false; };
    let start = point_xy(&start.borrow()); let end = point_xy(&end.borrow());
    let first = point_xy(&points[0]); let second = point_xy(&points[1]);
    let current = get_segment_board_clearance(srj, start, end);
    let next = get_point_board_clearance(srj, first).min(get_point_board_clearance(srj, second)).min(get_segment_board_clearance(srj, start, first)).min(get_segment_board_clearance(srj, first, second)).min(get_segment_board_clearance(srj, second, end));
    if next < segment.radius - COORDINATE_EPSILON || move_reduces_clearance_into_board_edge_zone(current, next, get_board_edge_proximity_threshold(srj, segment.radius)) { return false; }
    route.route.splice(segment.end_index..segment.end_index, points.into_iter().map(|point| std::rc::Rc::new(std::cell::RefCell::new(point))));
    true
}

fn get_nearest_segment<'a>(segments: &'a [Segment], point: Point, route_index: Option<usize>, math: RepairMath) -> Option<&'a Segment> {
    let mut best: Option<(&Segment, f64)> = None;
    for segment in segments {
        if route_index.is_some_and(|index| segment.route_index != index) { continue; }
        let projection = point_to_segment_projection(point, segment);
        let distance = (math.hypot)(projection.x - point.x, projection.y - point.y);
        if best.is_none_or(|b| distance < b.1) { best = Some((segment, distance)); }
    }
    best.map(|b| b.0)
}

fn get_nearest_via(vias: &[ViaNode], point: Point, route_index: Option<usize>, math: RepairMath) -> Option<usize> {
    let mut best: Option<(usize, f64)> = None;
    for (index, via) in vias.iter().enumerate() {
        if route_index.is_some_and(|index| via.route_index != index) { continue; }
        let distance = (math.hypot)(via.x - point.x, via.y - point.y);
        if best.is_none_or(|b| distance < b.1) { best = Some((index, distance)); }
    }
    best.map(|b| b.0)
}

fn get_nearest_via_pair(vias: &[ViaNode], point: Point, math: RepairMath) -> Option<[usize; 2]> {
    let mut nearest: Vec<_> = vias.iter().enumerate().map(|(index, via)| (index, (math.hypot)(via.x - point.x, via.y - point.y))).collect();
    nearest.sort_by(|a, b| (a.1 - b.1).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal));
    if nearest.len() >= 2 { Some([nearest[0].0, nearest[1].0]) } else { None }
}

fn move_via_away_from_point(routes: &mut [MutableRoute], via: &mut ViaNode, point: Point, srj: &RepairSrj, math: RepairMath) -> bool {
    let sx = via.x - point.x; let sy = via.y - point.y;
    let distance = (math.hypot)(sx, sy);
    let dx = if distance > POSITION_EPSILON { sx / distance } else { 1.0 };
    let dy = if distance > POSITION_EPSILON { sy / distance } else { 0.0 };
    move_via(routes, via, dx * MAX_ERROR_MOVE, dy * MAX_ERROR_MOVE, srj, math)
}

fn try_canonicalize_via(routes: &mut [MutableRoute], keep: &ViaNode, moving: &mut ViaNode, srj: &RepairSrj, math: RepairMath) -> bool {
    if !moving.can_canonicalize { return false; }
    let dx = keep.x - moving.x; let dy = keep.y - moving.y;
    if !moving.movable && (math.hypot)(dx, dy) > moving.radius + COORDINATE_EPSILON { return false; }
    let Some(route) = routes.get(moving.route_index) else { return false; };
    let previous = via_xy(moving);
    let previous_points: Vec<_> = moving.point_indexes.iter().filter_map(|&index| route.route.get(index).map(|p| (index, point_xy(&p.borrow())))).collect();
    let moved = translate_via(routes, moving, dx, dy, srj, math);
    if moved && are_same_xy(via_xy(moving), via_xy(keep)) { return true; }
    moving.x = previous.x; moving.y = previous.y;
    for (index, previous) in previous_points {
        if let Some(point) = routes[moving.route_index].route.get(index) { let mut point = point.borrow_mut(); point.x = previous.x; point.y = previous.y; }
    }
    false
}

fn canonicalize_same_net_via_pair(routes: &mut [MutableRoute], left: &mut ViaNode, right: &mut ViaNode, srj: &RepairSrj, conn_map: Option<&RepairConnectivityMap>, math: RepairMath) -> bool {
    if !shares_net(&left.root_connection_name, Some(&right.root_connection_name), conn_map) { return false; }
    if !left.can_canonicalize { try_canonicalize_via(routes, left, right, srj, math) }
    else if !right.can_canonicalize { try_canonicalize_via(routes, right, left, srj, math) }
    else if left.route_index <= right.route_index { try_canonicalize_via(routes, left, right, srj, math) }
    else { try_canonicalize_via(routes, right, left, srj, math) }
}

fn get_nearest_trace_obstacle_segment_pair<'a>(srj: &'a RepairSrj, routes: &[MutableRoute], route_index: usize, center: Point, conn_map: Option<&RepairConnectivityMap>, math: RepairMath) -> Option<(&'a RepairObstacle, Segment)> {
    let route = routes.get(route_index)?;
    let segments = collect_segments_for_route(route, route_index);
    if segments.is_empty() { return None; }
    let root = srj.resolved_nets.resolve(get_root_connection_name(route), conn_map);
    let nearest = get_nearest_segment(&segments, center, None, math)?;
    if let Some(obstacle) = get_nearest_obstacle_near_point(srj, center, 0.6, Some(&|candidate| !candidate.interned_connected_to.iter().any(|&id| shares_interned_resolved_net(root, id)) && obstacle_applies_to_segment(candidate, nearest)), math) { return Some((obstacle, nearest.clone())); }
    let obstacle = get_nearest_obstacle_near_point(srj, center, 0.6, Some(&|candidate| !candidate.interned_connected_to.iter().any(|&id| shares_interned_resolved_net(root, id)) && segments.iter().any(|segment| obstacle_applies_to_segment(candidate, segment))), math)?;
    let candidates: Vec<Segment> = segments.into_iter().filter(|candidate| obstacle_applies_to_segment(obstacle, candidate)).collect();
    let segment = get_nearest_segment(&candidates, center, None, math)?;
    Some((obstacle, segment.clone()))
}

fn parse_trace_route_index(error: &Value) -> Option<usize> {
    let id = error["pcb_trace_id"].as_str()?.strip_prefix("trace_")?;
    let digits: String = id.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() { return None; }
    digits.parse::<usize>().ok()
}

pub(crate) fn get_error_center(error: &Value) -> Option<Point> {
    let center = if error["center"].is_null() { &error["pcb_center"] } else { &error["center"] };
    Some(Point { x: center["x"].as_f64()?, y: center["y"].as_f64()? })
}

pub(crate) fn is_via_pad_drc_error(error: &Value) -> bool {
    get_drc_error_type(error) == Some("pcb_pad_pad_clearance_error") && error["pcb_via_ids"].as_array().is_some_and(|ids| ids.len() == 1)
}

pub(crate) fn get_trace_route_index_for_error(error: &Value, index: &indexmap::IndexMap<String, usize>) -> Option<usize> {
    error["pcb_trace_id"].as_str().and_then(|id| index.get(id).copied()).or_else(|| parse_trace_route_index(error))
}

pub(crate) fn get_trace_route_pair_for_error(error: &Value, index: &indexmap::IndexMap<String, usize>) -> Option<[usize; 2]> {
    let primary = error["pcb_trace_id"].as_str()?;
    if error["pcb_via_ids"].as_array().is_some_and(|ids| !ids.is_empty()) { return None; }
    let explicit: Vec<&str> = error["pcb_trace_ids"].as_array().map(|ids| ids.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
    let prefix = format!("overlap_{primary}_");
    let encoded = error["pcb_trace_error_id"].as_str().and_then(|id| id.strip_prefix(&prefix)).filter(|id| !id.is_empty());
    let indexes: IndexSet<usize> = std::iter::once(primary).chain(explicit).chain(encoded).filter_map(|id| index.get(id).copied()).collect();
    if indexes.len() >= 2 { Some([indexes[0], indexes[1]]) } else { None }
}

pub(crate) fn apply_drc_error_forces(srj: &RepairSrj, routes: &mut [MutableRoute], errors: &[Value], trace_index: &indexmap::IndexMap<String, usize>, scale: f64, conn_map: Option<&RepairConnectivityMap>, enable_canonical_pair_repairs: bool, enable_same_net_via_canonicalization: bool, allow_shared_via_site_move: bool, enable_trace_via_owner_targeting: bool, math: RepairMath) -> bool {
    let mut changed = false;
    let mut vias = collect_via_nodes(routes, 0.3);
    let segments = collect_segments(routes);
    for error in errors {
        let Some(center) = get_error_center(error) else { continue; };
        let mut repulsion_point = center;
        let via_ids = error["pcb_via_ids"].as_array();
        let is_via_pair_error = get_drc_error_type(error) == Some("pcb_via_clearance_error");
        let is_via_pad_error = is_via_pad_drc_error(error);
        let has_reported_via_ids = via_ids.is_some_and(|ids| !ids.is_empty());
        let has_trace_via_metadata = !is_via_pair_error && !is_via_pad_error && has_reported_via_ids && (error["pcb_trace_id"].is_string() || error["pcb_trace_ids"].is_array());
        let targeted = enable_trace_via_owner_targeting && has_trace_via_metadata;
        if has_reported_via_ids && !has_trace_via_metadata {
            repulsion_point = get_repulsion_point_for_error(srj, error, center, math);
            let route_index = get_trace_route_index_for_error(error, trace_index);
            let pair = if via_ids.is_some_and(|ids| ids.len() > 1) { get_nearest_via_pair(&vias, center, math) } else { None };
            if let Some([left, right]) = pair {
                let canonicalize = enable_same_net_via_canonicalization && is_via_pair_error && error["pcb_via_pair_net_relation"] == "same_net";
                let canonical_pair = enable_canonical_pair_repairs && is_via_pair_error;
                let (a, b) = if left < right { let (before, after) = vias.split_at_mut(right); (&mut before[left], &mut after[0]) } else { let (before, after) = vias.split_at_mut(left); (&mut after[0], &mut before[right]) };
                changed = (if canonicalize { canonicalize_same_net_via_pair(routes, a, b, srj, conn_map, math) } else { push_via_via_pair(routes, a, b, srj, conn_map, VIA_PAIR_REPAIR_MAX_MOVE * scale.abs(), canonical_pair, math) }) || changed;
            } else if let Some(index) = get_nearest_via(&vias, center, route_index, math) { changed = move_via_away_from_point(routes, &mut vias[index], repulsion_point, srj, math) || changed; }
            continue;
        }
        let trace_id = error["pcb_trace_id"].as_str();
        let route_index = get_trace_route_index_for_error(error, trace_index);
        if targeted && route_index.is_none() { continue; }
        let explicit: Vec<&str> = error["pcb_trace_ids"].as_array().map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
        let promoted = targeted && trace_id.is_some() && route_index.is_some() && explicit.contains(&trace_id.unwrap()) && explicit.iter().any(|id| Some(*id) != trace_id && !trace_index.contains_key(*id));
        if promoted {
            if let Some(index) = get_nearest_via(&vias, center, route_index, math) { changed = move_via_away_from_point(routes, &mut vias[index], center, srj, math) || changed; continue; }
        }
        let pair = if enable_canonical_pair_repairs && !has_trace_via_metadata { get_trace_route_pair_for_error(error, trace_index) } else { None };
        if let Some([left, right]) = pair {
            if let (Some(left), Some(right)) = (get_nearest_segment(&segments, center, Some(left), math), get_nearest_segment(&segments, center, Some(right), math)) {
                if push_segment_segment_pair(routes, left, right, srj, conn_map, math) { changed = true; continue; }
            }
        }
        let obstacle_error = is_trace_obstacle_drc_error(error);
        let obstacle_pair = if obstacle_error { route_index.and_then(|index| get_nearest_trace_obstacle_segment_pair(srj, routes, index, center, conn_map, math)) } else { None };
        let nearest_segment = if obstacle_error { obstacle_pair.as_ref().map(|pair| &pair.1) } else { get_nearest_segment(&segments, center, route_index, math) };
        if let Some(segment) = nearest_segment {
            let obstacle = if obstacle_error { obstacle_pair.as_ref().map(|pair| pair.0) } else { get_nearest_obstacle_near_point(srj, center, 0.6, None, math) };
            if obstacle_error && obstacle.is_none() { continue; }
            repulsion_point = if obstacle_error { obstacle.map(|o| o.center).unwrap_or(center) } else { get_repulsion_point_for_error(srj, error, center, math) };
            let nearest_via = if targeted { None } else { get_nearest_via(&vias, center, None, math) };
            let exact_via_trace = get_drc_error_type(error) == Some("pcb_via_trace_clearance_error");
            let error_id = error["pcb_trace_error_id"].as_str().unwrap_or("").to_lowercase();
            let message = error["message"].as_str().unwrap_or("").to_lowercase();
            let identifies_via = exact_via_trace || error["pcb_via_id"].is_string() || error["pcb_via_ids"].is_array() || error_id.contains("_via_") || message.contains("via");
            let involves_port = error["pcb_port_ids"].as_array().is_some_and(|ids| !ids.is_empty());
            if let Some(index) = nearest_via {
                let via = &mut vias[index];
                if !shares_net(&via.root_connection_name, Some(&segment.root_connection_name), conn_map) && (exact_via_trace || (math.hypot)(via.x - center.x, via.y - center.y) < 0.45) {
                    if push_via_segment_pair(routes, via, segment, srj, conn_map, TRACE_PAD_REPAIR_MAX_MOVE * scale.abs(), 1.0, allow_shared_via_site_move, math) {
                        changed = true;
                        if identifies_via && !involves_port { continue; }
                    }
                }
            }
            let obstacle_move = obstacle.is_some_and(|o| obstacle_error || (!repair_obstacle_shares_net(&segment.root_connection_name, o, conn_map) && obstacle_applies_to_segment(o, segment)));
            let moved = if obstacle_move { move_segment_away_from_obstacle(routes, segment, obstacle.unwrap(), srj, conn_map, scale, math) } else { move_segment_away_from_point(routes, segment, repulsion_point, srj, scale, math) };
            changed = moved || changed;
        }
        if !targeted {
            if let Some(index) = get_nearest_via(&vias, center, None, math) {
                if (math.hypot)(vias[index].x - center.x, vias[index].y - center.y) < 0.35 { changed = move_via_away_from_point(routes, &mut vias[index], repulsion_point, srj, math) || changed; }
            }
        }
    }
    changed
}

impl BroadRepulsionEngine {
    pub fn new(srj: Value, conn_map: Option<Value>, math: RepairMath) -> Self {
        let conn_map: Option<RepairConnectivityMap> = conn_map.map(|value| serde_json::from_value(value).expect("Invalid connectivity snapshot"));
        let pad_context = PadClearanceContext::new(&srj, &math, conn_map.as_ref());
        Self { srj: RepairSrj::from_value(&srj, conn_map.as_ref()), pad_context, conn_map, math }
    }

    pub fn set_connectivity(&mut self, conn_map: Option<Value>) {
        self.conn_map = conn_map.map(|value| serde_json::from_value(value).expect("Invalid connectivity snapshot"));
        for obstacle in &mut self.srj.obstacles {
            obstacle.interned_connected_to = obstacle.connected_to.iter()
                .map(|id| self.srj.resolved_nets.resolve(id, self.conn_map.as_ref())).collect();
            obstacle.connected_to_net_ids = obstacle.connected_to.iter()
                .map(|id| resolve_net_id(id, self.conn_map.as_ref()).net_id.map(str::to_owned)).collect();
        }
        self.pad_context.set_connectivity(self.conn_map.as_ref());
    }

    pub fn run(&self, routes: Value, effort: f64, pass_multiplier: f64, allow_same_net_via_pairs: bool, run_final_cleanup: bool) -> Value {
        let mut mutable_routes: Vec<_> = routes.as_array().expect("Routes required").iter().map(MutableRoute::from_value).collect();
        let changed = apply_broad_repulsion_forces_compiled(&self.srj, &mut mutable_routes, effort, pass_multiplier, self.conn_map.as_ref(), allow_same_net_via_pairs, run_final_cleanup, self.math);
        let output = if changed { materialize_routes(&mut mutable_routes) } else { routes };
        json!({ "changed": changed, "routes": output })
    }
}

impl BroadRepulsionEngine {
    pub fn apply_error_forces(&self, routes: Value, errors: Value, trace_index: Value, scale: f64, enable_canonical_pair_repairs: bool, enable_same_net_via_canonicalization: bool, allow_shared_via_site_move: bool, enable_trace_via_owner_targeting: bool) -> Value {
        let Value::Array(routes) = routes else { panic!("Routes required"); };
        let mut mutable_routes: Vec<_> = routes.into_iter().map(MutableRoute::from_owned_value).collect();
        let original_points: Vec<Vec<(usize, u64, u64, u64)>> = mutable_routes.iter().map(|route| route.route.iter().map(|point| {
            let coordinates = point.borrow();
            (std::rc::Rc::as_ptr(point) as usize, coordinates.x.to_bits(), coordinates.y.to_bits(), coordinates.z.to_bits())
        }).collect()).collect();
        let trace_index: indexmap::IndexMap<String, usize> = serde_json::from_value(trace_index).expect("Invalid trace route index map");
        let changed = apply_drc_error_forces(&self.srj, &mut mutable_routes, errors.as_array().expect("Errors required"), &trace_index, scale, self.conn_map.as_ref(), enable_canonical_pair_repairs, enable_same_net_via_canonicalization, allow_shared_via_site_move, enable_trace_via_owner_targeting, self.math);
        let mut route_indexes = Vec::new();
        let mut point_origins: Vec<Vec<Option<usize>>> = Vec::new();
        let mut output = Vec::new();
        for (route_index, (route, original)) in mutable_routes.iter().zip(&original_points).enumerate() {
            let unchanged = route.route.len() == original.len() && route.route.iter().zip(original).all(|(point, previous)| {
                let coordinates = point.borrow();
                std::rc::Rc::as_ptr(point) as usize == previous.0 && coordinates.x.to_bits() == previous.1 && coordinates.y.to_bits() == previous.2 && coordinates.z.to_bits() == previous.3
            });
            if unchanged { continue; }
            let origins: std::collections::HashMap<usize, usize> = original.iter().enumerate().map(|(index, point)| (point.0, index)).collect();
            route_indexes.push(route_index);
            point_origins.push(route.route.iter().map(|point| origins.get(&(std::rc::Rc::as_ptr(point) as usize)).copied()).collect());
            output.push(route.to_value());
        }
        json!({ "changed": changed, "routes": output, "routeIndexes": route_indexes, "pointOrigins": point_origins })
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum EndpointSide { Start, End }

#[derive(Clone, Copy)]
pub(crate) enum SafeTraceLayerMoveSpanExpansion { Count(usize), Full }

pub(crate) const SAFE_TRACE_LAYER_DIRECTION_VARIANT_COUNT: usize = 64;

pub(crate) fn clone_routes_for_indexes(routes: &[MutableRoute], indexes: &[usize]) -> Vec<MutableRoute> {
    routes.iter().enumerate().map(|(index, route)| {
        if indexes.contains(&index) { return route.clone(); }
        MutableRoute { identity: route.identity, point_array_identity: route.point_array_identity, via_array_identity: route.via_array_identity, connection_name: route.connection_name.clone(), root_connection_name: route.root_connection_name.clone(),
            trace_thickness: route.trace_thickness, via_diameter: route.via_diameter,
            route: route.route.clone(), vias: route.vias.clone(), metadata: route.metadata.clone() }
    }).collect()
}

fn copied_point(point: &RoutePoint, xy: Option<Point>, z: Option<f64>, clear_port: bool) -> RoutePoint {
    let mut result = point.clone();
    if let Some(xy) = xy { result.x = xy.x; result.y = xy.y; }
    if let Some(z) = z { result.z = z; }
    if clear_port { Rc::make_mut(&mut result.metadata).as_object_mut().expect("Point metadata object").remove("pcb_port_id"); }
    result
}

fn point_ref(point: RoutePoint) -> Rc<RefCell<RoutePoint>> {
    Rc::new(RefCell::new(point))
}

fn has_port(point: &RoutePoint) -> bool {
    point.metadata["pcb_port_id"].as_str().is_some_and(|id| !id.is_empty())
}

fn is_route_endpoint_eligible_for_via_in_pad(srj: &RepairSrj, route: &MutableRoute, endpoint: &RoutePoint, conn_map: Option<&RepairConnectivityMap>, via_hole_diameter: Option<f64>) -> bool {
    let Some(port) = endpoint.metadata["pcb_port_id"].as_str().filter(|id| !id.is_empty()) else { return false; };
    let radius = via_hole_diameter.or(route.via_diameter).unwrap_or(f64::NAN) / 2.0;
    srj.obstacles.iter().any(|obstacle| {
        if obstacle.z_layers.len() != 1 || obstacle.z_layers[0] != endpoint.z || !obstacle.connected_to.iter().any(|id| id == port)
            || endpoint.x - radius < obstacle.center.x - obstacle.width / 2.0 - POSITION_EPSILON
            || endpoint.x + radius > obstacle.center.x + obstacle.width / 2.0 + POSITION_EPSILON
            || endpoint.y - radius < obstacle.center.y - obstacle.height / 2.0 - POSITION_EPSILON
            || endpoint.y + radius > obstacle.center.y + obstacle.height / 2.0 + POSITION_EPSILON { return false; }
        repair_obstacle_shares_net(get_root_connection_name(route), obstacle, conn_map)
            || repair_obstacle_shares_net(&route.connection_name, obstacle, conn_map)
    })
}

fn get_route_endpoint_pad<'a>(srj: &'a RepairSrj, route: &MutableRoute, endpoint: &RoutePoint, conn_map: Option<&RepairConnectivityMap>) -> Option<&'a RepairObstacle> {
    let port = endpoint.metadata["pcb_port_id"].as_str().filter(|id| !id.is_empty())?;
    srj.obstacles.iter().find(|obstacle| obstacle.z_layers.len() == 1 && obstacle.z_layers[0] == endpoint.z
        && obstacle.connected_to.iter().any(|id| id == port) && point_is_inside_rect_obstacle(endpoint.point(), obstacle)
        && (repair_obstacle_shares_net(get_root_connection_name(route), obstacle, conn_map) || repair_obstacle_shares_net(&route.connection_name, obstacle, conn_map)))
}

fn terminal_escape_rotation_pairs() -> Vec<[f64; 2]> {
    let turns = [0.0_f64, 1.0, -1.0, 2.0, -2.0, 3.0, -3.0, 4.0];
    let mut pairs: Vec<[f64; 2]> = turns.iter().flat_map(|&start| turns.iter().map(move |&end| [start, end])).collect();
    pairs.sort_by(|a, b| (a[0].abs() + a[1].abs()).partial_cmp(&(b[0].abs() + b[1].abs())).unwrap());
    pairs
}

fn get_terminal_tangent(points: &[RoutePoint], side: EndpointSide, math: RepairMath) -> Option<Point> {
    let endpoint = if side == EndpointSide::Start { points.first()? } else { points.last()? };
    let indexes: Vec<usize> = if side == EndpointSide::Start { (1..points.len()).collect() } else { (0..points.len() - 1).rev().collect() };
    for index in indexes {
        let dx = points[index].x - endpoint.x;
        let dy = points[index].y - endpoint.y;
        let length = (math.hypot)(dx, dy);
        if length <= POSITION_EPSILON { continue; }
        return Some(Point { x: dx / length, y: dy / length });
    }
    None
}

fn rotate_direction(direction: Point, eighth_turns: f64, math: RepairMath) -> Point {
    let angle = (eighth_turns * std::f64::consts::PI) / 4.0;
    let cos = (math.cos)(angle);
    let sin = (math.sin)(angle);
    Point { x: direction.x * cos - direction.y * sin, y: direction.x * sin + direction.y * cos }
}

fn get_external_via_point(endpoint: Point, pad: &RepairObstacle, direction: Point, radius: f64, math: RepairMath) -> Option<Point> {
    let mut inside = 0.0;
    let mut outside = (math.hypot)(pad.width, pad.height) + radius * 2.0;
    let required = radius + POSITION_EPSILON;
    let at = |distance: f64| Point { x: endpoint.x + direction.x * distance, y: endpoint.y + direction.y * distance };
    if get_point_to_obstacle_distance(at(outside), pad, math) < required { return None; }
    while outside - inside > POSITION_EPSILON {
        let candidate = (inside + outside) / 2.0;
        if get_point_to_obstacle_distance(at(candidate), pad, math) >= required { outside = candidate; } else { inside = candidate; }
    }
    Some(at(outside))
}

fn is_via_inside_bounds(point: Point, radius: f64, bounds: Bounds2D) -> bool {
    point.x - radius >= bounds.min_x - POSITION_EPSILON && point.x + radius <= bounds.max_x + POSITION_EPSILON
        && point.y - radius >= bounds.min_y - POSITION_EPSILON && point.y + radius <= bounds.max_y + POSITION_EPSILON
}

fn append_distinct_route_point(points: &mut Vec<RoutePoint>, point: RoutePoint) {
    if let Some(previous) = points.last() {
        if are_same_xy(previous.point(), point.point()) && previous.z == point.z
            && previous.metadata.get("pcb_port_id") == point.metadata.get("pcb_port_id") { return; }
    }
    points.push(point);
}

pub(crate) fn apply_safe_trace_layer_move_for_error(srj: &RepairSrj, routes: &mut [MutableRoute], error: &Value, route_index: usize, target_z: f64, span_expansion: SafeTraceLayerMoveSpanExpansion, conn_map: Option<&RepairConnectivityMap>, direction_variant: usize, adjust_via_clearance: bool, math: RepairMath, pad_context: &PadClearanceContext) -> bool {
    if !matches!(get_drc_error_type(error), Some("pcb_pad_trace_clearance_error" | "pcb_trace_error")) || target_z < 0.0 || target_z >= srj.layer_count as f64 { return false; }
    let Some(route) = routes.get(route_index).filter(|route| route.route.len() >= 2) else { return false; };
    let points: Vec<RoutePoint> = route.route.iter().map(|point| point.borrow().clone()).collect();
    let first = &points[0]; let last = points.last().unwrap();
    let Some(center) = get_error_center(error) else { return false; };
    let segment = if is_trace_obstacle_drc_error(error) {
        get_nearest_trace_obstacle_segment_pair(srj, routes, route_index, center, conn_map, math).map(|(_, segment)| segment)
    } else { get_nearest_segment(&collect_segments_for_route(route, route_index), center, None, math).cloned() };
    let Some(segment) = segment.filter(|segment| segment.z != target_z) else { return false; };
    let mut span_start = segment.start_index; let mut span_end = segment.end_index;
    let max_expansions = match span_expansion { SafeTraceLayerMoveSpanExpansion::Full => points.len(), SafeTraceLayerMoveSpanExpansion::Count(n) => n };
    for _ in 0..max_expansions {
        let mut expanded = false;
        if span_start > 0 && points[span_start - 1].z == segment.z { span_start -= 1; expanded = true; }
        if points.get(span_end + 1).is_some_and(|p| p.z == segment.z) { span_end += 1; expanded = true; }
        if !expanded { break; }
    }
    let moves_start = span_start == 0 && has_port(first);
    let moves_end = span_end == points.len() - 1 && has_port(last);
    let via_radius = route.via_diameter.unwrap_or(f64::NAN) / 2.0;
    let rotation_pair = terminal_escape_rotation_pairs()[direction_variant % SAFE_TRACE_LAYER_DIRECTION_VARIANT_COUNT];
    let mut relocated = false;
    let mut escape = |side: EndpointSide| -> Option<Point> {
        let endpoint = if side == EndpointSide::Start { first } else { last };
        let pad = get_route_endpoint_pad(srj, route, endpoint, conn_map)?;
        let tangent = get_terminal_tangent(&points, side, math)?;
        let rotation = rotation_pair[if side == EndpointSide::Start { 0 } else { 1 }];
        let escape = get_external_via_point(endpoint.point(), pad, rotate_direction(tangent, rotation, math), via_radius, math)?;
        if !is_via_inside_bounds(escape, via_radius, srj.bounds) || get_point_to_obstacle_distance(escape, pad, math) + POSITION_EPSILON < via_radius { return None; }
        if !adjust_via_clearance { return Some(escape); }
        let result = pad_context.find_with_identity(route, escape, via_radius, &[segment.z, target_z], conn_map, &math);
        relocated |= result.point.is_some() && !result.is_preferred;
        result.point
    };
    let start_escape = if moves_start { escape(EndpointSide::Start) } else { None };
    let end_escape = if moves_end { escape(EndpointSide::End) } else { None };
    if (moves_start && start_escape.is_none()) || (moves_end && end_escape.is_none()) || (adjust_via_clearance && !relocated) { return false; }
    let mut moved = Vec::new();
    for point in &points[..span_start] { append_distinct_route_point(&mut moved, point.clone()); }
    let start = &points[span_start]; let end = &points[span_end];
    let starts_transition = span_start > 0 && are_same_xy(points[span_start - 1].point(), start.point());
    let ends_transition = span_end < points.len() - 1 && are_same_xy(points[span_end + 1].point(), end.point());
    if moves_start {
        append_distinct_route_point(&mut moved, first.clone());
        append_distinct_route_point(&mut moved, copied_point(first, start_escape, None, true));
        append_distinct_route_point(&mut moved, copied_point(first, start_escape, Some(target_z), true));
    } else {
        if !starts_transition { append_distinct_route_point(&mut moved, copied_point(start, None, None, true)); }
        append_distinct_route_point(&mut moved, copied_point(start, None, Some(target_z), true));
    }
    let last_moved = if moves_end { span_end - 1 } else { span_end };
    for index in span_start + 1..=last_moved { append_distinct_route_point(&mut moved, copied_point(&points[index], None, Some(target_z), true)); }
    if moves_end {
        append_distinct_route_point(&mut moved, copied_point(last, end_escape, Some(target_z), true));
        append_distinct_route_point(&mut moved, copied_point(last, end_escape, None, true));
        append_distinct_route_point(&mut moved, last.clone());
    } else if !ends_transition { append_distinct_route_point(&mut moved, copied_point(end, None, None, true)); }
    for point in &points[span_end + 1..] { append_distinct_route_point(&mut moved, point.clone()); }
    let moved_len = moved.len();
    for point in &mut moved[1..moved_len.saturating_sub(1)] { Rc::make_mut(&mut point.metadata).as_object_mut().unwrap().remove("pcb_port_id"); }
    let board_clearance = srj.min_board_edge_clearance.unwrap_or(0.2);
    let original_segments = collect_segments_for_route(route, route_index);
    let original_vias = collect_via_nodes(std::slice::from_ref(route), 0.3);
    for pair in moved.windows(2) {
        let start = &pair[0]; let end = &pair[1];
        if start.z == end.z && !original_segments.iter().any(|segment| point_is_on_segment(start.point(), segment.start.borrow().point(), segment.end.borrow().point()) && point_is_on_segment(end.point(), segment.start.borrow().point(), segment.end.borrow().point()))
            && get_segment_board_clearance(srj, start.point(), end.point()) < route.trace_thickness.unwrap_or(f64::NAN) / 2.0 + board_clearance { return false; }
        if start.z != end.z && start.metadata["toNextSegmentType"].as_str() != Some("through_obstacle")
            && !original_vias.iter().any(|via| are_same_xy(via_xy(via), end.point()) && via.radius >= via_radius)
            && get_point_board_clearance(srj, end.point()) < via_radius + board_clearance { return false; }
    }
    routes[route_index].point_array_identity = crate::internal_types::next_identity();
    routes[route_index].route = moved.into_iter().map(point_ref).collect();
    true
}

pub(crate) fn apply_via_in_pad_layer_move_for_error(srj: &RepairSrj, routes: &mut [MutableRoute], error: &Value, trace_index: &indexmap::IndexMap<String, usize>, target_z: f64, conn_map: Option<&RepairConnectivityMap>, via_hole_diameter: Option<f64>, _math: RepairMath) -> bool {
    if !matches!(get_drc_error_type(error), Some("pcb_pad_trace_clearance_error" | "pcb_trace_error")) || target_z < 0.0 || target_z >= srj.layer_count as f64 { return false; }
    let Some(index) = get_trace_route_index_for_error(error, trace_index) else { return false; };
    let Some(route) = routes.get(index).filter(|r| r.route.len() >= 2) else { return false; };
    let points: Vec<RoutePoint> = route.route.iter().map(|p| p.borrow().clone()).collect();
    let first = &points[0]; let last = points.last().unwrap();
    if first.z != last.z || target_z == first.z || points.iter().any(|p| p.z != first.z) || !has_port(first) || !has_port(last) { return false; }
    if !is_route_endpoint_eligible_for_via_in_pad(srj, route, first, conn_map, via_hole_diameter) || !is_route_endpoint_eligible_for_via_in_pad(srj, route, last, conn_map, via_hole_diameter) { return false; }
    let mut moved = vec![first.clone(), copied_point(first, None, Some(target_z), true)];
    moved.extend(points[1..points.len() - 1].iter().map(|p| copied_point(p, None, Some(target_z), false)));
    moved.push(copied_point(last, None, Some(target_z), true)); moved.push(last.clone());
    routes[index].point_array_identity = crate::internal_types::next_identity();
    routes[index].route = moved.into_iter().map(point_ref).collect();
    true
}

pub(crate) fn apply_terminal_via_relocation_for_error(srj: &RepairSrj, routes: &mut [MutableRoute], error: &Value, trace_index: &indexmap::IndexMap<String, usize>, side: EndpointSide, conn_map: Option<&RepairConnectivityMap>, via_hole_diameter: Option<f64>, _math: RepairMath) -> bool {
    if get_drc_error_type(error) != Some("pcb_pad_trace_clearance_error") { return false; }
    let Some(index) = get_trace_route_index_for_error(error, trace_index) else { return false; };
    let Some(route) = routes.get(index).filter(|r| r.route.len() >= 4) else { return false; };
    let points: Vec<RoutePoint> = route.route.iter().map(|p| p.borrow().clone()).collect();
    let endpoint = if side == EndpointSide::Start { &points[0] } else { points.last().unwrap() };
    if !is_route_endpoint_eligible_for_via_in_pad(srj, route, endpoint, conn_map, via_hole_diameter) { return false; }
    let moved = if side == EndpointSide::Start {
        let Some(changed) = (1..points.len()).find(|&i| points[i].z != endpoint.z) else { return false; };
        let start = changed - 1;
        if !are_same_xy(points[start].point(), points[changed].point()) { return false; }
        let mut end = changed;
        while end + 1 < points.len() && are_same_xy(points[changed].point(), points[end + 1].point()) { end += 1; }
        let target_z = points[end].z;
        let mut moved = vec![endpoint.clone()];
        moved.extend(points[start + 1..=end].iter().map(|p| copied_point(endpoint, None, Some(p.z), true)));
        moved.extend(points[1..=start].iter().map(|p| copied_point(p, None, Some(target_z), false)));
        moved.extend_from_slice(&points[end + 1..]); moved
    } else {
        let Some(changed) = (0..points.len() - 1).rev().find(|&i| points[i].z != endpoint.z) else { return false; };
        let end = changed + 1;
        if !are_same_xy(points[changed].point(), points[end].point()) { return false; }
        let mut start = changed;
        while start > 0 && are_same_xy(points[changed].point(), points[start - 1].point()) { start -= 1; }
        let target_z = points[start].z;
        let mut moved = points[..=start].to_vec();
        if end + 1 < points.len() - 1 { moved.extend(points[end + 1..points.len() - 1].iter().map(|p| copied_point(p, None, Some(target_z), false))); }
        moved.push(copied_point(endpoint, None, Some(target_z), true));
        moved.extend(points[start + 1..end].iter().map(|p| copied_point(endpoint, None, Some(p.z), true)));
        moved.push(endpoint.clone()); moved
    };
    routes[index].point_array_identity = crate::internal_types::next_identity();
    routes[index].route = moved.into_iter().map(point_ref).collect(); true
}

pub(crate) struct TracePairSegmentDisplacement { pub(crate) moved_route_index: usize }

fn error_clearance(error: &Value) -> f64 {
    let value = &error["minimum_clearance"];
    let clearance = if value.is_null() && error.get("minimum_clearance").is_some() { 0.0 }
        else if let Some(b) = value.as_bool() { if b { 1.0 } else { 0.0 } }
        else if let Some(s) = value.as_str() { if s.trim().is_empty() { 0.0 } else { s.trim().parse().unwrap_or(f64::NAN) } }
        else { value.as_f64().unwrap_or(f64::NAN) };
    if clearance.is_finite() { clearance } else { RELAXED_TRACE_CLEARANCE }
}

fn worst_error_center(error: &Value) -> Option<Point> {
    let center = error.get("worst_contact_center").filter(|v| !v.is_null()).unwrap_or(&error["center"]);
    Some(Point { x: center["x"].as_f64()?, y: center["y"].as_f64()? })
}

pub(crate) fn apply_trace_pair_segment_displacement_for_error(srj: &RepairSrj, routes: &mut [MutableRoute], error: &Value, trace_index: &indexmap::IndexMap<String, usize>, side: usize, math: RepairMath) -> Option<TracePairSegmentDisplacement> {
    if get_drc_error_type(error) != Some("pcb_trace_error") { return None; }
    let pair = get_trace_route_pair_for_error(error, trace_index)?;
    let center = worst_error_center(error)?;
    let segments = collect_segments(routes);
    let left = get_nearest_segment(&segments, center, Some(pair[0]), math)?;
    let right = get_nearest_segment(&segments, center, Some(pair[1]), math)?;
    if left.z != right.z { return None; }
    let contacts = get_segment_distance_candidates(left, right, math);
    let contact = contacts.first()?;
    let distance = (math.hypot)(contact.left_point.x - contact.right_point.x, contact.left_point.y - contact.right_point.y);
    let penetration = left.radius + right.radius + error_clearance(error) - distance;
    if penetration <= POSITION_EPSILON { return None; }
    let (moved, stationary, t, moved_point, stationary_point, sign) = if side == 0 { (left, right, contact.left_t, contact.left_point, contact.right_point, 1.0) } else { (right, left, contact.right_t, contact.right_point, contact.left_point, -1.0) };
    let distribution = (1.0 - t) * (1.0 - t) + t * t;
    if distribution <= POSITION_EPSILON { return None; }
    let displacement = penetration / distribution;
    let sx = moved.end.borrow().x - moved.start.borrow().x; let sy = moved.end.borrow().y - moved.start.borrow().y;
    let length = (math.hypot)(sx, sy);
    let fallback = if (moved.route_index + stationary.route_index) % 2 == 0 { 1.0 } else { -1.0 };
    let dx = if distance > POSITION_EPSILON { (moved_point.x - stationary_point.x) / distance } else if length > POSITION_EPSILON { (-sy / length) * fallback * sign } else { sign };
    let dy = if distance > POSITION_EPSILON { (moved_point.y - stationary_point.y) / distance } else if length > POSITION_EPSILON { (sx / length) * fallback * sign } else { 0.0 };
    move_segment_by_distribution(routes, moved, dx * displacement, dy * displacement, srj, t, math).then_some(TracePairSegmentDisplacement { moved_route_index: moved.route_index })
}

fn get_obstacle_escape_points(point: Point, obstacle: &RepairObstacle, required: f64) -> Vec<Point> {
    let left = obstacle.center.x - obstacle.width / 2.0; let right = obstacle.center.x + obstacle.width / 2.0;
    let bottom = obstacle.center.y - obstacle.height / 2.0; let top = obstacle.center.y + obstacle.height / 2.0;
    let dx = (left - point.x).max(point.x - right).max(0.0); let dy = (bottom - point.y).max(point.y - top).max(0.0);
    let mut points = Vec::new();
    if dx < required {
        let distance = (required * required - dx * dx).sqrt();
        points.push(Point { x: point.x, y: bottom - distance - POSITION_EPSILON });
        points.push(Point { x: point.x, y: top + distance + POSITION_EPSILON });
    }
    if dy < required {
        let distance = (required * required - dy * dy).sqrt();
        points.push(Point { x: left - distance - POSITION_EPSILON, y: point.y });
        points.push(Point { x: right + distance + POSITION_EPSILON, y: point.y });
    }
    points
}

fn get_via_displacement_target(srj: &RepairSrj, via: &ViaNode, segment: &Segment, segments: &[Segment], initial: Point, trace_distance: f64, obstacle_distance: f64, conn_map: Option<&RepairConnectivityMap>, math: RepairMath) -> Option<Point> {
    let min_z = via.z_layers.iter().copied().fold(f64::INFINITY, f64::min); let max_z = via.z_layers.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let foreign: Vec<&RepairObstacle> = srj.obstacles.iter().filter(|obstacle| !obstacle.is_copper_pour
        && !repair_obstacle_shares_net(&via.root_connection_name, obstacle, conn_map)
        && obstacle.z_layers.iter().any(|&z| z >= min_z && z <= max_z)).collect();
    let blocking: Vec<&RepairObstacle> = foreign.iter().copied().filter(|obstacle| get_rect_repulsion(initial, obstacle, obstacle_distance, math).is_some()).collect();
    let mut candidates = vec![initial];
    candidates.extend(crate::find_trace_clearance_via_positions::find_trace_clearance_via_positions(via, segments, trace_distance - via.radius - segment.radius, conn_map, &math));
    candidates.extend(blocking.iter().flat_map(|obstacle| get_obstacle_escape_points(initial, obstacle, obstacle_distance)));
    candidates.retain(|&candidate| {
        if !is_via_inside_bounds(candidate, via.radius, srj.bounds) { return false; }
        let projection = point_to_segment_projection(candidate, segment);
        if (math.hypot)(candidate.x - projection.x, candidate.y - projection.y) < trace_distance - POSITION_EPSILON { return false; }
        if segments.iter().any(|neighbor| neighbor.z >= min_z && neighbor.z <= max_z && !shares_net(&via.root_connection_name, Some(&neighbor.root_connection_name), conn_map)
            && point_to_segment_distance(&candidate, &neighbor.start.borrow().point(), &neighbor.end.borrow().point()) < trace_distance + neighbor.radius - segment.radius - POSITION_EPSILON) { return false; }
        foreign.iter().all(|obstacle| get_point_to_obstacle_distance(candidate, obstacle, math) >= obstacle_distance - POSITION_EPSILON)
    });
    candidates.sort_by(|left, right| ((math.hypot)(left.x - via.x, left.y - via.y) - (math.hypot)(right.x - via.x, right.y - via.y)).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal));
    candidates.first().copied()
}

pub(crate) fn apply_via_only_displacement_for_trace_error(srj: &RepairSrj, routes: &mut [MutableRoute], error: &Value, trace_index: &indexmap::IndexMap<String, usize>, expected_trace_route_index: usize, conn_map: Option<&RepairConnectivityMap>, math: RepairMath) -> bool {
    if get_drc_error_type(error) != Some("pcb_trace_error") { return false; }
    let identifies_via = error["pcb_via_id"].is_string() || error["pcb_via_ids"].is_array()
        || error["pcb_trace_error_id"].as_str().unwrap_or("").to_lowercase().contains("_via_")
        || error["message"].as_str().unwrap_or("").to_lowercase().contains("via");
    if !identifies_via || get_trace_route_index_for_error(error, trace_index) != Some(expected_trace_route_index) || get_trace_route_pair_for_error(error, trace_index).is_some() { return false; }
    let Some(center) = worst_error_center(error) else { return false; };
    let segments = collect_segments(routes);
    let Some(segment) = get_nearest_segment(&segments, center, Some(expected_trace_route_index), math) else { return false; };
    let owners: Vec<&str> = error["pcb_trace_ids"].as_array().map(|ids| ids.iter().filter_map(Value::as_str).filter(|&id| Some(id) != error["pcb_trace_id"].as_str()).collect()).unwrap_or_default();
    let owner_indexes: Vec<usize> = owners.iter().filter_map(|id| trace_index.get(*id).copied()).collect();
    let mut vias = collect_via_nodes(routes, 0.3);
    if !owners.is_empty() { vias.retain(|via| owner_indexes.contains(&via.route_index)); }
    let Some(via_index) = get_nearest_via(&vias, center, None, math) else { return false; };
    let via = &mut vias[via_index];
    if !via.movable || shares_net(&via.root_connection_name, Some(&segment.root_connection_name), conn_map) { return false; }
    let projection = point_to_segment_projection(via_xy(via), segment);
    let sx = via.x - projection.x; let sy = via.y - projection.y;
    let distance = (math.hypot)(sx, sy); let clearance = error_clearance(error);
    let penetration = via.radius + segment.radius + clearance - distance;
    if penetration <= POSITION_EPSILON { return false; }
    let segment_x = segment.end.borrow().x - segment.start.borrow().x; let segment_y = segment.end.borrow().y - segment.start.borrow().y;
    let length = (math.hypot)(segment_x, segment_y); let fallback = if via.route_index % 2 == 0 { 1.0 } else { -1.0 };
    let dx = if distance > POSITION_EPSILON { sx / distance } else if length > POSITION_EPSILON { (-segment_y / length) * fallback } else { 1.0 };
    let dy = if distance > POSITION_EPSILON { sy / distance } else if length > POSITION_EPSILON { (segment_x / length) * fallback } else { 0.0 };
    let trace_distance = via.radius + segment.radius + clearance;
    let obstacle_distance = via.radius + srj.via_to_pad_clearance + CLEARANCE_SLACK;
    let initial = Point { x: via.x + dx * (penetration + CLEARANCE_SLACK), y: via.y + dy * (penetration + CLEARANCE_SLACK) };
    let Some(target) = get_via_displacement_target(srj, via, segment, &segments, initial, trace_distance, obstacle_distance, conn_map, math) else { return false; };
    let dx = target.x - via.x; let dy = target.y - via.y;
    move_via(routes, via, dx, dy, srj, math)
}

fn get_trace_segment_for_error(routes: &[MutableRoute], error: &Value, index: usize, math: RepairMath) -> Option<(Point, Segment)> {
    if get_drc_error_type(error) != Some("pcb_trace_error") { return None; }
    let center = get_error_center(error)?;
    let route = routes.get(index)?;
    let segments = collect_segments_for_route(route, index);
    Some((center, get_nearest_segment(&segments, center, None, math)?.clone()))
}

fn get_same_layer_trace_span_for_error(routes: &[MutableRoute], error: &Value, index: usize, expansion: usize, math: RepairMath) -> Option<(usize, usize, RoutePoint, RoutePoint)> {
    let (_, segment) = get_trace_segment_for_error(routes, error, index, math)?;
    let route = &routes[index];
    let start_index = segment.start_index.saturating_sub(expansion);
    let end_index = (segment.end_index + expansion).min(route.route.len() - 1);
    let start = route.route[start_index].borrow().clone(); let end = route.route[end_index].borrow().clone();
    if route.route[start_index..=end_index].iter().any(|p| p.borrow().z != start.z) || start.z != end.z { return None; }
    Some((start_index, end_index, start, end))
}

pub(crate) fn apply_trace_pair_layer_move_for_error(srj: &RepairSrj, routes: &mut [MutableRoute], error: &Value, trace_index: &indexmap::IndexMap<String, usize>, side: usize, target_z: f64, expansion: usize, conn_map: Option<&RepairConnectivityMap>, via_hole_diameter: Option<f64>, math: RepairMath) -> bool {
    if target_z < 0.0 || target_z >= srj.layer_count as f64 { return false; }
    let Some(pair) = get_trace_route_pair_for_error(error, trace_index) else { return false; };
    let index = pair[side]; let Some((_, segment)) = get_trace_segment_for_error(routes, error, index, math) else { return false; };
    if segment.z == target_z { return false; }
    let route = &routes[index]; let mut start_index = segment.start_index; let mut end_index = segment.end_index;
    for _ in 0..expansion {
        if start_index > 0 && route.route[start_index - 1].borrow().z == segment.z { start_index -= 1; }
        if route.route.get(end_index + 1).is_some_and(|p| p.borrow().z == segment.z) { end_index += 1; }
    }
    let start = route.route[start_index].borrow().clone(); let end = route.route[end_index].borrow().clone();
    if (start_index == 0 && has_port(&start) && !is_route_endpoint_eligible_for_via_in_pad(srj, route, &start, conn_map, via_hole_diameter))
        || (end_index == route.route.len() - 1 && has_port(&end) && !is_route_endpoint_eligible_for_via_in_pad(srj, route, &end, conn_map, via_hole_diameter)) || start.z != end.z { return false; }
    let mut moved = vec![point_ref(start.clone())];
    moved.extend(route.route[start_index..=end_index].iter().map(|p| point_ref(copied_point(&p.borrow(), None, Some(target_z), true))));
    moved.push(point_ref(end));
    routes[index].route.splice(start_index..=end_index, moved); true
}

pub(crate) fn apply_trace_detour_for_error(routes: &mut [MutableRoute], error: &Value, index: usize, half_span: f64, offset: f64, sign: f64, math: RepairMath) -> bool {
    if half_span <= 0.0 || offset <= 0.0 { return false; }
    let Some((center, segment)) = get_trace_segment_for_error(routes, error, index, math) else { return false; };
    let start = segment.start.borrow().clone(); let end = segment.end.borrow().clone();
    let sx = end.x - start.x; let sy = end.y - start.y; let length = (math.hypot)(sx, sy);
    if length <= POSITION_EPSILON { return false; }
    let projection = point_to_segment_projection(center, &segment);
    let before_t = clamp_value(projection.t - half_span / length, 0.02, 0.98); let after_t = clamp_value(projection.t + half_span / length, 0.02, 0.98);
    if before_t >= after_t { return false; }
    let at = |t: f64| RoutePoint::from_value(&json!({"x":start.x + sx * t,"y":start.y + sy * t,"z":segment.z}));
    let before = at(before_t); let after = at(after_t);
    let nx = (-sy / length) * sign; let ny = (sx / length) * sign;
    let moved = vec![start, before.clone(), copied_point(&before, Some(Point{x:before.x + nx * offset,y:before.y + ny * offset}), None, false),
        copied_point(&after, Some(Point{x:after.x + nx * offset,y:after.y + ny * offset}),None,false), after, end];
    routes[index].route.splice(segment.start_index..segment.start_index + 2, moved.into_iter().map(point_ref)); true
}

const MAX_TRACE_LAYER_CORRIDOR_ROUTE_LENGTH: f64 = 8.0;

pub(crate) fn apply_trace_layer_corridor_for_error(srj: &RepairSrj, routes: &mut [MutableRoute], error: &Value, index: usize, target_z: f64, normal_sign: f64, tangent_sign: f64, reverse: bool, math: RepairMath) -> bool {
    if !target_z.is_finite() || target_z.fract() != 0.0 || target_z < 0.0 || target_z >= srj.layer_count as f64 { return false; }
    let Some(center) = get_error_center(error) else { return false; };
    let Some(route) = routes.get(index).filter(|r| !r.route.is_empty()) else { return false; };
    let start = route.route[0].borrow().clone(); let end = route.route.last().unwrap().borrow().clone();
    if start.z != end.z || start.z == target_z || route.metadata["jumpers"].as_array().is_some_and(|a| !a.is_empty())
        || route.route.iter().any(|point| { let p = point.borrow(); p.z != start.z || p.metadata["toNextSegmentType"].as_str() == Some("through_obstacle") }) { return false; }
    let route_x = end.x - start.x; let route_y = end.y - start.y; let length = (math.hypot)(route_x, route_y);
    if length <= POSITION_EPSILON || length > MAX_TRACE_LAYER_CORRIDOR_ROUTE_LENGTH { return false; }
    let tangent = Point { x: route_x / length, y: route_y / length };
    let normal = Point { x: tangent.y * normal_sign, y: -tangent.x * normal_sign };
    let project = |point: &RoutePoint| (point.x - center.x) * tangent.x + (point.y - center.y) * tangent.y;
    let on_axes = |t: f64, n: f64, z: f64| RoutePoint::from_value(&json!({
        "x": center.x + tangent.x * t + normal.x * n, "y":center.y + tangent.y * t + normal.y * n, "z":z }));
    let pitch = route.via_diameter.unwrap_or(srj.min_via_diameter) + srj.source["minTraceToPadEdgeClearance"].as_f64().unwrap_or(RELAXED_TRACE_CLEARANCE);
    let start_offset = if reverse { 1.25 } else { -0.75 } * pitch;
    let end_offset = if reverse { -0.75 } else { 1.25 } * pitch;
    let start_t = project(&start) + pitch * 0.5 * tangent_sign; let end_t = project(&end) + pitch * tangent_sign;
    let start_via = on_axes(start_t, start_offset, start.z); let end_via = on_axes(end_t, end_offset, start.z);
    let corridor_start = on_axes(start_t, pitch * 2.0, target_z); let corridor_end = on_axes(end_t, pitch * 2.0, target_z);
    let candidates = vec![start, start_via.clone(), copied_point(&start_via, None, Some(target_z), false), corridor_start, corridor_end,
        copied_point(&end_via, None, Some(target_z), false), end_via.clone(), end];
    let clearance = srj.min_board_edge_clearance.unwrap_or(0.0);
    let via_radius = route.via_diameter.unwrap_or(srj.min_via_diameter) / 2.0; let trace_radius = route.trace_thickness.unwrap_or(f64::NAN) / 2.0;
    if [&start_via, &end_via].iter().any(|via| get_point_board_clearance(srj, via.point()) + COORDINATE_EPSILON < via_radius + clearance) { return false; }
    for pair in candidates.windows(2) {
        if pair[0].z == pair[1].z && get_segment_board_clearance(srj, pair[0].point(), pair[1].point()) + COORDINATE_EPSILON < trace_radius + clearance { return false; }
    }
    routes[index].point_array_identity = crate::internal_types::next_identity();
    routes[index].route = candidates.into_iter().map(point_ref).collect(); true
}

pub(crate) fn apply_trace_span_detour_for_error(srj: &RepairSrj, routes: &mut [MutableRoute], error: &Value, index: usize, expansion: usize, offset: f64, sign: f64, math: RepairMath) -> bool {
    if expansion < 1 || offset <= 0.0 { return false; }
    let Some((start_index, end_index, start, end)) = get_same_layer_trace_span_for_error(routes, error, index, expansion, math) else { return false; };
    let sx = end.x - start.x; let sy = end.y - start.y; let length = (math.hypot)(sx, sy);
    if length <= POSITION_EPSILON { return false; }
    let nx = (-sy / length) * sign * offset; let ny = (sx / length) * sign * offset;
    let shifted_start = copied_point(&start, Some(Point{x:start.x + nx,y:start.y + ny}), None, true);
    let shifted_end = copied_point(&end, Some(Point{x:end.x + nx,y:end.y + ny}), None, true);
    if !crate::clearance_math::is_point_inside_bounds(&shifted_start.point(), &srj.bounds) || !crate::clearance_math::is_point_inside_bounds(&shifted_end.point(), &srj.bounds) { return false; }
    routes[index].route.splice(start_index..=end_index, [start, shifted_start, shifted_end, end].into_iter().map(point_ref)); true
}

pub(crate) fn apply_trace_waypoint_detour_for_error(srj: &RepairSrj, routes: &mut [MutableRoute], error: &Value, index: usize, expansion: usize, waypoint: Point, math: RepairMath) -> bool {
    let Some((start_index, end_index, start, end)) = get_same_layer_trace_span_for_error(routes, error, index, expansion, math) else { return false; };
    if (math.hypot)(waypoint.x - start.x, waypoint.y - start.y) <= POSITION_EPSILON || (math.hypot)(waypoint.x - end.x, waypoint.y - end.y) <= POSITION_EPSILON
        || !crate::clearance_math::is_point_inside_bounds(&waypoint, &srj.bounds) { return false; }
    let point = RoutePoint::from_value(&json!({"x":waypoint.x,"y":waypoint.y,"z":start.z}));
    routes[index].route.splice(start_index..=end_index, [start, point, end].into_iter().map(point_ref)); true
}

pub(crate) fn apply_trace_pair_detour_for_error(routes: &mut [MutableRoute], error: &Value, trace_index: &indexmap::IndexMap<String, usize>, side: usize, half_span: f64, offset: f64, sign: f64, math: RepairMath) -> bool {
    let Some(pair) = get_trace_route_pair_for_error(error, trace_index) else { return false; };
    apply_trace_detour_for_error(routes, error, pair[side], half_span, offset, sign, math)
}
