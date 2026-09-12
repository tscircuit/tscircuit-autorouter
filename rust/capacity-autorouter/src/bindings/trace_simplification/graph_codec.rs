use crate::bindings::trace_simplification::shared_maps::{LayerSet,TerminalLayers,NetByConnectionName};
use std::{rc::{Rc, Weak}, cell::RefCell, collections::HashSet};
use indexmap::IndexMap;
use serde_json::{Value, json};
use crate::bindings::trace_simplification::types::*;

#[derive(Default)]
pub struct GraphCodec {
    pub point_refs: IndexMap<u64, Weak<RefCell<RoutePoint>>>,
    pub route_refs: IndexMap<u64, Weak<RefCell<Route>>>,
    pub jumper_refs: IndexMap<u64,Rc<RefCell<Value>>>,
    pub obstacle_refs: IndexMap<u64, ObstacleRef>,
    pub terminal_layers_refs: IndexMap<u64,Rc<TerminalLayers>>,
    pub net_names_refs: IndexMap<u64,Rc<NetByConnectionName>>,
    pub layer_set_refs: IndexMap<u64,Rc<LayerSet>>,
    pub color_map_refs: IndexMap<u64, ColorMapRef>,
    pub connectivity_refs: IndexMap<u64, Rc<ConnectivityMap>>,
    points: IndexMap<u64, Value>,
    routes: IndexMap<u64, Value>,
    obstacles: IndexMap<u64, Value>,
    clone_groups: IndexMap<u64, Value>,
    emitted_clone_groups: HashSet<u64>,
    clone_group_refs: IndexMap<u64, Weak<CloneGroup>>,
    acknowledged_clone_groups: HashSet<u64>,
    jumpers: IndexMap<u64,Value>,
    pub obstacle_query: Option<Rc<dyn Fn(u64, &str, &[f64]) -> Result<Vec<ObstacleRef>, String>>>,
}

/// Keeps newly imported geometry alive until the caller attaches it to solver state.
#[must_use]
pub struct ImportedGraph {
    points: Vec<PointRef>,
    routes: Vec<RouteRef>,
}

fn reference_id(value: &Value, kind: &str) -> Result<u64, String> {
    let reference = value.get("$ref").and_then(Value::as_array)
        .ok_or_else(|| format!("Expected {kind} reference"))?;
    if reference.first().and_then(Value::as_str) != Some(kind) {
        return Err(format!("Expected {kind} reference"));
    }
    reference.get(1).and_then(Value::as_u64).ok_or_else(|| format!("Invalid {kind} identity"))
}

fn array_items(value: &Value) -> Result<&[Value], String> {
    value.as_array().or_else(|| value.get("items").and_then(Value::as_array))
        .map(Vec::as_slice).ok_or_else(|| "Expected identity array".to_owned())
}

impl GraphCodec {
    pub fn new() -> Self { Self::default() }

    fn clone_group(&mut self, group: &Rc<CloneGroup>) {
        if self.acknowledged_clone_groups.contains(&group.identity) || self.clone_groups.contains_key(&group.identity) { return; }
        self.emitted_clone_groups.insert(group.identity);
        self.clone_group_refs.insert(group.identity, Rc::downgrade(group));
        self.clone_groups.insert(group.identity, Value::Null);
        let sources = Value::Array(group.sources.borrow().iter().map(|route|self.route_with_source(route,true)).collect());
        self.clone_groups.insert(group.identity, json!({"id":group.identity,"sources":sources}));
    }

    pub fn acknowledge_clone_groups(&mut self, identities: &[u64]) -> Result<(), String> {
        for identity in identities {
            if !self.emitted_clone_groups.contains(identity) {
                return Err(format!("Unknown emitted clone group {identity}"));
            }
        }
        for identity in identities {
            if let Some(group) = self.clone_group_refs.get(identity).and_then(Weak::upgrade) {
                group.sources.borrow_mut().clear();
            }
        }
        self.acknowledged_clone_groups.extend(identities.iter().copied());
        self.point_refs.retain(|_, point| point.strong_count() > 0);
        self.route_refs.retain(|_, route| route.strong_count() > 0);
        self.clone_group_refs.retain(|_, group| group.strong_count() > 0);
        Ok(())
    }

    pub fn capture_clone_groups(&mut self, routes: &[RouteRef]) {
        for route in routes {
            if let Some(group) = &route.borrow().clone_group {
                self.clone_group(group);
            }
        }
    }

    pub fn connectivity(&mut self, map: &Rc<ConnectivityMap>) -> Value {
        let identity = self.connectivity_refs.iter().find_map(|(id, existing)| Rc::ptr_eq(existing, map).then_some(*id)).unwrap_or_else(next_identity);
        self.connectivity_refs.insert(identity, map.clone());
        json!({"$connectivityId":identity,"$raw":serde_json::to_value(map).expect("Connectivity map serialization")})
    }

    pub fn read_connectivity(&mut self, value: &Value) -> Result<Rc<ConnectivityMap>, String> {
        let incoming: ConnectivityMap = serde_json::from_value(self.read_raw(value)).map_err(|error|error.to_string())?;
        let identity = value["$connectivityId"].as_u64().unwrap_or_else(next_identity);
        if let Some(existing) = self.connectivity_refs.get(&identity) {
            existing.replace_from(&incoming);
            return Ok(existing.clone());
        }
        let map = Rc::new(incoming);
        self.connectivity_refs.insert(identity, map.clone());
        Ok(map)
    }

    pub fn net_names(&mut self, map: &Rc<NetByConnectionName>) -> Value {
        let id = map.source_identity().or_else(||self.net_names_refs.iter().find_map(|(id,item)|Rc::ptr_eq(item,map).then_some(*id))).unwrap_or_else(next_identity);
        self.net_names_refs.insert(id,map.clone());
        json!({"$netNamesId":id,"$raw":serde_json::to_value(map).unwrap()})
    }

    pub fn read_net_names(&mut self, value: &Value) -> Result<Rc<NetByConnectionName>,String> {
        let incoming: IndexMap<String,String> = serde_json::from_value(self.read_raw(value)).map_err(|e|e.to_string())?;
        let id = value["$netNamesId"].as_u64().unwrap_or_else(next_identity);
        if let Some(existing) = self.net_names_refs.get(&id) {
            if !existing.iter().eq(incoming.iter()) { existing.replace(incoming); }
            return Ok(existing.clone());
        }
        let map = Rc::new(NetByConnectionName::with_identity(incoming,id));
        self.net_names_refs.insert(id,map.clone());
        Ok(map)
    }

    fn layer_set(&mut self, set: &Rc<LayerSet>) -> Value {
        let id = set.source_identity().or_else(||self.layer_set_refs.iter().find_map(|(id,item)|Rc::ptr_eq(item,set).then_some(*id))).unwrap_or_else(next_identity);
        self.layer_set_refs.insert(id,set.clone());
        json!({"$layerSetId":id,"$raw":serde_json::to_value(set).unwrap()})
    }

    pub fn read_layer_set(&mut self, value: &Value) -> Result<Rc<LayerSet>,String> {
        let incoming: Vec<f64> = serde_json::from_value(self.read_raw(value)).map_err(|e|e.to_string())?;
        let id = value["$layerSetId"].as_u64().unwrap_or_else(next_identity);
        if let Some(existing) = self.layer_set_refs.get(&id) {
            if existing.as_slice() != incoming.as_slice() { existing.replace(incoming); }
            return Ok(existing.clone());
        }
        let set = Rc::new(LayerSet::with_identity(incoming,id));
        self.layer_set_refs.insert(id,set.clone());
        Ok(set)
    }

    pub fn terminal_layers(&mut self, map: &Rc<TerminalLayers>) -> Value {
        let id = map.source_identity().or_else(||self.terminal_layers_refs.iter().find_map(|(id,item)|Rc::ptr_eq(item,map).then_some(*id))).unwrap_or_else(next_identity);
        self.terminal_layers_refs.insert(id,map.clone());
        let values: serde_json::Map<String,Value> = map.iter().map(|(key,set)|(key.clone(),self.layer_set(set))).collect();
        json!({"$terminalLayersId":id,"$raw":values})
    }

    pub fn read_terminal_layers(&mut self, value: &Value) -> Result<Rc<TerminalLayers>,String> {
        let raw = self.read_raw(value);
        let mut incoming = IndexMap::new();
        for (key, layers) in raw.as_object().ok_or("Terminal layers must be a map")? {
            incoming.insert(key.clone(),self.read_layer_set(layers)?);
        }
        let id = value["$terminalLayersId"].as_u64().unwrap_or_else(next_identity);
        if let Some(existing) = self.terminal_layers_refs.get(&id) {
            let unchanged = existing.len() == incoming.len() && existing.iter().zip(incoming.iter()).all(|((a,x),(b,y))|a==b&&Rc::ptr_eq(x,y));
            if !unchanged { existing.replace(incoming); }
            return Ok(existing.clone());
        }
        let map = Rc::new(TerminalLayers::with_identity(incoming,id));
        self.terminal_layers_refs.insert(id,map.clone());
        Ok(map)
    }

    pub fn color_map(&mut self, map: &ColorMapRef) -> Value {
        self.color_map_refs.insert(map.identity,map.clone());
        json!({"$colorMapId":map.identity,"$raw":*map.value.borrow()})
    }

    pub fn read_color_map(&mut self, value: &Value) -> Result<ColorMapRef,String> {
        let identity = value.get("$colorMapId").and_then(Value::as_u64).unwrap_or_else(next_identity);
        let incoming = self.read_raw(value);
        if !incoming.is_object() { return Err("Color map must be an object".into()); }
        if let Some(map) = self.color_map_refs.get(&identity) {
            *map.value.borrow_mut() = incoming;
            return Ok(map.clone());
        }
        let map = Rc::new(ColorMap { identity, value: RefCell::new(incoming) });
        self.color_map_refs.insert(identity,map.clone());
        Ok(map)
    }

    fn import_connectivity(&mut self, value: &Value) -> Result<(),String> {
        if value.get("$colorMapId").is_some() { self.read_color_map(value)?; }
        else if value.get("$connectivityId").is_some() { self.read_connectivity(value)?; }
        else if value.get("$netNamesId").is_some() { self.read_net_names(value)?; }
        else if value.get("$terminalLayersId").is_some() { self.read_terminal_layers(value)?; }
        else if value.get("$layerSetId").is_some() { self.read_layer_set(value)?; }
        else if value.get("$raw").is_none() {
            if let Some(fields) = value.as_object() { for field in fields.values() { self.import_connectivity(field)?; } }
            else if let Some(items) = value.as_array() { for item in items { self.import_connectivity(item)?; } }
        }
        Ok(())
    }

    pub fn point(&mut self, point: &PointRef) -> Value { self.point_with_source(point,false) }

    fn point_with_source(&mut self, point: &PointRef, source_only:bool) -> Value {
        let p = point.borrow();
        let id = p.identity;
        if self.points.get(&id).is_some_and(|record|source_only||record["sourceOnly"]==Value::Bool(false)){return json!({"$ref":["point",id]});}
        self.point_refs.insert(id, Rc::downgrade(point));
        if let Some(group) = &p.clone_group { self.clone_group(group); }
        if !p.clone_group.as_ref().is_some_and(|group| self.acknowledged_clone_groups.contains(&group.identity)) {
            if let Some(source) = &p.source { self.point_with_source(source,true); }
        }
        if let Some(obstacle) = &p.segment_metadata_obstacle { self.obstacle(obstacle); }
        let removed_properties:&[&str]=match p.removed_segment_properties {0=>&[],1=>&["toNextSegmentType"],2=>&["toNextSegmentCircuitJsonMetadata"],_=>&["toNextSegmentType","toNextSegmentCircuitJsonMetadata"]};
        self.points.insert(id, json!({"id":id,"sourceOnly":source_only,"sourceId":p.source_identity,"metadataSourceId":p.metadata_source_identity,"segmentMetadataObstacleId":p.segment_metadata_obstacle.as_ref().map(|obstacle|obstacle.borrow().identity),"removedProperties":removed_properties,"cloneGroupId":p.clone_group.as_ref().map(|group|group.identity),"value":point_to_value(point)}));
        json!({"$ref":["point",id]})
    }

    pub fn route(&mut self, route: &RouteRef) -> Value { self.route_with_source(route,false) }

    fn route_with_source(&mut self, route: &RouteRef, source_only:bool) -> Value {
        let r = route.borrow();
        let id = r.identity;
        if self.routes.get(&id).is_some_and(|record|source_only||record["sourceOnly"]==Value::Bool(false)){return json!({"$ref":["route",id]});}
        self.route_refs.insert(id, Rc::downgrade(route));
        if let Some(group) = &r.clone_group { self.clone_group(group); }
        if !r.clone_group.as_ref().is_some_and(|group| self.acknowledged_clone_groups.contains(&group.identity)) {
            if let Some(source) = &r.source { self.route_with_source(source,true); }
        }
        let points = json!({"$array":r.route_array_identity,"items":r.route.iter().map(|point|self.point_with_source(point,source_only)).collect::<Vec<_>>()});
        let vias = json!({"$array":r.vias_array_identity,"items":r.vias.iter().map(|point|self.point_with_source(point,source_only)).collect::<Vec<_>>()});
        let mut value = serde_json::Map::new();
        for (key, entry) in r.metadata.as_object().expect("Route metadata object") {
            if key != "route" && key != "vias" { value.insert(key.clone(), entry.clone()); }
        }
        if let (Some(id),Some(jumpers))=(r.jumpers_identity,&r.jumpers) {
            self.jumper_refs.insert(id,jumpers.clone());
            self.jumpers.insert(id,json!({"id":id,"value":*jumpers.borrow()}));
            value.insert("jumpers".into(),jumpers.borrow().clone());
        }
        value.insert("connectionName".into(), json!(r.connection_name));
        if r.root_connection_name.is_some() || value.contains_key("rootConnectionName") { value.insert("rootConnectionName".into(), json!(r.root_connection_name)); }
        if !r.trace_thickness.is_nan() || value.contains_key("traceThickness") { value.insert("traceThickness".into(), json!(r.trace_thickness)); }
        if !r.via_diameter.is_nan() || value.contains_key("viaDiameter") { value.insert("viaDiameter".into(), json!(r.via_diameter)); }
        let mut property_order: Vec<String> = r.metadata.as_object().unwrap().keys().cloned().collect();
        for key in value.keys().map(String::as_str).chain(["route", "vias"]) {
            if !property_order.iter().any(|existing| existing == key) { property_order.push(key.to_owned()); }
        }
        self.routes.insert(id, json!({"id":id,"sourceOnly":source_only,"sourceId":r.source_identity,"metadataSourceId":r.source_metadata_identity,"jumpersArrayId":r.jumpers_identity,"cloneGroupId":r.clone_group.as_ref().map(|group|group.identity),
            "value":value,"propertyOrder":property_order,"route":points,"vias":vias}));
        json!({"$ref":["route",id]})
    }

    pub fn points(&mut self, points: &[PointRef]) -> Value {
        Value::Array(points.iter().map(|point| self.point(point)).collect())
    }

    pub fn routes(&mut self, routes: &[RouteRef]) -> Value {
        Value::Array(routes.iter().map(|route| self.route(route)).collect())
    }

    pub fn point_array(&mut self, id: u64, points: &[PointRef]) -> Value {
        json!({"$array":id,"items":self.points(points)})
    }

    pub fn route_array(&mut self, id: u64, routes: &[RouteRef]) -> Value {
        json!({"$array":id,"items":self.routes(routes)})
    }

    pub fn object(&mut self, id: u64, fields: Value) -> Value {
        json!({"$object":id,"fields":fields})
    }

    pub fn raw(&self, value: Value) -> Value { json!({"$raw":value}) }
    pub fn read_raw(&self, value: &Value) -> Value { value.get("$raw").unwrap_or(value).clone() }

    pub fn obstacle(&mut self, obstacle: &ObstacleRef) -> Value {
        let o = obstacle.borrow();
        let id = o.identity;
        self.obstacle_refs.insert(id, obstacle.clone());
        let mut value = (*o.metadata).clone();
        value["center"]["x"] = json!(o.center.x);
        value["center"]["y"] = json!(o.center.y);
        value["width"] = json!(o.width);
        value["height"] = json!(o.height);
        value["connectedTo"] = json!(o.connected_to);
        if value.get("layers").is_some() { value["layers"] = json!(o.layers); }
        if value.get("__zLayers").is_some() { value["__zLayers"] = json!(o.z_layers); }
        self.obstacles.insert(id, json!({"id":id,"sourceId":o.source_identity,"zLayersArrayId":o.z_layers_identity,"value":value}));
        json!({"$ref":["obstacle",id]})
    }

    pub fn obstacles(&mut self, obstacles: &[ObstacleRef]) -> Value {
        Value::Array(obstacles.iter().map(|obstacle| self.obstacle(obstacle)).collect())
    }

    pub fn read_point(&mut self, value: &Value) -> Result<PointRef, String> {
        let id = reference_id(value, "point")?;
        self.point_refs.get(&id).and_then(Weak::upgrade).ok_or_else(|| format!("Unknown point identity {id}"))
    }

    pub fn read_route(&mut self, value: &Value) -> Result<RouteRef, String> {
        let id = reference_id(value, "route")?;
        self.route_refs.get(&id).and_then(Weak::upgrade).ok_or_else(|| format!("Unknown route identity {id}"))
    }

    pub fn read_points(&mut self, value: &Value) -> Result<Vec<PointRef>, String> {
        array_items(value)?.iter().map(|entry| self.read_point(entry)).collect()
    }

    pub fn read_routes(&mut self, value: &Value) -> Result<Vec<RouteRef>, String> {
        array_items(value)?.iter().map(|entry| self.read_route(entry)).collect()
    }

    pub fn read_obstacle(&mut self, value: &Value) -> Result<ObstacleRef, String> {
        let id = reference_id(value, "obstacle")?;
        self.obstacle_refs.get(&id).cloned().ok_or_else(|| format!("Unknown obstacle identity {id}"))
    }

    pub fn read_obstacles(&mut self, value: &Value) -> Result<Vec<ObstacleRef>, String> {
        array_items(value)?.iter().map(|entry| self.read_obstacle(entry)).collect()
    }

    pub fn finish(&mut self, fields: Value) -> Value {
        json!({"fields":fields,"points":std::mem::take(&mut self.points).into_values().collect::<Vec<_>>(),
            "routes":std::mem::take(&mut self.routes).into_values().collect::<Vec<_>>(),
            "obstacles":std::mem::take(&mut self.obstacles).into_values().collect::<Vec<_>>(),
            "cloneGroups":std::mem::take(&mut self.clone_groups).into_values().collect::<Vec<_>>(),
            "jumpers":std::mem::take(&mut self.jumpers).into_values().collect::<Vec<_>>()})
    }

    pub fn import_graph(&mut self, graph: &Value) -> Result<ImportedGraph, String> {
        let mut imported = ImportedGraph { points: Vec::new(), routes: Vec::new() };
        self.import_connectivity(&graph["fields"])?;
        if let Some(jumpers)=graph["jumpers"].as_array() {
            for record in jumpers {
                let id=record["id"].as_u64().ok_or("Invalid jumper array identity")?;
                let value=record["value"].clone();
                if let Some(existing)=self.jumper_refs.get(&id){*existing.borrow_mut()=value;}
                else{self.jumper_refs.insert(id,Rc::new(RefCell::new(value)));}
            }
        }
        let points = graph["points"].as_array().ok_or("Missing point graph")?;
        let routes = graph["routes"].as_array().ok_or("Missing route graph")?;
        let obstacles = graph["obstacles"].as_array().ok_or("Missing obstacle graph")?;
        for record in points {
            let id = record["id"].as_u64().ok_or("Invalid point identity")?;
            reserve_identity(id);
            let incoming = point_from_value(&record["value"]);
            let point = if let Some(point) = self.point_refs.get(&id).and_then(Weak::upgrade) {
                {
                    let incoming = incoming.borrow();
                    let mut existing = point.borrow_mut();
                    existing.x = incoming.x; existing.y = incoming.y; existing.z = incoming.z;
                    existing.metadata = incoming.metadata.clone();
                }
                point
            } else {
                incoming
            };
            self.point_refs.insert(id, Rc::downgrade(&point));
            imported.points.push(point.clone());
            let mut point = point.borrow_mut();
            point.identity = id; point.source_identity = record["sourceId"].as_u64();
            if point.source_identity.is_none() { point.source = None; point.clone_group = None; }
            point.metadata_source_identity = record["metadataSourceId"].as_u64();
            point.removed_segment_properties=0;
            point.segment_metadata_obstacle=None;
        }
        for record in routes {
            let id = record["id"].as_u64().ok_or("Invalid route identity")?;
            reserve_identity(id);
            let points = self.read_points(&record["route"])?;
            let vias = self.read_points(&record["vias"])?;
            let route_array_identity = record["route"]["$array"].as_u64().ok_or("Missing route array identity")?;
            let vias_array_identity = record["vias"]["$array"].as_u64().ok_or("Missing vias array identity")?;
            reserve_identity(route_array_identity.max(vias_array_identity));
            let mut value = json!({});
            if let Some(order) = record["propertyOrder"].as_array() {
                for key in order {
                    let key = key.as_str().ok_or("Invalid route property name")?;
                    if key == "route" || key == "vias" { value[key] = json!([]); }
                    else if let Some(entry) = record["value"].get(key) { value[key] = entry.clone(); }
                }
            }
            for (key, entry) in record["value"].as_object().ok_or("Invalid route metadata")? {
                if value.get(key).is_none() { value[key] = entry.clone(); }
            }
            value["route"] = json!([]); value["vias"] = json!([]);
            let incoming = route_from_value(&value);
            let route = if let Some(route) = self.route_refs.get(&id).and_then(Weak::upgrade) {
                {
                    let incoming = incoming.borrow();
                    let mut existing = route.borrow_mut();
                    existing.connection_name = incoming.connection_name.clone();
                    existing.root_connection_name = incoming.root_connection_name.clone();
                    existing.trace_thickness = incoming.trace_thickness;
                    existing.via_diameter = incoming.via_diameter;
                    existing.jumpers = incoming.jumpers.clone();
                    existing.jumpers_identity = incoming.jumpers_identity;
                    existing.metadata = incoming.metadata.clone();
                }
                route
            } else {
                incoming
            };
            self.route_refs.insert(id, Rc::downgrade(&route));
            imported.routes.push(route.clone());
            let mut route = route.borrow_mut();
            route.route = points; route.vias = vias;
            if let Some(id)=record["jumpersArrayId"].as_u64() {
                let value=record["value"].get("jumpers").cloned().unwrap_or(Value::Null);
                let cell=self.jumper_refs.entry(id).or_insert_with(||Rc::new(RefCell::new(value.clone()))).clone();
                *cell.borrow_mut()=value;route.jumpers=Some(cell);route.jumpers_identity=Some(id);
            }
            route.identity = id; route.source_identity = record["sourceId"].as_u64();
            if route.source_identity.is_none() { route.source = None; route.clone_group = None; }
            route.source_metadata_identity = record["metadataSourceId"].as_u64();
            route.route_array_identity = route_array_identity; route.vias_array_identity = vias_array_identity;
        }
        let mut imported_layers: IndexMap<u64, Vec<f64>> = IndexMap::new();
        for record in obstacles {
            let id = record["id"].as_u64().ok_or("Invalid obstacle identity")?;
            reserve_identity(id);
            let obstacle = obstacle_from_value(&record["value"]);
            let mut incoming = obstacle.borrow().clone();
            incoming.identity = id;
            incoming.source_identity = record["sourceId"].as_u64();
            incoming.z_layers_identity = record["zLayersArrayId"].as_u64().or(incoming.z_layers_identity);
            if let Some(identity) = incoming.z_layers_identity {
                reserve_identity(identity);
                imported_layers.insert(identity, incoming.z_layers.clone());
            }
            if let Some(existing) = self.obstacle_refs.get(&id) {
                let mut existing = existing.borrow_mut();
                // Keep the immutable identity when a geometry-only packet repeats
                // unchanged connectivity; actual ID changes replace the shared value.
                if existing.connected_to == incoming.connected_to {
                    incoming.connected_to = existing.connected_to.clone();
                }
                *existing = incoming;
            }
            else { self.obstacle_refs.insert(id, Rc::new(std::cell::RefCell::new(incoming))); }
        }
        // A caller can mutate an array shared by several normalized obstacles while
        // only one of those obstacle records is present in this update packet.
        if !imported_layers.is_empty() {
            for obstacle in self.obstacle_refs.values() {
                let changed_layers = {
                    let obstacle = obstacle.borrow();
                    obstacle.z_layers_identity.and_then(|id|imported_layers.get(&id))
                        .filter(|layers|obstacle.z_layers != **layers)
                };
                if let Some(layers) = changed_layers {
                    let mut obstacle = obstacle.borrow_mut();
                    obstacle.z_layers = layers.clone();
                    Rc::make_mut(&mut obstacle.metadata)["__zLayers"] = json!(layers);
                }
            }
        }
        Ok(imported)
    }
}

#[cfg(test)]
mod shared_map_tests {
    use super::*;

    #[test]
    fn deferred_new_set_keeps_source_identity_when_main_codec_observes_it() {
        let mut main = GraphCodec::new();
        let map = main.read_terminal_layers(&json!({"$terminalLayersId":100,"$raw":{"port":{"$layerSetId":101,"$raw":[0]}}})).unwrap();
        let mut deferred = GraphCodec::new();
        deferred.terminal_layers_refs = main.terminal_layers_refs.clone();
        deferred.layer_set_refs = main.layer_set_refs.clone();
        deferred.read_terminal_layers(&json!({"$terminalLayersId":100,"$raw":{"port":{"$layerSetId":102,"$raw":[0,1]}}})).unwrap();
        let observed = main.terminal_layers(&map);
        assert_eq!(observed["$raw"]["port"]["$layerSetId"],json!(102));
        deferred.read_layer_set(&json!({"$layerSetId":102,"$raw":[1]})).unwrap();
        assert_eq!(main.terminal_layers(&map)["$raw"]["port"]["$raw"],json!([1.0]));
    }
}

#[cfg(test)]
mod geometry_ownership_tests {
    use super::*;

    #[test]
    fn acknowledged_clone_releases_source_geometry_but_keeps_metadata() {
        let source = route_from_value(&json!({"connectionName":"n","traceThickness":0.1,"viaDiameter":0.3,"tag":{"value":1},"route":[{"x":0,"y":0,"z":0},{"x":1,"y":0,"z":0}],"vias":[]}));
        let old_route = Rc::downgrade(&source);
        let old_point = Rc::downgrade(&source.borrow().route[0]);
        let copies = structured_clone_routes(&[source.clone()]);
        let group = copies[0].borrow().clone_group.clone().unwrap();
        let mut codec = GraphCodec::new();
        codec.capture_clone_groups(&copies);
        let packet = codec.finish(Value::Null);
        assert_eq!(packet["cloneGroups"].as_array().unwrap().len(), 1);
        drop(source);
        assert!(old_route.upgrade().is_some());
        codec.acknowledge_clone_groups(&[group.identity]).unwrap();
        assert!(old_route.upgrade().is_none());
        assert!(old_point.upgrade().is_none());
        assert!(group.sources.borrow().is_empty());
        assert_eq!(copies[0].borrow().metadata["tag"]["value"],json!(1));
        let output = codec.route(&copies[0]);
        let packet = codec.finish(output);
        assert!(packet["cloneGroups"].as_array().unwrap().is_empty());
        assert_eq!(packet["points"].as_array().unwrap().len(), 2);
        assert_eq!(packet["routes"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn imported_guard_keeps_unattached_geometry_alive_and_dead_records_recreate() {
        let route = route_from_value(&json!({"connectionName":"n","traceThickness":0.1,"viaDiameter":0.3,"route":[{"x":0,"y":0,"z":0}],"vias":[]}));
        let mut outgoing = GraphCodec::new();
        let fields = outgoing.route(&route);
        let mut packet = outgoing.finish(fields);
        packet["routes"][0]["propertyOrder"] = json!(["tag", "route", "connectionName", "vias"]);
        packet["routes"][0]["value"]["tag"] = json!({"nested":[1,2]});
        packet["routes"][0]["value"]["extra"] = Value::Null;
        let mut codec = GraphCodec::new();
        let imported = codec.import_graph(&packet).unwrap();
        let first = codec.read_route(&packet["fields"]).unwrap();
        let original_point = first.borrow().route[0].clone();
        packet["points"][0]["value"]["x"] = json!(7);
        packet["routes"][0]["value"]["connectionName"] = json!("updated");
        packet["routes"][0]["value"]["tag"] = json!({"nested":[3]});
        let live = codec.import_graph(&packet).unwrap();
        assert_eq!(original_point.borrow().x, 7.0);
        assert_eq!(first.borrow().connection_name, "updated");
        let expected = route_to_value(&first);
        assert_eq!(expected["tag"], json!({"nested":[3]}));
        assert_eq!(expected["extra"], Value::Null);
        let keys: Vec<_> = expected.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(keys, vec!["tag", "route", "connectionName", "vias", "traceThickness", "viaDiameter", "extra"]);
        assert!(Rc::ptr_eq(&first, &codec.read_route(&packet["fields"]).unwrap()));
        assert!(Rc::ptr_eq(&original_point, &first.borrow().route[0]));
        let old_route = Rc::downgrade(&first);
        let old_point = Rc::downgrade(&original_point);
        drop(live); drop(first); drop(original_point);
        assert!(old_route.upgrade().is_some());
        drop(imported);
        assert!(old_route.upgrade().is_none());
        assert!(old_point.upgrade().is_none());
        let imported = codec.import_graph(&packet).unwrap();
        let recreated = codec.read_route(&packet["fields"]).unwrap();
        assert_eq!(serde_json::to_string(&route_to_value(&recreated)).unwrap(), serde_json::to_string(&expected).unwrap());
        drop(imported);
        assert!(codec.read_route(&packet["fields"]).is_ok());
    }
}

#[cfg(test)]
mod normalized_obstacle_identity_tests {
    use super::*;
    use crate::utils::create_objects_with_z_layers::normalize_obstacles;

    #[test]
    fn normalized_layers_are_fresh_except_shared_fallback_and_import_updates_aliases() {
        let source = obstacle_from_value(&json!({"center":{"x":0,"y":0},"width":1,"height":1,"connectedTo":[],"__zLayers":[0]}));
        let empty = obstacle_from_value(&json!({"center":{"x":1,"y":0},"width":1,"height":1,"connectedTo":[],"__zLayers":[]}));
        let normalized = normalize_obstacles(vec![source.clone(),source.clone(),empty.clone(),empty],2.0);
        assert_ne!(normalized[0].borrow().z_layers_identity, source.borrow().z_layers_identity);
        assert_ne!(normalized[0].borrow().z_layers_identity, normalized[1].borrow().z_layers_identity);
        assert_eq!(normalized[2].borrow().z_layers_identity, normalized[3].borrow().z_layers_identity);
        let mut codec = GraphCodec::new();
        let fields = codec.obstacles(&normalized);
        let mut packet = codec.finish(fields);
        packet["obstacles"].as_array_mut().unwrap().retain(|record|record["id"] == json!(normalized[2].borrow().identity));
        packet["obstacles"][0]["value"]["__zLayers"] = json!([1]);
        let unrelated = normalized[0].borrow();
        let _guard = codec.import_graph(&packet).unwrap();
        assert_eq!(normalized[2].borrow().z_layers, vec![1.0]);
        assert_eq!(normalized[3].borrow().z_layers, vec![1.0]);
        assert_eq!(normalized[0].borrow().z_layers, vec![0.0]);
        assert_eq!(unrelated.z_layers, vec![0.0]);
        assert_eq!(source.borrow().z_layers, vec![0.0]);
    }
}

#[cfg(test)]
mod connected_id_identity_tests {
    use super::*;
    use crate::bindings::trace_simplification::connectivity_context::ConnectivityContext;

    #[test]
    fn geometry_import_preserves_connectivity_cache_until_ids_change() {
        let obstacle = obstacle_from_value(&json!({"center":{"x":0,"y":0},"width":1,"height":1,"connectedTo":["a","a","b"]}));
        let mut codec = GraphCodec::new();
        let fields = codec.obstacle(&obstacle);
        let mut packet = codec.finish(fields);
        let mut context = ConnectivityContext::new(Rc::new(ConnectivityMap::new(IndexMap::new())));
        let before_ids = obstacle.borrow().connected_to.clone();
        let before_resolved = context.resolve_obstacle(&obstacle);
        packet["obstacles"][0]["value"]["width"] = json!(3);
        let _imported = codec.import_graph(&packet).unwrap();
        assert_eq!(obstacle.borrow().width,3.0);
        assert!(Rc::ptr_eq(&before_ids,&obstacle.borrow().connected_to));
        assert!(Rc::ptr_eq(&before_resolved,&context.resolve_obstacle(&obstacle)));
        packet["obstacles"][0]["value"]["connectedTo"] = json!(["b","a"]);
        let _imported = codec.import_graph(&packet).unwrap();
        let after = context.resolve_obstacle(&obstacle);
        assert!(!Rc::ptr_eq(&before_resolved,&after));
        assert_eq!(&**before_ids,&vec!["a".to_owned(),"a".to_owned(),"b".to_owned()]);
        assert_eq!(after.len(),2);
        assert_eq!(after[0],context.resolve("b"));
        assert_eq!(after[1],context.resolve("a"));
    }
}

#[cfg(test)]
mod color_map_identity_tests {
    use super::*;

    #[test]
    fn color_map_updates_share_contents_while_field_replacement_detaches() {
        let mut codec = GraphCodec::new();
        let parent = codec.read_color_map(&json!({"$colorMapId":100,"$raw":{"n":"red"}})).unwrap();
        let child = parent.clone();
        let _guard = codec.import_graph(&json!({"fields":{"__inputUpdates":[{"$colorMapId":100,"$raw":{"n":"blue"}}]},"points":[],"routes":[],"obstacles":[]})).unwrap();
        assert_eq!(child.value.borrow()["n"],json!("blue"));
        let parent = codec.read_color_map(&json!({"$colorMapId":101,"$raw":{"n":"green"}})).unwrap();
        assert!(!Rc::ptr_eq(&parent,&child));
        codec.read_color_map(&json!({"$colorMapId":100,"$raw":{"n":"orange"}})).unwrap();
        assert_eq!(child.value.borrow()["n"],json!("orange"));
        assert_eq!(parent.value.borrow()["n"],json!("green"));
        assert_eq!(codec.color_map(&child)["$colorMapId"],json!(100));
    }
}
