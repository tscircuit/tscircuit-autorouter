use indexmap::{IndexMap, IndexSet};
use rustc_hash::FxBuildHasher;
use std::rc::Rc;
use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use crate::math_utils::*;
use crate::transformation_matrix::{Matrix, apply_to_point, compose, inverse, rotate_deg_with_math, translate};
use crate::get_via_layers::get_via_layers_from_span;
use crate::simplified_trace::{SimplifiedTrace, SimplifiedRoutePoint};

const DRC_EPSILON: f64 = 5e-3;
const POSITION_EPSILON: f64 = 1e-6;

struct TraceSegment<'a> {
    order: usize,
    trace_id: &'a str,
    net_id: ResolvedNet,
    start: Point,
    end: Point,
    width: f64,
    layer: &'a str,
    pcb_port_ids: Rc<Vec<String>>,
}

struct Via<'a> {
    order: usize,
    via_id: String,
    trace_id: &'a str,
    net_id: ResolvedNet,
    x: f64,
    y: f64,
    diameter: f64,
    layers: Vec<String>,
}

#[derive(Clone, Copy)]
struct ResolvedNet {
    id: usize,
    conn_map_net: Option<usize>,
    resolved_id: usize,
}

struct NetIds<'a> {
    ids: HashMap<&'a str, usize, FxBuildHasher>,
    compiled: HashMap<&'a str, ResolvedNet, FxBuildHasher>,
}

impl<'a> NetIds<'a> {
    fn new() -> Self {
        Self { ids: HashMap::with_hasher(FxBuildHasher), compiled: HashMap::with_hasher(FxBuildHasher) }
    }

    fn intern(&mut self, id: &'a str) -> usize {
        if let Some(&index) = self.ids.get(id) { return index; }
        let index = self.ids.len();
        self.ids.insert(id, index);
        index
    }
}

struct StaticObstacle {
    obstacle_type: String,
    obstacle_id: String,
    connected_to: Vec<String>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    radius: Option<f64>,
    local_to_world: Matrix,
    world_to_local: Matrix,
    layers: Vec<String>,
    pcb_port_id: Option<String>,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum DynamicCollidable { Segment(usize), Via(usize) }

struct SpatialHash<T> {
    cells: IndexMap<(i64, i64), Vec<T>, FxBuildHasher>,
    cell_size: f64,
}

trait SpatialItem: Copy {
    fn slot(self) -> usize;
}

impl SpatialItem for usize {
    fn slot(self) -> usize { self }
}

impl SpatialItem for DynamicCollidable {
    fn slot(self) -> usize {
        match self { Self::Segment(index) => index * 2, Self::Via(index) => index * 2 + 1 }
    }
}

struct QueryScratch<T> {
    marks: Vec<usize>,
    generation: usize,
    results: Vec<T>,
}

impl<T: SpatialItem> QueryScratch<T> {
    fn new(slot_count: usize) -> Self {
        Self { marks: vec![0; slot_count], generation: 0, results: Vec::new() }
    }

    fn begin(&mut self) {
        self.results.clear();
        self.generation = self.generation.wrapping_add(1);
        if self.generation == 0 {
            self.marks.fill(0);
            self.generation = 1;
        }
    }

    fn insert(&mut self, item: T) {
        let mark = &mut self.marks[item.slot()];
        if *mark != self.generation {
            *mark = self.generation;
            self.results.push(item);
        }
    }
}

impl<T: SpatialItem> SpatialHash<T> {
    fn new(cell_size: f64) -> Self {
        Self { cells: IndexMap::with_hasher(FxBuildHasher), cell_size }
    }

    fn insert(&mut self, item: T, bounds: Bounds) {
        let min_x = (bounds.min_x / self.cell_size).floor() as i64;
        let max_x = (bounds.max_x / self.cell_size).floor() as i64;
        let min_y = (bounds.min_y / self.cell_size).floor() as i64;
        let max_y = (bounds.max_y / self.cell_size).floor() as i64;
        for x in min_x..=max_x {
            for y in min_y..=max_y {
                self.cells.entry((x, y)).or_default().push(item);
            }
        }
    }

    fn query(&self, bounds: Bounds, scratch: &mut QueryScratch<T>) {
        let min_x = (bounds.min_x / self.cell_size).floor() as i64;
        let max_x = (bounds.max_x / self.cell_size).floor() as i64;
        let min_y = (bounds.min_y / self.cell_size).floor() as i64;
        let max_y = (bounds.max_y / self.cell_size).floor() as i64;
        for x in min_x..=max_x {
            for y in min_y..=max_y {
                if let Some(items) = self.cells.get(&(x, y)) {
                    for &item in items { scratch.insert(item); }
                }
            }
        }
    }
}

#[derive(Default, Serialize)]
#[cfg_attr(feature = "wasm-types", derive(tsify::Tsify))]
#[serde(rename_all = "camelCase")]
pub struct AutoroutingDrcEngineRunStats {
    pub trace_count: usize,
    pub segment_count: usize,
    pub via_count: usize,
    pub obstacle_count: usize,
    pub broad_phase_candidate_count: usize,
    pub exact_check_count: usize,
}

#[derive(Clone, Copy)]
pub struct DrcMath {
    pub hypot: fn(f64, f64) -> f64,
    pub sin: fn(f64) -> f64,
    pub cos: fn(f64) -> f64,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectivityMap {
    pub id_to_net_map: IndexMap<String, String, FxBuildHasher>,
}

impl Default for DrcMath {
    fn default() -> Self { Self { hypot: f64::hypot, sin: f64::sin, cos: f64::cos } }
}

pub struct CompiledDrcData {
    math: DrcMath,
    srj: Value,
    trace_clearance: f64,
    via_clearance: f64,
    via_to_pad_clearance: f64,
    cell_size: f64,
    include_trace_via_owner_metadata: bool,
    canonical_net_by_alias: IndexMap<String, String, FxBuildHasher>,
    conn_map_net_by_canonical_net: IndexMap<String, String, FxBuildHasher>,
    obstacles: Vec<StaticObstacle>,
    obstacle_indexes_by_layer: IndexMap<String, SpatialHash<usize>, FxBuildHasher>,
}

pub struct AutoroutingDrcEngine {
    compiled: Rc<CompiledDrcData>,
    pub conn_map: Option<ConnectivityMap>,
    pub last_run_stats: AutoroutingDrcEngineRunStats,
}


fn num(value: &Value) -> f64 { value.as_f64().expect("Expected a number") }
fn string(value: &Value) -> &str { value.as_str().expect("Expected a string") }
fn array(value: &Value) -> &[Value] { value.as_array().expect("Expected an array") }
fn strings(value: &Value) -> Vec<String> { array(value).iter().map(|v| string(v).to_owned()).collect() }
fn point(value: &Value) -> Point { Point { x: num(&value["x"]), y: num(&value["y"]) } }
fn point_json(p: Point) -> Value { json!({"x": p.x, "y": p.y}) }
fn optional_num(value: &Value, default: f64) -> f64 { if value.is_null() { default } else { num(value) } }
fn number_string(value: f64) -> String { ryu_js::Buffer::new().format(value).to_owned() }

fn expand_bounds(bounds: Bounds, amount: f64) -> Bounds {
    Bounds { min_x: bounds.min_x - amount, min_y: bounds.min_y - amount, max_x: bounds.max_x + amount, max_y: bounds.max_y + amount }
}

fn get_segment_bounds(s: &TraceSegment) -> Bounds {
    expand_bounds(Bounds { min_x: s.start.x.min(s.end.x), min_y: s.start.y.min(s.end.y), max_x: s.start.x.max(s.end.x), max_y: s.start.y.max(s.end.y) }, s.width / 2.0)
}

fn get_via_bounds(v: &Via) -> Bounds {
    let radius = v.diameter / 2.0;
    Bounds { min_x: v.x - radius, min_y: v.y - radius, max_x: v.x + radius, max_y: v.y + radius }
}

fn get_obstacle_local_bounds(o: &StaticObstacle) -> Bounds {
    Bounds { min_x: -o.width / 2.0, min_y: -o.height / 2.0, max_x: o.width / 2.0, max_y: o.height / 2.0 }
}

fn get_obstacle_bounds(o: &StaticObstacle) -> Bounds {
    let points = [Point { x: -o.width / 2.0, y: -o.height / 2.0 }, Point { x: o.width / 2.0, y: -o.height / 2.0 }, Point { x: o.width / 2.0, y: o.height / 2.0 }, Point { x: -o.width / 2.0, y: o.height / 2.0 }];
    get_bounds_from_points(&points.iter().map(|p| apply_to_point(&o.local_to_world, p)).collect::<Vec<_>>()).expect("Obstacle corners must have bounds")
}

fn closest_between_segments(a: &TraceSegment, b: &TraceSegment, hypot: fn(f64, f64) -> f64) -> Point {
    if let Some(p) = get_segment_intersection(&a.start, &a.end, &b.start, &b.end) { return p; }
    let candidates = [
        (a.start, point_to_segment_closest_point(&a.start, &b.start, &b.end)),
        (a.end, point_to_segment_closest_point(&a.end, &b.start, &b.end)),
        (point_to_segment_closest_point(&b.start, &a.start, &a.end), b.start),
        (point_to_segment_closest_point(&b.end, &a.start, &a.end), b.end),
    ];
    let mut closest = (a.start, b.start);
    let mut closest_distance = f64::INFINITY;
    for candidate in candidates {
        let distance = hypot(candidate.0.x - candidate.1.x, candidate.0.y - candidate.1.y);
        if distance < closest_distance { closest = candidate; closest_distance = distance; }
    }
    Point { x: (closest.0.x + closest.1.x) / 2.0, y: (closest.0.y + closest.1.y) / 2.0 }
}

fn closest_segment_point(s: &TraceSegment, p: Point) -> Point {
    let closest = point_to_segment_closest_point(&p, &s.start, &s.end);
    Point { x: (closest.x + p.x) / 2.0, y: (closest.y + p.y) / 2.0 }
}

fn closest_segment_bounds(start: &Point, end: &Point, b: Bounds) -> Point {
    let center = Point { x: (b.min_x + b.max_x) / 2.0, y: (b.min_y + b.max_y) / 2.0 };
    let p = point_to_segment_closest_point(&center, start, end);
    let q = Point { x: b.min_x.max(b.max_x.min(p.x)), y: b.min_y.max(b.max_y.min(p.y)) };
    Point { x: (p.x + q.x) / 2.0, y: (p.y + q.y) / 2.0 }
}

fn trace_error_message(trace_id: &str, other: &str, gap: f64) -> String {
    if gap < 0.0 { format!("PCB trace {trace_id} overlaps with {other} (accidental contact)") }
    else { format!("PCB trace {trace_id} is too close to {other} (gap: {}mm)", js_to_fixed(gap, 3)) }
}

impl AutoroutingDrcEngine {
    pub fn new(srj: Value, conn_map: Option<Value>, options: Value) -> Result<Self, String> {
        Self::new_with_math(srj, conn_map, options, DrcMath::default())
    }

    pub fn new_with_math(srj: Value, conn_map: Option<Value>, options: Value, math: DrcMath) -> Result<Self, String> {
        let conn_map = conn_map.map(serde_json::from_value).transpose()
            .map_err(|error| format!("Invalid connectivity map: {error}"))?;
        let trace_clearance = optional_num(&options["traceClearance"], 0.1);
        let via_clearance = optional_num(&options["viaClearance"], 0.1).max(0.1);
        let via_to_pad_clearance = optional_num(&options["viaToPadClearance"], optional_num(&srj["minViaEdgeToPadEdgeClearance"], 0.1));
        let board_width = (num(&srj["bounds"]["maxX"]) - num(&srj["bounds"]["minX"])).max(0.0);
        let board_height = (num(&srj["bounds"]["maxY"]) - num(&srj["bounds"]["minY"])).max(0.0);
        let default_cell_size = 0.25f64.max(board_width.max(board_height) / 64.0).max(optional_num(&srj["minViaDiameter"], 0.3) + trace_clearance.max(via_to_pad_clearance));
        let cell_size = optional_num(&options["spatialCellSize"], default_cell_size);
        if !trace_clearance.is_finite() || trace_clearance < 0.0 { return Err("traceClearance must be a non-negative finite number".into()); }
        if !via_clearance.is_finite() { return Err("viaClearance must be a finite number".into()); }
        if !via_to_pad_clearance.is_finite() || via_to_pad_clearance < 0.0 { return Err("viaToPadClearance must be a non-negative finite number".into()); }
        if !cell_size.is_finite() || cell_size <= 0.0 { return Err("spatialCellSize must be a positive finite number".into()); }
        let mut engine = Self { compiled: Rc::new(CompiledDrcData { math, srj, trace_clearance, via_clearance, via_to_pad_clearance, cell_size, include_trace_via_owner_metadata: options["includeTraceViaOwnerMetadata"].as_bool().unwrap_or(false), canonical_net_by_alias: IndexMap::with_hasher(FxBuildHasher), conn_map_net_by_canonical_net: IndexMap::with_hasher(FxBuildHasher), obstacles: Vec::new(), obstacle_indexes_by_layer: IndexMap::with_hasher(FxBuildHasher) }), conn_map, last_run_stats: AutoroutingDrcEngineRunStats::default() };
        engine.compile_connection_aliases();
        let obstacles = engine.compile_static_obstacles();
        Rc::get_mut(&mut engine.compiled).expect("Unshared constructor data").obstacles = obstacles;
        engine.index_static_obstacles();
        Ok(engine)
    }

    pub fn fork_compiled(&self) -> Self {
        Self { compiled: self.compiled.clone(), conn_map: self.conn_map.clone(), last_run_stats: AutoroutingDrcEngineRunStats::default() }
    }

    fn conn_map_net(&self, id: &str) -> Option<&str> {
        self.conn_map.as_ref().and_then(|m| m.id_to_net_map.get(id)).map(String::as_str).filter(|s| !s.is_empty())
    }

    fn compile_connection_aliases(&mut self) {
        let mut nets: IndexMap<String, IndexSet<String>> = IndexMap::new();
        let mut aliases_by_name = IndexMap::with_hasher(FxBuildHasher);
        let mut canonical_nets = IndexMap::with_hasher(FxBuildHasher);
        for connection in array(&self.compiled.srj["connections"]) {
            let canonical = connection["netConnectionName"].as_str().or_else(|| connection["rootConnectionName"].as_str()).unwrap_or_else(|| string(&connection["name"]));
            let mut aliases = vec![&connection["name"], &connection["rootConnectionName"], &connection["netConnectionName"]];
            if let Some(merged) = connection["mergedConnectionNames"].as_array() { aliases.extend(merged); }
            for p in array(&connection["pointsToConnect"]) { aliases.push(&p["pointId"]); aliases.push(&p["pcb_port_id"]); }
            for alias in aliases {
                let Some(alias) = alias.as_str().filter(|s| !s.is_empty()) else { continue; };
                aliases_by_name.insert(alias.to_owned(), canonical.to_owned());
                if let Some(net) = self.conn_map_net(alias) { nets.entry(canonical.to_owned()).or_default().insert(net.to_owned()); }
            }
            aliases_by_name.insert(canonical.to_owned(), canonical.to_owned());
        }
        for (canonical, values) in nets {
            if values.len() == 1 { canonical_nets.insert(canonical, values.into_iter().next().unwrap()); }
        }
        let compiled = Rc::get_mut(&mut self.compiled).expect("Unshared constructor data");
        compiled.canonical_net_by_alias = aliases_by_name;
        compiled.conn_map_net_by_canonical_net = canonical_nets;
    }

    fn resolve_net_id<'a>(&'a self, id: &'a str) -> &'a str {
        if let Some(net) = self.conn_map_net(id) { return net; }
        let Some(canonical) = self.compiled.canonical_net_by_alias.get(id).filter(|s| !s.is_empty()) else { return id; };
        self.compiled.conn_map_net_by_canonical_net.get(canonical).unwrap_or(canonical)
    }

    fn compile_net<'a>(&'a self, id: &'a str, ids: &mut NetIds<'a>) -> ResolvedNet {
        if let Some(net) = ids.compiled.get(id) { return *net; }
        let net = ResolvedNet {
            id: ids.intern(id),
            conn_map_net: self.conn_map_net(id).map(|net| ids.intern(net)),
            resolved_id: ids.intern(self.resolve_net_id(id)),
        };
        ids.compiled.insert(id, net);
        net
    }

    fn are_connected(&self, left: &ResolvedNet, right: &ResolvedNet) -> bool {
        if left.id == right.id { return true; }
        if let (Some(a), Some(b)) = (left.conn_map_net, right.conn_map_net) { if a == b || b == left.id { return true; } }
        left.resolved_id == right.resolved_id
    }

    fn compile_static_obstacles(&self) -> Vec<StaticObstacle> {
        let mut obstacles = Vec::new();
        let mut added_smt_pad_ids = IndexSet::new();
        let mut added_plated_hole_ids = IndexSet::new();
        for o in array(&self.compiled.srj["obstacles"]) {
            let layers = strings(&o["layers"]);
            if layers.is_empty() { continue; }
            let connected_to = strings(&o["connectedTo"]);
            let smt_pad_id = connected_to.iter().find(|id| id.starts_with("pcb_smtpad_"));
            let plated_hole_id = connected_to.iter().find(|id| id.starts_with("pcb_plated_hole_"));
            let pcb_port_id = connected_to.iter().find(|id| id.starts_with("pcb_port_")).cloned();
            if smt_pad_id.is_none() && plated_hole_id.is_none() && pcb_port_id.is_none() { continue; }
            let multilayer = layers.len() > 1;
            let obstacle_type = if multilayer { "pcb_plated_hole" } else { "pcb_smtpad" };
            let x = num(&o["center"]["x"]);
            let y = num(&o["center"]["y"]);
            let obstacle_id = (if multilayer { plated_hole_id } else { smt_pad_id }).cloned().unwrap_or_else(|| format!("{obstacle_type}_{}_{}", js_to_fixed(x, 3), js_to_fixed(y, 3)));
            let added = if multilayer { &mut added_plated_hole_ids } else { &mut added_smt_pad_ids };
            if !added.insert(obstacle_id.clone()) { continue; }
            let rotation = o["ccwRotationDegrees"].as_f64().filter(|r| r.is_finite());
            let local_to_world = compose(&[translate(x, y), rotate_deg_with_math(rotation.unwrap_or(0.0), self.compiled.math.sin, self.compiled.math.cos)]);
            let width = num(&o["width"]);
            let height = num(&o["height"]);
            let radius = if rotation.is_none() && multilayer && (width - height).abs() < 0.001 { Some(width.max(height) / 2.0) } else { None };
            let world_to_local = inverse(&local_to_world);
            obstacles.push(StaticObstacle { obstacle_type: obstacle_type.into(), obstacle_id, connected_to, x, y, width, height, radius, local_to_world, world_to_local, layers, pcb_port_id });
        }
        obstacles
    }

    fn index_static_obstacles(&mut self) {
        let mut indexes = IndexMap::with_hasher(FxBuildHasher);
        for (i, obstacle) in self.compiled.obstacles.iter().enumerate() {
            let bounds = expand_bounds(get_obstacle_bounds(obstacle), self.compiled.trace_clearance.max(self.compiled.via_to_pad_clearance));
            for layer in &obstacle.layers {
                indexes.entry(layer.clone()).or_insert_with(|| SpatialHash::new(self.compiled.cell_size)).insert(i, bounds);
            }
        }
        Rc::get_mut(&mut self.compiled).expect("Unshared constructor data").obstacle_indexes_by_layer = indexes;
    }

    fn collect_dynamic_geometry<'a: 'n, 'n>(&'n self, traces: impl Iterator<Item = &'a SimplifiedTrace>, net_ids: &mut NetIds<'n>) -> (Vec<TraceSegment<'a>>, Vec<Via<'a>>) {
        let mut segments = Vec::new();
        let mut vias = Vec::new();
        let mut via_locations = IndexSet::new();
        for trace in traces {
            let net_id = self.compile_net(self.resolve_net_id(&trace.connection_name), net_ids);
            let trace_id = &trace.pcb_trace_id;
            let route = &trace.route;
            let mut port_ids = IndexSet::new();
            for point in route {
                let SimplifiedRoutePoint::Wire { start_pcb_port_id, end_pcb_port_id, .. } = point else { continue; };
                for id in [start_pcb_port_id, end_pcb_port_id] {
                    if let Some(id) = id.as_ref().filter(|id| !id.is_empty()) {
                        port_ids.insert(id.clone());
                    }
                }
            }
            let pcb_port_ids = Rc::new(port_ids.into_iter().collect::<Vec<String>>());
            for pair in route.windows(2) {
                let (
                    SimplifiedRoutePoint::Wire { x: ax, y: ay, width: start_width, layer: start_layer, .. },
                    SimplifiedRoutePoint::Wire { x: bx, y: by, width: end_width, layer: end_layer, .. },
                ) = (&pair[0], &pair[1]) else { continue; };
                if start_layer != end_layer { continue; }
                let a = Point { x: *ax, y: *ay };
                let b = Point { x: *bx, y: *by };
                if (a.x - b.x).abs() <= POSITION_EPSILON && (a.y - b.y).abs() <= POSITION_EPSILON { continue; }
                segments.push(TraceSegment {
                    order: segments.len(), trace_id: trace_id.as_str(), net_id, start: a, end: b,
                    width: start_width.unwrap_or(end_width.unwrap_or(0.1)), layer: start_layer.as_str(),
                    pcb_port_ids: pcb_port_ids.clone(),
                });
            }
            for point in route {
                let SimplifiedRoutePoint::Via { x, y, from_layer, to_layer, via_diameter, .. } = point else { continue; };
                let key = format!("{},{},{},{}", number_string(*x), number_string(*y), from_layer, to_layer);
                if !via_locations.insert(key) { continue; }
                vias.push(Via {
                    order: vias.len(), via_id: format!("via_{}", vias.len()), trace_id: trace_id.as_str(),
                    net_id, x: *x, y: *y,
                    diameter: via_diameter.unwrap_or(optional_num(&self.compiled.srj["minViaDiameter"], 0.3)),
                    layers: get_via_layers_from_span(from_layer, to_layer, self.compiled.srj["layerCount"].as_u64().expect("Expected layerCount") as usize),
                });
            }
        }
        (segments, vias)
    }

    fn build_dynamic_indexes(&self, segments: &[TraceSegment], vias: &[Via]) -> IndexMap<String, SpatialHash<DynamicCollidable>, FxBuildHasher> {
        let mut indexes: IndexMap<String, SpatialHash<DynamicCollidable>, FxBuildHasher> = IndexMap::with_hasher(FxBuildHasher);
        for (i, s) in segments.iter().enumerate() {
            indexes.entry(s.layer.to_owned()).or_insert_with(|| SpatialHash::new(self.compiled.cell_size)).insert(DynamicCollidable::Segment(i), expand_bounds(get_segment_bounds(s), self.compiled.trace_clearance));
        }
        for (i, v) in vias.iter().enumerate() {
            for layer in &v.layers { indexes.entry(layer.clone()).or_insert_with(|| SpatialHash::new(self.compiled.cell_size)).insert(DynamicCollidable::Via(i), expand_bounds(get_via_bounds(v), self.compiled.trace_clearance)); }
        }
        indexes
    }

    fn obstacle_shares_net(&self, net: &ResolvedNet, connected_to: &[ResolvedNet]) -> bool {
        connected_to.iter().any(|id| self.are_connected(net, id))
    }

    fn check_trace_pair(&mut self, a: &TraceSegment, b: &TraceSegment) -> Option<Value> {
        if self.are_connected(&a.net_id, &b.net_id) { return None; }
        self.last_run_stats.exact_check_count += 1;
        let gap = segment_to_segment_min_distance(&a.start, &a.end, &b.start, &b.end) - a.width / 2.0 - b.width / 2.0;
        if gap > self.compiled.trace_clearance - DRC_EPSILON { return None; }
        let ports: IndexSet<_> = a.pcb_port_ids.iter().chain(b.pcb_port_ids.iter()).cloned().collect();
        Some(json!({
            "type": "pcb_trace_error",
            "error_type": "pcb_trace_error",
            "message": trace_error_message(&a.trace_id, &format!("PCB trace {}", b.trace_id), gap),
            "pcb_trace_id": a.trace_id,
            "source_trace_id": "",
            "pcb_trace_error_id": format!("overlap_{}_{}", a.trace_id, b.trace_id),
            "minimum_clearance": self.compiled.trace_clearance,
            "actual_clearance": gap,
            "pcb_component_ids": [],
            "pcb_port_ids": ports,
            "center": point_json(closest_between_segments(a, b, self.compiled.math.hypot)),
        }))
    }

    fn check_trace_via(&mut self, s: &TraceSegment, v: &Via) -> Option<Value> {
        if self.are_connected(&s.net_id, &v.net_id) { return None; }
        self.last_run_stats.exact_check_count += 1;
        let gap = segment_to_circle_min_distance(&s.start, &s.end, &Circle { x: v.x, y: v.y, radius: v.diameter / 2.0 }) - s.width / 2.0;
        if gap > self.compiled.trace_clearance - DRC_EPSILON { return None; }
        let mut error = json!({
            "type": "pcb_trace_error",
            "error_type": "pcb_trace_error",
            "message": trace_error_message(&s.trace_id, &format!("pcb_via \"{}\"", v.via_id), gap),
            "pcb_trace_id": s.trace_id,
        });
        if self.compiled.include_trace_via_owner_metadata {
            error["pcb_trace_ids"] = json!([s.trace_id, v.trace_id]);
            error["pcb_via_id"] = json!(v.via_id);
            error["pcb_via_ids"] = json!([v.via_id]);
        }
        error["source_trace_id"] = json!("");
        error["pcb_trace_error_id"] = json!(format!("overlap_{}_{}", s.trace_id, v.via_id));
        error["minimum_clearance"] = json!(self.compiled.trace_clearance);
        error["actual_clearance"] = json!(gap);
        error["pcb_component_ids"] = json!([]);
        error["pcb_port_ids"] = json!(s.pcb_port_ids.as_ref());
        error["center"] = point_json(closest_segment_point(s, Point { x: v.x, y: v.y }));
        Some(error)
    }

    fn check_trace_obstacle(&mut self, s: &TraceSegment, obstacle_index: usize, connected_to: &[ResolvedNet]) -> Option<Value> {
        let o = &self.compiled.obstacles[obstacle_index];
        if self.obstacle_shares_net(&s.net_id, connected_to) { return None; }
        self.last_run_stats.exact_check_count += 1;
        let bounds = get_obstacle_local_bounds(o);
        let local_start = apply_to_point(&o.world_to_local, &s.start);
        let local_end = apply_to_point(&o.world_to_local, &s.end);
        let shape_distance = match o.radius {
            None => segment_to_bounds_min_distance(&local_start, &local_end, &bounds),
            Some(radius) => segment_to_circle_min_distance(&s.start, &s.end, &Circle { x: o.x, y: o.y, radius }),
        };
        let gap = shape_distance - s.width / 2.0;
        if gap + DRC_EPSILON >= self.compiled.trace_clearance { return None; }
        let mut ports: IndexSet<String> = s.pcb_port_ids.iter().cloned().collect();
        if let Some(id) = &o.pcb_port_id { ports.insert(id.clone()); }
        let center = if o.radius.is_none() { apply_to_point(&o.local_to_world, &closest_segment_bounds(&local_start, &local_end, bounds)) } else { closest_segment_point(s, Point { x: o.x, y: o.y }) };
        Some(json!({
            "type": "pcb_trace_error",
            "error_type": "pcb_trace_error",
            "message": trace_error_message(&s.trace_id, &format!("{} \"{}\"", o.obstacle_type, o.obstacle_id), gap),
            "pcb_trace_id": s.trace_id,
            "source_trace_id": "",
            "pcb_trace_error_id": format!("overlap_{}_{}", s.trace_id, o.obstacle_id),
            "minimum_clearance": self.compiled.trace_clearance,
            "actual_clearance": gap,
            "pcb_component_ids": [],
            "pcb_port_ids": ports,
            "center": point_json(center),
        }))
    }

    fn check_via_obstacle(&mut self, v: &Via, obstacle_index: usize, connected_to: &[ResolvedNet]) -> Option<Value> {
        let o = &self.compiled.obstacles[obstacle_index];
        if self.obstacle_shares_net(&v.net_id, connected_to) { return None; }
        self.last_run_stats.exact_check_count += 1;
        let bounds = get_obstacle_local_bounds(o);
        let local_via = apply_to_point(&o.world_to_local, &Point { x: v.x, y: v.y });
        let distance = match o.radius {
            None => (self.compiled.math.hypot)((bounds.min_x - local_via.x).max(0.0).max(local_via.x - bounds.max_x), (bounds.min_y - local_via.y).max(0.0).max(local_via.y - bounds.max_y)),
            Some(radius) => (self.compiled.math.hypot)(v.x - o.x, v.y - o.y) - radius,
        };
        let gap = distance - v.diameter / 2.0;
        if gap + DRC_EPSILON >= self.compiled.via_to_pad_clearance { return None; }
        Some(json!({
            "type": "pcb_pad_pad_clearance_error",
            "error_type": "pcb_pad_pad_clearance_error",
            "pcb_pad_pad_clearance_error_id": format!("via_pad_clearance_{}_{}", v.via_id, o.obstacle_id),
            "message": format!("pcb_via \"{}\" and {} \"{}\" are too close (gap: {}mm)", v.via_id, o.obstacle_type, o.obstacle_id, js_to_fixed(gap, 3)),
            "pcb_trace_id": v.trace_id,
            "pcb_pad_ids": [v.via_id, o.obstacle_id],
            "pcb_via_ids": [v.via_id],
            "minimum_clearance": self.compiled.via_to_pad_clearance,
            "actual_clearance": gap,
            "center": {"x": (v.x + o.x) / 2.0, "y": (v.y + o.y) / 2.0},
        }))
    }

    fn check_via_pairs(&mut self, vias: &[Via]) -> Vec<Value> {
        if vias.len() < 2 { return Vec::new(); }
        let mut errors = Vec::new();
        let mut index = SpatialHash::new(self.compiled.cell_size);
        for (i, via) in vias.iter().enumerate() { index.insert(i, expand_bounds(get_via_bounds(via), self.compiled.via_clearance)); }
        let mut query = QueryScratch::new(vias.len());
        for a in vias {
            query.begin();
            index.query(get_via_bounds(a), &mut query);
            for &i in &query.results {
                let b = &vias[i];
                self.last_run_stats.broad_phase_candidate_count += 1;
                if b.order <= a.order { continue; }
                self.last_run_stats.exact_check_count += 1;
                let center_distance = (self.compiled.math.hypot)(a.x - b.x, a.y - b.y);
                if center_distance <= POSITION_EPSILON { continue; }
                let gap = center_distance - a.diameter / 2.0 - b.diameter / 2.0;
                if gap + DRC_EPSILON >= self.compiled.via_clearance { continue; }
                let same_net = self.are_connected(&a.net_id, &b.net_id);
                let mut pair = [&a.via_id, &b.via_id];
                pair.sort();
                let pair_id = format!("{}_{}", pair[0], pair[1]);
                let center = json!({"x": (a.x + b.x) / 2.0, "y": (a.y + b.y) / 2.0});
                let mut error = json!({
                    "type": "pcb_via_clearance_error",
                    "error_type": "pcb_via_clearance_error",
                    "pcb_error_id": format!("{}_vias_close_{pair_id}", if same_net { "same_net" } else { "different_net" }),
                    "message": format!("Vias {} and {}{} are too close together (gap: {}mm)", a.via_id, b.via_id, if same_net { "" } else { " from different nets" }, js_to_fixed(gap, 3)),
                    "pcb_via_ids": [a.via_id, b.via_id],
                });
                if self.compiled.include_trace_via_owner_metadata { error["pcb_trace_ids"] = json!([a.trace_id, b.trace_id]); }
                error["pcb_via_pair_net_relation"] = json!(if same_net { "same_net" } else { "different_net" });
                error["minimum_clearance"] = json!(self.compiled.via_clearance);
                error["actual_clearance"] = json!(gap);
                error["pcb_center"] = center.clone();
                error["center"] = center;
                errors.push(error);
            }
        }
        errors
    }

    pub fn evaluate(&mut self, traces: &Value) -> Value {
        self.evaluate_slice(array(traces))
    }

    pub fn evaluate_legacy(&mut self, traces: &Value) -> Value {
        self.evaluate_internal(array(traces).iter(), false)
    }

    pub fn evaluate_slice(&mut self, traces: &[Value]) -> Value {
        self.evaluate_internal(traces.iter(), true)
    }

    pub fn evaluate_trace_view(&mut self, traces: &[&Value]) -> Value {
        self.evaluate_internal(traces.iter().copied(), true)
    }

    pub fn evaluate_typed_trace_view(&mut self, traces: &[&SimplifiedTrace]) -> Value {
        self.evaluate_typed_internal(traces.iter().copied(), true)
    }

    pub fn evaluate_typed_trace_errors(&mut self, traces: &[&SimplifiedTrace]) -> Vec<Value> {
        self.evaluate_typed_errors_internal(traces.iter().copied(), true)
    }

    pub fn evaluate_trace_errors(&mut self, traces: &[&Value]) -> Vec<Value> {
        let traces: Vec<SimplifiedTrace> = traces.iter().map(|trace| SimplifiedTrace::from_value(trace)).collect();
        self.evaluate_typed_errors_internal(traces.iter(), true)
    }

    fn evaluate_internal<'a>(&mut self, traces: impl ExactSizeIterator<Item = &'a Value>, include_via_pad_errors: bool) -> Value {
        let traces: Vec<SimplifiedTrace> = traces.map(SimplifiedTrace::from_value).collect();
        self.evaluate_typed_internal(traces.iter(), include_via_pad_errors)
    }

    fn evaluate_typed_internal<'a>(&mut self, traces: impl ExactSizeIterator<Item = &'a SimplifiedTrace>, include_via_pad_errors: bool) -> Value {
        let errors = self.evaluate_typed_errors_internal(traces, include_via_pad_errors);
        let errors_with_centers: Vec<_> = errors.iter().filter(|error| !error["center"].is_null()).collect();
        json!({ "errors": errors, "errorsWithCenters": errors_with_centers, "locationAwareErrors": errors_with_centers })
    }

    fn evaluate_typed_errors_internal<'a>(&mut self, traces: impl ExactSizeIterator<Item = &'a SimplifiedTrace>, include_via_pad_errors: bool) -> Vec<Value> {
        let trace_count = traces.len();
        let mut net_ids = NetIds::new();
        let (segments, vias) = self.collect_dynamic_geometry(traces, &mut net_ids);
        let obstacle_nets: Vec<Vec<ResolvedNet>> = self.compiled.obstacles.iter().map(|obstacle| {
            obstacle.connected_to.iter().map(|id| self.compile_net(id, &mut net_ids)).collect()
        }).collect();
        drop(net_ids);
        let dynamic_indexes = self.build_dynamic_indexes(&segments, &vias);
        let mut detected_trace_errors = Vec::new();
        let mut detected_via_pad_errors = Vec::new();
        self.last_run_stats = AutoroutingDrcEngineRunStats { trace_count, segment_count: segments.len(), via_count: vias.len(), obstacle_count: self.compiled.obstacles.len(), broad_phase_candidate_count: 0, exact_check_count: 0 };
        let mut dynamic_query = QueryScratch::new(segments.len().max(vias.len()) * 2);
        let mut obstacle_query = QueryScratch::new(self.compiled.obstacles.len());
        for s in &segments {
            let bounds = get_segment_bounds(s);
            dynamic_query.begin();
            obstacle_query.begin();
            if let Some(index) = dynamic_indexes.get(s.layer) { index.query(bounds, &mut dynamic_query); }
            if let Some(index) = self.compiled.obstacle_indexes_by_layer.get(s.layer) { index.query(bounds, &mut obstacle_query); }
            for &candidate in &dynamic_query.results {
                self.last_run_stats.broad_phase_candidate_count += 1;
                let error = match candidate {
                    DynamicCollidable::Segment(i) => {
                        if segments[i].order <= s.order { continue; }
                        self.check_trace_pair(s, &segments[i])
                    }
                    DynamicCollidable::Via(i) => self.check_trace_via(s, &vias[i]),
                };
                if let Some(error) = error { detected_trace_errors.push(error); }
            }
            for &i in &obstacle_query.results {
                self.last_run_stats.broad_phase_candidate_count += 1;
                if let Some(error) = self.check_trace_obstacle(s, i, &obstacle_nets[i]) { detected_trace_errors.push(error); }
            }
        }
        let detected_via_errors = self.check_via_pairs(&vias);
        if include_via_pad_errors {
            for via in &vias {
                obstacle_query.begin();
                for layer in &via.layers {
                    if let Some(index) = self.compiled.obstacle_indexes_by_layer.get(layer) { index.query(get_via_bounds(via), &mut obstacle_query); }
                }
                for &i in &obstacle_query.results {
                    self.last_run_stats.broad_phase_candidate_count += 1;
                    if let Some(error) = self.check_via_obstacle(via, i, &obstacle_nets[i]) { detected_via_pad_errors.push(error); }
                }
            }
        }
        let mut first_trace_error_by_id: IndexMap<String, Value, FxBuildHasher> = IndexMap::with_hasher(FxBuildHasher);
        for mut error in detected_trace_errors {
            let id = string(&error["pcb_trace_error_id"]).to_owned();
            let actual = num(&error["actual_clearance"]);
            if let Some(existing) = first_trace_error_by_id.get_mut(&id) {
                let worst = num(&existing["worst_actual_clearance"]);
                if actual < worst || !worst.is_finite() {
                    existing["worst_contact_center"] = error["center"].clone();
                    existing["worst_contact_message"] = error["message"].clone();
                    existing["worst_actual_clearance"] = json!(actual);
                }
            } else {
                error["first_contact_center"] = error["center"].clone();
                error["first_contact_message"] = error["message"].clone();
                error["first_actual_clearance"] = json!(actual);
                error["worst_contact_center"] = error["center"].clone();
                error["worst_contact_message"] = error["message"].clone();
                error["worst_actual_clearance"] = json!(actual);
                first_trace_error_by_id.insert(id, error);
            }
        }
        let mut errors: Vec<Value> = first_trace_error_by_id.into_values().map(|mut error| {
            if error["worst_contact_center"].is_object() { error["center"] = error["worst_contact_center"].clone(); }
            if error["worst_contact_message"].is_string() { error["message"] = error["worst_contact_message"].clone(); }
            if error["worst_actual_clearance"].is_number() { error["actual_clearance"] = error["worst_actual_clearance"].clone(); }
            error
        }).collect();
        errors.extend(detected_via_pad_errors);
        errors.extend(detected_via_errors);
        errors
    }
}

#[cfg(test)]
mod compiled_fork_tests {
    use super::*;

    #[test]
    fn compiled_fork_shares_only_immutable_constructor_data() {
        let srj = json!({"bounds":{"minX":0,"minY":0,"maxX":2,"maxY":2},"layerCount":2,"connections":[],"obstacles":[]});
        let original = AutoroutingDrcEngine::new(srj,Some(json!({"idToNetMap":{"a":"net"}})),json!({})).unwrap();
        let mut fork = original.fork_compiled();
        assert!(Rc::ptr_eq(&original.compiled,&fork.compiled));
        fork.conn_map.as_mut().unwrap().id_to_net_map.insert("a".into(),"other".into());
        assert_eq!(original.conn_map.as_ref().unwrap().id_to_net_map["a"],"net");
        fork.last_run_stats.trace_count=12;
        assert_eq!(original.last_run_stats.trace_count,0);
        drop(original);
        assert_eq!(fork.evaluate(&json!([]))["errors"],json!([]));
        for mapping in [json!({}), json!({"a":"b","b":"c","c":""}),
            json!({"":"a","a":"net","b":"a","other":"net"}),
            json!({"a":"a","b":"b","other":""})] {
            fork.conn_map = Some(serde_json::from_value(json!({"idToNetMap":mapping})).unwrap());
            let names = ["", "a", "b", "c", "net", "other", "missing"];
            let mut ids = NetIds::new();
            for left in names {
                for right in names {
                    let a = fork.compile_net(left, &mut ids);
                    let b = fork.compile_net(right, &mut ids);
                    let expected = left == right || match (fork.conn_map_net(left), fork.conn_map_net(right)) {
                        (Some(x), Some(y)) => x == y || y == left,
                        _ => false,
                    } || fork.resolve_net_id(left) == fork.resolve_net_id(right);
                    assert_eq!(fork.are_connected(&a, &b), expected);
                }
            }
            assert_eq!(ids.compiled.len(), names.len());
            // Keys borrow the supplied strings; resolving repeated names does
            // not allocate or retain an owned copy of each spelling.
            assert!(ids.ids.keys().all(|key| names.iter().any(|name| name.as_ptr() == key.as_ptr())
                || fork.conn_map.as_ref().unwrap().id_to_net_map.values().any(|name| name.as_ptr() == key.as_ptr())));
        }
    }
}
