use crate::shared_maps::NetByConnectionName;
use std::collections::HashSet;
use std::rc::Rc;
use indexmap::IndexMap;
use serde_json::{json, Value};
use intra_node_routing::specialized_base_solver::{BaseSolverState, SpecializedSolver};
use intra_node_routing::js_number::js_number_to_string;
use crate::types::{ColorMapRef, Point, Point2, RouteRef, PointRef, ObstacleRef, ConnectivityMap, structured_clone_routes, spread_point, fresh_via, next_identity};
use crate::data_structures::{high_density_route_spatial_index::HighDensityRouteSpatialIndex, obstacle_tree::ObstacleSpatialHashIndex};
use crate::math_utils::segment_to_box_min_distance;

const NEAR_VIA_MERGE_DISTANCE_MULTIPLIER: f64 = 2.5;
const OBSTACLE_MARGIN: f64 = 0.1;

#[derive(Clone)]
pub struct Via {
    pub identity: u64,
    pub x: f64, pub y: f64, pub diameter: f64, pub net: String,
    pub route_index: usize, pub layers: Vec<f64>, pub mutable: bool,
}

#[derive(Clone)]
pub struct ViaGroup { pub keep: Rc<Via>, pub remove: Vec<Rc<Via>> }

pub struct SameNetViaMergerSolverInput {
    pub input_hd_routes: Vec<RouteRef>, pub other_hd_routes: Vec<RouteRef>,
    pub net_by_connection_name: Option<Rc<NetByConnectionName>>,
    pub obstacles: Vec<ObstacleRef>, pub layer_count: f64, pub conn_map: Rc<ConnectivityMap>,
    pub color_map: ColorMapRef, pub outline: Option<Vec<Point2>>, pub preserve_route_endpoints: bool,
}

pub fn via_transition_cluster_touches_route_endpoint(route: &RouteRef, via: &PointRef) -> bool {
    let route = route.borrow(); let via = via.borrow();
    for index in 0..route.route.len().saturating_sub(1) {
        let point = route.route[index].borrow(); let next = route.route[index + 1].borrow();
        if point.z == next.z || point.x != via.x || point.y != via.y || next.x != via.x || next.y != via.y { continue; }
        let mut start = index;
        while start > 0 {
            let p = route.route[start - 1].borrow();
            if p.x != via.x || p.y != via.y { break; }
            start -= 1;
        }
        let mut end = index + 1;
        while end < route.route.len() - 1 {
            let p = route.route[end + 1].borrow();
            if p.x != via.x || p.y != via.y { break; }
            end += 1;
        }
        if start == 0 || end == route.route.len() - 1 { return true; }
    }
    false
}

pub fn try_get_net_for_route(conn: &ConnectivityMap, route: &RouteRef, explicit: Option<&NetByConnectionName>) -> Option<String> {
    let route = route.borrow();
    explicit.and_then(|map| map.get(&route.connection_name)).or_else(|| conn.id_to_net_map.get(&route.connection_name))
        .or_else(|| route.root_connection_name.as_ref().filter(|root| !root.is_empty()).and_then(|root| conn.id_to_net_map.get(root))).cloned()
}

pub fn get_net_for_route(conn: &ConnectivityMap, route: &RouteRef, explicit: Option<&NetByConnectionName>) -> Result<String, String> {
    let net = try_get_net_for_route(conn, route, explicit);
    match net.filter(|net| !net.is_empty()) {
        Some(net) => Ok(net),
        None => Err(format!("SameNetViaMergerSolver could not find net for route \"{}\"", route.borrow().connection_name)),
    }
}

pub fn obstacle_is_same_net(conn: &ConnectivityMap, obstacle: &ObstacleRef, via: &Via) -> bool {
    let obstacle = obstacle.borrow();
    for id in obstacle.connected_to.iter() {
        if id == &via.net || conn.id_to_net_map.get(id) == Some(&via.net) || conn.are_ids_connected(id, &via.net) { return true; }
    }
    false
}

pub struct SameNetViaMergerSolver {
    pub identity: u64,
    pub input_routes_array_identity: u64, pub merged_routes_array_identity: u64, pub unprocessed_routes_array_identity: u64,
    pub vias_by_net_identity: u64,
    pub vias_array_identity: u64, pub offending_vias_array_identity: u64, pub current_via_routes_array_identity: u64,
    pub base: BaseSolverState, pub stats: Value,
    pub input: SameNetViaMergerSolverInput,
    pub input_hd_routes: Vec<RouteRef>, pub merged_via_hd_routes: Vec<RouteRef>, pub unprocessed_routes: Vec<RouteRef>,
    pub vias: Vec<Rc<Via>>, pub offending_vias: Vec<(Rc<Via>, Rc<Via>)>, pub current_via_routes: Vec<RouteRef>,
    pub conn_map: Rc<ConnectivityMap>, pub color_map: ColorMapRef, pub outline: Option<Vec<Point2>>, pub obstacles: Vec<ObstacleRef>,
    pub vias_by_net: IndexMap<String, Vec<Rc<Via>>>, pub net_by_connection_name: Option<Rc<NetByConnectionName>>,
    pub obstacle_shi: ObstacleSpatialHashIndex, pub hd_route_shi: HighDensityRouteSpatialIndex,
}

impl SameNetViaMergerSolver {
    pub fn new(mut input: SameNetViaMergerSolverInput) -> Result<Self, String> {
        input.obstacles = crate::utils::create_objects_with_z_layers::normalize_obstacles(input.obstacles, input.layer_count);
        let merged = structured_clone_routes(&input.input_hd_routes);
        let obstacle_shi = ObstacleSpatialHashIndex::new_flatbush(input.obstacles.clone());
        let hd_route_shi = HighDensityRouteSpatialIndex::new(merged.iter().chain(input.other_hd_routes.iter()).cloned().collect(), 1.0);
        let mut solver = Self {
            identity: next_identity(), input_routes_array_identity: next_identity(), merged_routes_array_identity: next_identity(),
            unprocessed_routes_array_identity: next_identity(), vias_array_identity: next_identity(), vias_by_net_identity: next_identity(),
            offending_vias_array_identity: next_identity(), current_via_routes_array_identity: next_identity(),
            base: BaseSolverState { max_iterations: 1e6, ..Default::default() }, stats: json!({}),
            input_hd_routes: input.input_hd_routes.clone(), merged_via_hd_routes: merged, unprocessed_routes: input.input_hd_routes.clone(),
            color_map: input.color_map.clone(), outline: input.outline.clone(), obstacles: input.obstacles.clone(),
            obstacle_shi, hd_route_shi, vias: Vec::new(), offending_vias: Vec::new(), current_via_routes: Vec::new(),
            conn_map: input.conn_map.clone(), net_by_connection_name: input.net_by_connection_name.clone(), vias_by_net: IndexMap::new(), input,
        };
        solver.rebuild_vias()?;
        Ok(solver)
    }

    pub fn create_hd_route_spatial_index(&self) -> HighDensityRouteSpatialIndex {
        HighDensityRouteSpatialIndex::new(self.merged_via_hd_routes.iter().chain(self.input.other_hd_routes.iter()).cloned().collect(), 1.0)
    }

    pub fn rebuild_vias(&mut self) -> Result<(), String> {
        self.vias = Vec::new(); self.vias_array_identity = next_identity(); self.vias_by_net = IndexMap::new(); self.vias_by_net_identity = next_identity();
        let routes: Vec<_> = self.merged_via_hd_routes.iter().enumerate().map(|(i, r)| (r.clone(), i, true))
            .chain(self.input.other_hd_routes.iter().enumerate().map(|(i, r)| (r.clone(), self.merged_via_hd_routes.len() + i, false))).collect();
        for (route_ref, index, mutable) in routes {
            if route_ref.borrow().vias.is_empty() { continue; }
            let net = if mutable { Some(get_net_for_route(&self.conn_map, &route_ref, self.net_by_connection_name.as_deref())?) }
                else { try_get_net_for_route(&self.conn_map, &route_ref, self.net_by_connection_name.as_deref()) };
            let Some(net) = net.filter(|net| !net.is_empty()) else { continue; };
            let route = route_ref.borrow();
            for point in &route.vias {
                let mut layers = Vec::new();
                for p in &route.route { let z = p.borrow().z; if !layers.iter().any(|old: &f64| *old == z || (old.is_nan() && z.is_nan())) { layers.push(z); } }
                if layers.is_empty() { return Err(format!("SameNetViaMergerSolver found via on route \"{}\" with no route points", route.connection_name)); }
                let p = point.borrow();
                let via = Rc::new(Via { identity: next_identity(), x: p.x, y: p.y, diameter: route.via_diameter, net: net.clone(), layers,
                    route_index: index, mutable: mutable && !(self.input.preserve_route_endpoints && via_transition_cluster_touches_route_endpoint(&route_ref, point)) });
                self.vias.push(via.clone()); self.vias_by_net.entry(net.clone()).or_default().push(via);
            }
        }
        Ok(())
    }

    pub fn get_via_key(&self, via: &Via) -> String {
        format!("{}:{}:{}:{}:{}:{}", if via.mutable { "mutable" } else { "immutable" }, via.route_index,
            js_number_to_string(via.x), js_number_to_string(via.y), via.layers.iter().map(|z| js_number_to_string(*z)).collect::<Vec<_>>().join(","), via.net)
    }

    pub fn dedupe_route_vias(&self, route: &RouteRef) {
        let mut seen = HashSet::new();
        let mut route = route.borrow_mut();
        route.vias_array_identity = next_identity();
        route.vias.retain(|via| {
            let via = via.borrow();
            seen.insert(format!("{}:{}", js_number_to_string(via.x), js_number_to_string(via.y)))
        });
    }

    pub fn can_move_via_to(&self, remove: &Via, keep: &Via) -> Result<bool, String> {
        let route = self.merged_via_hd_routes.get(remove.route_index).ok_or_else(|| format!("SameNetViaMergerSolver could not find route for via at index {}", remove.route_index))?.borrow();
        let mut layers = Vec::new();
        for pair in route.route.windows(2) {
            let a = pair[0].borrow(); let b = pair[1].borrow();
            if a.z == b.z || a.x != remove.x || a.y != remove.y || b.x != remove.x || b.y != remove.y { continue; }
            for z in [a.z, b.z] { if !layers.contains(&z) { layers.push(z); } }
        }
        if layers.is_empty() { return Err(format!("SameNetViaMergerSolver could not find transition layers for via at ({}, {})", js_number_to_string(remove.x), js_number_to_string(remove.y))); }
        for z in layers {
            let thickness = route.trace_thickness;
            let start = Point { x: remove.x, y: remove.y, z }; let end = Point { x: keep.x, y: keep.y, z };
            if start.x == end.x && start.y == end.y { continue; }
            for conflict in self.hd_route_shi.get_conflicting_routes_for_segment(&start, &end, thickness / 2.0) {
                if conflict.conflicting_route.borrow().connection_name == route.connection_name { continue; }
                if try_get_net_for_route(&self.conn_map, &conflict.conflicting_route, self.net_by_connection_name.as_deref()).as_deref() == Some(remove.net.as_str()) { continue; }
                if conflict.distance < thickness / 2.0 + conflict.conflicting_route.borrow().trace_thickness / 2.0 { return Ok(false); }
            }
            let margin = thickness / 2.0 + OBSTACLE_MARGIN;
            for obstacle in self.obstacle_shi.search_area((start.x + end.x) / 2.0, (start.y + end.y) / 2.0, (start.x - end.x).abs() + margin * 2.0, (start.y - end.y).abs() + margin * 2.0)? {
                if obstacle.borrow().metadata.get("__zLayers").is_none_or(Value::is_null) { return Err(format!("SameNetViaMergerSolver found obstacle without zLayers near via at ({}, {})", js_number_to_string(remove.x), js_number_to_string(remove.y))); }
                if !obstacle.borrow().z_layers.contains(&z) { continue; }
                if obstacle_is_same_net(&self.conn_map, &obstacle, remove) { continue; }
                let obstacle = obstacle.borrow();
                if segment_to_box_min_distance(Point2 { x: start.x, y: start.y }, Point2 { x: end.x, y: end.y }, obstacle.center, obstacle.width, obstacle.height) < margin { return Ok(false); }
            }
        }
        Ok(true)
    }

    pub fn get_offending_via_groups_batch(&self) -> Result<Vec<ViaGroup>, String> {
        let mut groups = Vec::new(); let mut touched = HashSet::new(); let mut candidates = Vec::new();
        for vias in self.vias_by_net.values() {
            if vias.len() < 2 { continue; }
            let cell_size = vias.iter().fold(1e-6_f64, |max, via| crate::math_utils::max(max, via.diameter));
            let mut buckets: IndexMap<String, Vec<usize>> = IndexMap::new();
            for (index, via) in vias.iter().enumerate() {
                let x = (via.x / cell_size).floor(); let y = (via.y / cell_size).floor();
                buckets.entry(format!("{}:{}", js_number_to_string(x), js_number_to_string(y))).or_default().push(index);
            }
            for (index, keep) in vias.iter().enumerate() {
                let x = (keep.x / cell_size).floor(); let y = (keep.y / cell_size).floor();
                let radius = NEAR_VIA_MERGE_DISTANCE_MULTIPLIER.ceil() as i32;
                let mut remove = Vec::new();
                for dx in -radius..=radius {
                    for dy in -radius..=radius {
                        let key = format!("{}:{}", js_number_to_string(x + dx as f64), js_number_to_string(y + dy as f64));
                        let Some(bucket) = buckets.get(&key) else { continue; };
                        for candidate_index in bucket {
                            if *candidate_index == index { continue; }
                            let candidate = &vias[*candidate_index];
                            if !candidate.mutable { continue; }
                            let pair_dx = keep.x - candidate.x; let pair_dy = keep.y - candidate.y;
                            let squared = pair_dx * pair_dx + pair_dy * pair_dy;
                            let overlap = keep.diameter / 2.0 + candidate.diameter / 2.0;
                            let near = overlap * NEAR_VIA_MERGE_DISTANCE_MULTIPLIER;
                            if squared == 0.0 {
                                if !keep.mutable { remove.push(candidate.clone()); }
                                continue;
                            }
                            if squared <= overlap * overlap { remove.push(candidate.clone()); continue; }
                            if squared <= near * near && self.can_move_via_to(candidate, keep)? { remove.push(candidate.clone()); }
                        }
                    }
                }
                if !remove.is_empty() { candidates.push(ViaGroup { keep: keep.clone(), remove }); }
            }
        }
        candidates.sort_by(|a, b| {
            b.remove.len().cmp(&a.remove.len())
                .then_with(|| a.keep.mutable.cmp(&b.keep.mutable))
                .then_with(|| b.keep.layers.len().cmp(&a.keep.layers.len()))
                .then_with(|| a.keep.route_index.cmp(&b.keep.route_index))
        });
        for candidate in candidates {
            let key = self.get_via_key(&candidate.keep);
            if touched.contains(&key) { continue; }
            let remove: Vec<_> = candidate.remove.into_iter().filter(|via| !touched.contains(&self.get_via_key(via))).collect();
            if remove.is_empty() { continue; }
            touched.insert(key);
            for via in &remove { touched.insert(self.get_via_key(via)); }
            groups.push(ViaGroup { keep: candidate.keep, remove });
        }
        Ok(groups)
    }

    pub fn move_via_to(&mut self, remove: &Via, keep: &Via, rebuild: bool) -> Result<(), String> {
        if !remove.mutable { return Err("SameNetViaMergerSolver cannot mutate an immutable via anchor".into()); }
        let route_ref = self.merged_via_hd_routes.get(remove.route_index).ok_or_else(|| format!("SameNetViaMergerSolver could not find route for via at index {}", remove.route_index))?.clone();
        let mut route = route_ref.borrow_mut();
        let mut indexes = indexmap::IndexSet::new();
        let mut replaced = false;
        for j in (1..route.route.len()).rev() {
            let prev = route.route[j - 1].borrow(); let current = route.route[j].borrow();
            if prev.z == current.z || prev.x != remove.x || prev.y != remove.y || current.x != remove.x || current.y != remove.y { continue; }
            let mut start = j - 1;
            while start > 0 {
                let p = route.route[start - 1].borrow();
                if p.x != remove.x || p.y != remove.y { break; }
                start -= 1;
            }
            let mut end = j;
            while end < route.route.len() - 1 {
                let p = route.route[end + 1].borrow();
                if p.x != remove.x || p.y != remove.y { break; }
                end += 1;
            }
            for k in start..=end { indexes.insert(k); }
        }
        if indexes.is_empty() { return Err(format!("SameNetViaMergerSolver could not find route transition for via at ({}, {}) on route \"{}\"", js_number_to_string(remove.x), js_number_to_string(remove.y), route.connection_name)); }
        for index in indexes {
            let point = spread_point(&route.route[index]);
            point.borrow_mut().x = keep.x; point.borrow_mut().y = keep.y;
            route.route[index] = point;
        }
        route.vias_array_identity = next_identity();
        route.vias = route.vias.iter().flat_map(|via| {
            let p = via.borrow();
            if p.x != remove.x || p.y != remove.y { return vec![via.clone()]; }
            replaced = true;
            if keep.mutable { vec![fresh_via(keep.x, keep.y)] } else { Vec::new() }
        }).collect();
        if !replaced { return Err(format!("SameNetViaMergerSolver could not find via at ({}, {}) on route \"{}\"", js_number_to_string(remove.x), js_number_to_string(remove.y), route.connection_name)); }
        drop(route);
        self.dedupe_route_vias(&route_ref);
        if rebuild { self.rebuild_vias()?; }
        Ok(())
    }

    pub fn get_merged_via_hd_routes(&self) -> &[RouteRef] {
        &self.merged_via_hd_routes
    }
}

impl SpecializedSolver for SameNetViaMergerSolver {
    fn base(&self) -> &BaseSolverState { &self.base }
    fn base_mut(&mut self) -> &mut BaseSolverState { &mut self.base }
    fn get_solver_name(&self) -> &'static str { "SameNetViaMergerSolver" }

    fn _step(&mut self) -> Result<(), String> {
        crate::connectivity_read_barrier::check(&self.conn_map)?;
        let groups = self.get_offending_via_groups_batch()?;
        if groups.is_empty() { self.base.solved = true; return Ok(()); }
        let mut count = 0;
        for group in &groups {
            for remove in &group.remove { self.move_via_to(remove, &group.keep, false)?; count += 1; }
        }
        self.rebuild_vias()?;
        self.hd_route_shi = self.create_hd_route_spatial_index();
        self.stats["mergedViaGroups"] = json!(groups.len());
        self.stats["mergedViaCount"] = json!(count);
        Ok(())
    }
}

impl Via {
    fn snapshot(&self, codec: &mut crate::graph_codec::GraphCodec) -> Value {
        codec.object(self.identity, json!({"x":self.x,"y":self.y,"diameter":self.diameter,"net":self.net,
            "layers":self.layers,"routeIndex":self.route_index,"mutable":self.mutable}))
    }

    fn restore(value: &Value) -> Result<Rc<Self>, String> {
        let fields = value.get("fields").unwrap_or(value);
        Ok(Rc::new(Self {
            identity: value["$object"].as_u64().unwrap_or_else(next_identity),
            x: fields["x"].as_f64().ok_or("Via x required")?, y: fields["y"].as_f64().ok_or("Via y required")?,
            diameter: fields["diameter"].as_f64().ok_or("Via diameter required")?, net: fields["net"].as_str().ok_or("Via net required")?.into(),
            layers: serde_json::from_value(fields["layers"].clone()).map_err(|error| error.to_string())?,
            route_index: fields["routeIndex"].as_u64().ok_or("Via routeIndex required")? as usize,
            mutable: fields["mutable"].as_bool().ok_or("Via mutable required")?,
        }))
    }
}

impl SameNetViaMergerSolver {
    pub fn snapshot(&self, codec: &mut crate::graph_codec::GraphCodec) -> Value {
        let mut fields = serde_json::to_value(&self.base).unwrap();
        fields["identity"] = json!(self.identity); fields["stats"] = codec.raw(self.stats.clone());
        fields["inputHdRoutes"] = codec.route_array(self.input_routes_array_identity, &self.input_hd_routes);
        fields["mergedViaHdRoutes"] = codec.route_array(self.merged_routes_array_identity, &self.merged_via_hd_routes);
        fields["unprocessedRoutes"] = codec.route_array(self.unprocessed_routes_array_identity, &self.unprocessed_routes);
        fields["currentViaRoutes"] = codec.route_array(self.current_via_routes_array_identity, &self.current_via_routes);
        fields["vias"] = json!({"$array":self.vias_array_identity,"items":self.vias.iter().map(|via| via.snapshot(codec)).collect::<Vec<_>>()});
        fields["offendingVias"] = json!({"$array":self.offending_vias_array_identity,"items":self.offending_vias.iter().map(|(a,b)| json!([a.snapshot(codec),b.snapshot(codec)])).collect::<Vec<_>>()});
        fields["viasByNet"] = json!({"$map":self.vias_by_net_identity,"entries":self.vias_by_net.iter().map(|(net,vias)| json!([net,vias.iter().map(|via|via.snapshot(codec)).collect::<Vec<_>>()])).collect::<Vec<_>>()});
        fields["connMap"] = codec.connectivity(&self.conn_map);
        fields["netByConnectionName"] = self.net_by_connection_name.as_ref().map(|map|codec.net_names(map)).unwrap_or(Value::Null);
        fields["outline"] = codec.raw(serde_json::to_value(&self.outline).unwrap());
        fields["colorMap"] = codec.color_map(&self.color_map);
        fields["obstacles"] = codec.obstacles(&self.obstacles);
        fields
    }

    pub fn restore(&mut self, fields: &Value, codec: &mut crate::graph_codec::GraphCodec) -> Result<(), String> {
        let mut base = serde_json::to_value(&self.base).unwrap();
        for key in ["MAX_ITERATIONS", "solved", "failed", "iterations", "progress", "error"] {
            if let Some(value) = fields.get(key) { base[key] = value.clone(); }
        }
        self.base = serde_json::from_value(base).map_err(|error| error.to_string())?;
        if let Some(value) = fields.get("stats") { self.stats = codec.read_raw(value); }
        macro_rules! routes { ($key:literal, $field:ident, $id:ident) => { if let Some(value) = fields.get($key) {
            self.$field = codec.read_routes(value)?;
            if let Some(id) = value["$array"].as_u64() { self.$id = id; }
        } }; }
        routes!("inputHdRoutes",input_hd_routes,input_routes_array_identity);
        routes!("mergedViaHdRoutes",merged_via_hd_routes,merged_routes_array_identity);
        routes!("unprocessedRoutes",unprocessed_routes,unprocessed_routes_array_identity);
        routes!("currentViaRoutes",current_via_routes,current_via_routes_array_identity);
        let mut via_refs: IndexMap<u64,Rc<Via>> = IndexMap::new();
        let mut read_via = |value: &Value| -> Result<Rc<Via>,String> {
            let via = Via::restore(value)?;
            Ok(via_refs.entry(via.identity).or_insert(via).clone())
        };
        if let Some(value) = fields.get("vias") {
            self.vias = value.get("items").unwrap_or(value).as_array().ok_or("Vias array required")?.iter().map(&mut read_via).collect::<Result<_,_>>()?;
            if let Some(id) = value["$array"].as_u64() { self.vias_array_identity = id; }
        }
        if let Some(value) = fields.get("offendingVias") {
            self.offending_vias = value.get("items").unwrap_or(value).as_array().ok_or("Offending vias array required")?.iter()
                .map(|pair| Ok((read_via(&pair[0])?,read_via(&pair[1])?))).collect::<Result<_,String>>()?;
            if let Some(id) = value["$array"].as_u64() { self.offending_vias_array_identity = id; }
        }
        if let Some(value) = fields.get("viasByNet") {
            let entries = value.get("entries").unwrap_or(value).as_array().ok_or("viasByNet entries required")?;
            self.vias_by_net = entries.iter().map(|entry| {
                let net = entry[0].as_str().ok_or("Via net required")?.to_owned();
                let vias = entry[1].as_array().ok_or("Net vias required")?.iter().map(&mut read_via).collect::<Result<_,_>>()?;
                Ok((net,vias))
            }).collect::<Result<_,String>>()?;
            if let Some(id) = value["$map"].as_u64() { self.vias_by_net_identity = id; }
        }
        if let Some(value) = fields.get("connMap") { self.conn_map = codec.read_connectivity(value)?; }
        if let Some(value) = fields.get("netByConnectionName") { self.net_by_connection_name = if value.is_null() { None } else { Some(codec.read_net_names(value)?) }; }
        if let Some(value) = fields.get("outline") { self.outline = serde_json::from_value(codec.read_raw(value)).map_err(|error|error.to_string())?; }
        if let Some(value) = fields.get("colorMap") { self.color_map = codec.read_color_map(value)?; }
        if let Some(value) = fields.get("obstacles") { self.obstacles = codec.read_obstacles(value)?; }
        Ok(())
    }

    pub fn invoke(&mut self, method: &str, args: &Value, codec: &mut crate::graph_codec::GraphCodec) -> Result<Value,String> {
        match method {
            "getMergedViaHdRoutes" => Ok(codec.route_array(self.merged_routes_array_identity,&self.merged_via_hd_routes)),
            "rebuildVias" => { self.rebuild_vias()?; Ok(Value::Null) }
            "getViaKey" => Ok(json!(self.get_via_key(Via::restore(&args[0])?.as_ref()))),
            "dedupeRouteVias" => { self.dedupe_route_vias(&codec.read_route(&args[0])?); Ok(Value::Null) }
            "moveViaTo" => { self.move_via_to(Via::restore(&args[0])?.as_ref(),Via::restore(&args[1])?.as_ref(),args[2].as_bool().unwrap_or(true))?; Ok(Value::Null) }
            "canMoveViaTo" => Ok(json!(self.can_move_via_to(Via::restore(&args[0])?.as_ref(),Via::restore(&args[1])?.as_ref())?)),
            "getOffendingViaGroupsBatch" => Ok(Value::Array(self.get_offending_via_groups_batch()?.iter().map(|group| json!({
                "keep":group.keep.snapshot(codec),"remove":group.remove.iter().map(|via|via.snapshot(codec)).collect::<Vec<_>>()
            })).collect())),
            _ => Err(format!("Unknown SameNetViaMergerSolver method: {method}")),
        }
    }
}
