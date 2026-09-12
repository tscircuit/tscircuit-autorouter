use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::Rc;
use serde_json::{Value, json};
pub use intra_node_routing::types::{Point, Point2};
pub use intra_node_routing::connectivity_map::ConnectivityMap;
pub use intra_node_routing::specialized_utils::math::Bounds;
pub type PointRef = Rc<RefCell<RoutePoint>>;
pub type RouteRef = Rc<RefCell<Route>>;
pub type ObstacleRef = Rc<RefCell<Obstacle>>;
pub type ColorMapRef = Rc<ColorMap>;
#[derive(Debug)]
pub struct ColorMap {
    pub identity: u64,
    pub value: RefCell<Value>,
}
#[derive(Debug)]
pub struct CloneGroup { pub identity: u64, pub sources: RefCell<Vec<RouteRef>> }
thread_local! { static NEXT_ID: Cell<u64> = const { Cell::new(1) }; }
pub fn next_identity() -> u64 { NEXT_ID.with(|next| { let id = next.get(); next.set(id + 1); id }) }
pub fn reserve_identity(identity: u64) {
    // JS owns the high range; native objects can be created before any JS read.
    if identity < (1_u64 << 40) { NEXT_ID.with(|next| next.set(next.get().max(identity + 1))); }
}

#[derive(Clone, Debug)]
pub struct RoutePoint {
    pub x: f64, pub y: f64, pub z: f64,
    pub identity: u64,
    pub source_identity: Option<u64>,
    pub source: Option<PointRef>,
    pub metadata_source_identity: Option<u64>,
    pub segment_metadata_obstacle: Option<ObstacleRef>,
    pub removed_segment_properties: u8,
    pub clone_group: Option<Rc<CloneGroup>>,
    pub metadata: Rc<Value>,
}
#[derive(Clone, Debug)]
pub struct Route {
    pub connection_name: String,
    pub root_connection_name: Option<String>,
    pub trace_thickness: f64,
    pub via_diameter: f64,
    pub route: Vec<PointRef>,
    pub vias: Vec<PointRef>,
    pub jumpers: Option<Rc<RefCell<Value>>>,
    pub jumpers_identity: Option<u64>,
    pub route_array_identity: u64,
    pub vias_array_identity: u64,
    pub source_metadata_identity: Option<u64>,
    pub identity: u64,
    pub source_identity: Option<u64>,
    pub source: Option<RouteRef>,
    pub clone_group: Option<Rc<CloneGroup>>,
    pub metadata: Rc<Value>,
}
#[derive(Clone, Debug)]
pub struct Obstacle {
    pub center: Point2,
    pub width: f64,
    pub height: f64,
    pub layers: Vec<String>,
    pub z_layers: Vec<f64>,
    pub z_layers_identity: Option<u64>,
    pub connected_to: Rc<Vec<String>>,
    pub identity: u64,
    pub source_identity: Option<u64>,
    pub metadata: Rc<Value>,
}

pub fn point2(p: &PointRef) -> Point2 { let p = p.borrow(); Point2 { x: p.x, y: p.y } }
pub fn point3(p: &PointRef) -> Point { let p = p.borrow(); Point { x: p.x, y: p.y, z: p.z } }
pub fn point_from_value(value: &Value) -> PointRef { point_from_owned_value(value.clone()) }
pub fn point_from_owned_value(value: Value) -> PointRef {
    Rc::new(RefCell::new(RoutePoint { x: value["x"].as_f64().unwrap_or(f64::NAN), y: value["y"].as_f64().unwrap_or(f64::NAN),
        z: value["z"].as_f64().unwrap_or(f64::NAN), identity: next_identity(), source_identity: None, source: None, metadata_source_identity: None, segment_metadata_obstacle: None, removed_segment_properties: 0, clone_group: None, metadata: Rc::new(value) }))
}
pub fn fresh_point(x: f64, y: f64, z: f64) -> PointRef { point_from_owned_value(json!({"x":x,"y":y,"z":z})) }
pub fn fresh_via(x: f64, y: f64) -> PointRef { point_from_owned_value(json!({"x":x,"y":y})) }
pub fn spread_point(point: &PointRef) -> PointRef {
    let original = point.borrow();
    let mut copy = original.clone();
    copy.identity = next_identity();
    copy.source_identity = Some(original.identity);
    copy.source = Some(point.clone());
    copy.clone_group = None;
    Rc::new(RefCell::new(copy))
}
pub fn point_to_value(point: &PointRef) -> Value {
    let point = point.borrow();
    let mut value = (*point.metadata).clone();
    value["x"] = json!(point.x); value["y"] = json!(point.y);
    if value.get("z").is_some() || !point.z.is_nan() { value["z"] = json!(point.z); }
    value
}
pub fn route_from_value(value: &Value) -> RouteRef {
    // Coordinates live in PointRefs. Keep array property positions without
    // retaining a second immutable copy of every route point and via.
    let metadata = value.as_object().expect("Route metadata object").iter().map(|(key, entry)| {
        let entry = if key == "route" || key == "vias" { Value::Null } else { entry.clone() };
        (key.clone(), entry)
    }).collect::<serde_json::Map<String, Value>>();
    Rc::new(RefCell::new(Route {
        connection_name: value["connectionName"].as_str().unwrap_or("").to_owned(),
        root_connection_name: value["rootConnectionName"].as_str().map(str::to_owned),
        trace_thickness: value["traceThickness"].as_f64().unwrap_or(f64::NAN),
        via_diameter: value["viaDiameter"].as_f64().unwrap_or(f64::NAN),
        route: value["route"].as_array().expect("Route points required").iter().map(point_from_value).collect(),
        vias: value["vias"].as_array().expect("Route vias required").iter().map(point_from_value).collect(),
        jumpers: value.get("jumpers").map(|value|Rc::new(RefCell::new(value.clone()))),
        jumpers_identity: value.get("jumpers").map(|_|next_identity()),
        route_array_identity: next_identity(), vias_array_identity: next_identity(), source_metadata_identity: None,
        identity: next_identity(), source_identity: None, source: None, clone_group: None, metadata: Rc::new(Value::Object(metadata)),
    }))
}
pub fn fresh_route(value: Value, route: Vec<PointRef>, vias: Vec<PointRef>) -> RouteRef {
    let output = route_from_value(&{let mut input = value; input["route"] = json!([]); input["vias"] = json!([]); input});
    output.borrow_mut().route = route;
    output.borrow_mut().vias = vias;
    output
}
pub fn spread_route(route: &RouteRef) -> RouteRef {
    let original = route.borrow();
    let mut copy = original.clone();
    copy.identity = next_identity();
    copy.source_identity = Some(original.identity);
    copy.source = Some(route.clone());
    copy.clone_group = None;
    Rc::new(RefCell::new(copy))
}
pub fn route_to_value(route: &RouteRef) -> Value {
    let route = route.borrow();
    let mut value = (*route.metadata).clone();
    value["connectionName"] = json!(route.connection_name);
    if route.root_connection_name.is_some() || value.get("rootConnectionName").is_some() { value["rootConnectionName"] = json!(route.root_connection_name); }
    if !route.trace_thickness.is_nan() || value.get("traceThickness").is_some() { value["traceThickness"] = json!(route.trace_thickness); }
    if !route.via_diameter.is_nan() || value.get("viaDiameter").is_some() { value["viaDiameter"] = json!(route.via_diameter); }
    value["route"] = Value::Array(route.route.iter().map(point_to_value).collect());
    value["vias"] = Value::Array(route.vias.iter().map(point_to_value).collect());
    if let Some(jumpers)=&route.jumpers {value["jumpers"]=jumpers.borrow().clone();}
    value
}
pub fn structured_clone_routes(routes: &[RouteRef]) -> Vec<RouteRef> {
    let mut points = HashMap::<u64, PointRef>::new();
    let mut copies = HashMap::<u64, RouteRef>::new();
    let mut arrays = HashMap::<u64,u64>::new();
    let mut jumpers = HashMap::<u64,Rc<RefCell<Value>>>::new();
    let group = Rc::new(CloneGroup { identity: next_identity(), sources: RefCell::new(routes.to_vec()) });
    routes.iter().map(|route| {
        let id = route.borrow().identity;
        if let Some(copy) = copies.get(&id) { return copy.clone(); }
        let copy = spread_route(route);
        {
            let mut copy = copy.borrow_mut();
            // Native metadata is immutable/COW; CloneGroup gives JS its
            // independent structured clone when these objects are observed.
            copy.clone_group=Some(group.clone());copy.source=None;copy.source_metadata_identity=None;
            if let (Some(id),Some(value))=(copy.jumpers_identity,copy.jumpers.clone()) {
                copy.jumpers=Some(jumpers.entry(id).or_insert_with(||Rc::new(RefCell::new(value.borrow().clone()))).clone());
                copy.jumpers_identity=Some(*arrays.entry(id).or_insert_with(next_identity));
            }
            copy.route_array_identity=*arrays.entry(copy.route_array_identity).or_insert_with(next_identity);
            copy.vias_array_identity=*arrays.entry(copy.vias_array_identity).or_insert_with(next_identity);
            let Route { route: route_points, vias, .. } = &mut *copy;
            for point in route_points.iter_mut().chain(vias.iter_mut()) {
                let id = point.borrow().identity;
                *point = points.entry(id).or_insert_with(|| {
                    let output = spread_point(point);
                    output.borrow_mut().clone_group=Some(group.clone());
                    output.borrow_mut().source=None;
                    output.borrow_mut().metadata_source_identity=None;
                    output.borrow_mut().segment_metadata_obstacle=None;
                    output
                }).clone();
            }
        }
        copies.insert(id, copy.clone());
        copy
    }).collect()
}
pub fn structured_clone_route(route: &RouteRef) -> RouteRef { structured_clone_routes(&[route.clone()]).remove(0) }
pub fn obstacle_from_value(value: &Value) -> ObstacleRef {
    Rc::new(RefCell::new(Obstacle { center: Point2 { x: value["center"]["x"].as_f64().unwrap_or(f64::NAN), y: value["center"]["y"].as_f64().unwrap_or(f64::NAN) },
        width: value["width"].as_f64().unwrap_or(f64::NAN), height: value["height"].as_f64().unwrap_or(f64::NAN),
        layers: value["layers"].as_array().map(|v|v.iter().map(|v|v.as_str().expect("Layer string").to_owned()).collect()).unwrap_or_default(),
        z_layers: value["__zLayers"].as_array().map(|v|v.iter().map(|v|v.as_f64().unwrap_or(f64::NAN)).collect()).unwrap_or_default(),
        z_layers_identity: value["__zLayers"].as_array().map(|_|next_identity()),
        connected_to: Rc::new(value["connectedTo"].as_array().expect("Obstacle connectedTo required").iter().map(|v|v.as_str().expect("Connection ID").to_owned()).collect()),
        identity: next_identity(), source_identity: None, metadata: Rc::new(value.clone()) }))
}

#[derive(Clone, Copy)]
pub struct Math { pub hypot: fn(f64,f64)->f64 }
impl Default for Math { fn default()->Self { Self { hypot:f64::hypot } } }

impl Route {
    pub fn has_jumpers(&self)->bool {self.jumpers.as_ref().is_some_and(|value|value.borrow().as_array().is_some_and(|values|!values.is_empty()))}
    pub fn jumpers_value(&self)->Option<Value> {self.jumpers.as_ref().map(|value|value.borrow().clone())}
}

#[cfg(test)]
mod representation_tests {
    use super::*;

    #[test]
    fn owned_point_construction_preserves_metadata_order_and_coordinate_presence() {
        let value = json!({"label":"p","y":2.0,"x":1.0,"z":0.0,"optional":null});
        let borrowed = point_from_value(&value);
        let owned = point_from_owned_value(value);
        assert_eq!(serde_json::to_string(&point_to_value(&borrowed)).unwrap(), serde_json::to_string(&point_to_value(&owned)).unwrap());
        let point = fresh_point(1.0,2.0,f64::NAN);
        let via = fresh_via(1.0,2.0);
        assert_eq!(serde_json::to_string(&point_to_value(&point)).unwrap(), "{\"x\":1.0,\"y\":2.0,\"z\":null}");
        assert_eq!(serde_json::to_string(&point_to_value(&via)).unwrap(), "{\"x\":1.0,\"y\":2.0}");
        assert_ne!(point.borrow().identity, via.borrow().identity);
    }

    #[test]
    fn structured_clone_keeps_identity_and_cow_metadata_without_duplicate_point_graphs() {
        let value = json!({"extra":{"nested":[1,2]},"route":[{"x":1.0,"y":2.0,"z":0.0,"label":{"name":"a"}}],
            "connectionName":"a","vias":[],"traceThickness":0.1,"viaDiameter":0.6,"jumpers":[{"id":"j"}]});
        let original = route_from_value(&value);
        assert!(original.borrow().metadata["route"].is_null());
        assert!(original.borrow().metadata["vias"].is_null());
        assert_eq!(serde_json::to_string(&route_to_value(&original)).unwrap(), serde_json::to_string(&value).unwrap());
        let repeated = original.borrow().route[0].clone();
        original.borrow_mut().route.push(repeated);
        let cloned = structured_clone_routes(&[original.clone(), original.clone()]);
        assert!(Rc::ptr_eq(&cloned[0], &cloned[1]));
        assert!(!Rc::ptr_eq(&original, &cloned[0]));
        {
            let source = original.borrow();
            let copy = cloned[0].borrow();
            assert!(Rc::ptr_eq(&source.metadata, &copy.metadata));
            assert!(Rc::ptr_eq(&copy.route[0], &copy.route[1]));
            assert!(!Rc::ptr_eq(&source.route[0], &copy.route[0]));
            assert!(Rc::ptr_eq(&source.route[0].borrow().metadata, &copy.route[0].borrow().metadata));
            assert!(!Rc::ptr_eq(source.jumpers.as_ref().unwrap(), copy.jumpers.as_ref().unwrap()));
            assert_ne!(source.route_array_identity, copy.route_array_identity);
            assert_ne!(source.vias_array_identity, copy.vias_array_identity);
            assert!(copy.clone_group.is_some());
        }
        let point = cloned[0].borrow().route[0].clone();
        Rc::make_mut(&mut point.borrow_mut().metadata)["label"]["name"] = json!("changed");
        Rc::make_mut(&mut cloned[0].borrow_mut().metadata)["extra"]["nested"] = json!([3]);
        cloned[0].borrow().jumpers.as_ref().unwrap().borrow_mut()[0]["id"] = json!("changed");
        assert_eq!(original.borrow().route[0].borrow().metadata["label"]["name"], "a");
        assert_eq!(original.borrow().metadata["extra"]["nested"], json!([1,2]));
        assert_eq!(original.borrow().jumpers.as_ref().unwrap().borrow()[0]["id"], "j");
    }
}
