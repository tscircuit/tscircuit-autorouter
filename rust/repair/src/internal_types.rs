use serde_json::Value;
use std::cell::{Cell, RefCell};

thread_local! { static NEXT_IDENTITY: Cell<u64> = const { Cell::new(1) }; }

pub fn next_identity() -> u64 {
    NEXT_IDENTITY.with(|counter| { let id = counter.get(); counter.set(id.checked_add(1).expect("Repair identity exhausted")); id })
}
use std::rc::Rc;

pub use autorouting_drc::math_utils::{Bounds as Bounds2D, Point};

#[derive(Clone, Debug)]
pub struct RoutePoint {
    pub metadata_identity: u64,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub metadata: Rc<Value>,
}

impl RoutePoint {
    pub fn from_value(value: &Value) -> Self {
        Self {
            metadata_identity: next_identity(),
            x: value["x"].as_f64().expect("Route point x is required"),
            y: value["y"].as_f64().expect("Route point y is required"),
            z: value["z"].as_f64().expect("Route point z is required"),
            metadata: Rc::new(value.clone()),
        }
    }

    pub fn from_owned_value(value: Value) -> Self {
        Self {
            metadata_identity: next_identity(),
            x: value["x"].as_f64().expect("Route point x is required"),
            y: value["y"].as_f64().expect("Route point y is required"),
            z: value["z"].as_f64().expect("Route point z is required"),
            metadata: Rc::new(value),
        }
    }

    pub fn point(&self) -> Point {
        Point { x: self.x, y: self.y }
    }

    pub fn to_value(&self) -> Value {
        let mut value = self.metadata.as_ref().clone();
        value["x"] = Value::from(self.x);
        value["y"] = Value::from(self.y);
        value["z"] = Value::from(self.z);
        value
    }
}

#[derive(Debug)]
pub struct MutableRoute {
    pub identity: u64,
    pub point_array_identity: u64,
    pub via_array_identity: u64,
    pub connection_name: String,
    pub root_connection_name: Option<String>,
    pub trace_thickness: Option<f64>,
    pub via_diameter: Option<f64>,
    pub route: Vec<Rc<RefCell<RoutePoint>>>,
    pub vias: Vec<Value>,
    pub metadata: Rc<Value>,
}

impl Clone for MutableRoute {
    fn clone(&self) -> Self {
        Self {
            identity: next_identity(), point_array_identity: next_identity(), via_array_identity: next_identity(),
            connection_name: self.connection_name.clone(),
            root_connection_name: self.root_connection_name.clone(),
            trace_thickness: self.trace_thickness,
            via_diameter: self.via_diameter,
            route: self.route.iter().map(|point| Rc::new(RefCell::new(point.borrow().clone()))).collect(),
            vias: self.vias.clone(),
            metadata: self.metadata.clone(),
        }
    }
}

impl MutableRoute {
    pub fn shallow_clone(&self) -> Self {
        Self { identity:self.identity, point_array_identity:self.point_array_identity, via_array_identity:self.via_array_identity,
            connection_name:self.connection_name.clone(),root_connection_name:self.root_connection_name.clone(),
            trace_thickness:self.trace_thickness,via_diameter:self.via_diameter,route:self.route.clone(),vias:self.vias.clone(),metadata:self.metadata.clone() }
    }

    pub fn from_value(value: &Value) -> Self {
        Self {
            identity: next_identity(), point_array_identity: next_identity(), via_array_identity: next_identity(),
            connection_name: value["connectionName"].as_str().expect("Route connectionName is required").to_owned(),
            root_connection_name: value["rootConnectionName"].as_str().map(str::to_owned),
            trace_thickness: value["traceThickness"].as_f64(),
            via_diameter: value["viaDiameter"].as_f64(),
            route: value["route"].as_array().expect("Route points are required").iter().map(|point| Rc::new(RefCell::new(RoutePoint::from_value(point)))).collect(),
            vias: value["vias"].as_array().expect("Route vias are required").clone(),
            metadata: Rc::new(value.clone()),
        }
    }

    pub fn from_owned_value(mut value: Value) -> Self {
        let Value::Array(points) = value["route"].take() else { panic!("Route points are required"); };
        let Value::Array(vias) = value["vias"].take() else { panic!("Route vias are required"); };
        Self {
            identity: next_identity(), point_array_identity: next_identity(), via_array_identity: next_identity(),
            connection_name: value["connectionName"].as_str().expect("Route connectionName is required").to_owned(),
            root_connection_name: value["rootConnectionName"].as_str().map(str::to_owned),
            trace_thickness: value["traceThickness"].as_f64(),
            via_diameter: value["viaDiameter"].as_f64(),
            route: points.into_iter().map(|point| Rc::new(RefCell::new(RoutePoint::from_owned_value(point)))).collect(),
            vias,
            metadata: Rc::new(value),
        }
    }

    pub fn to_value(&self) -> Value {
        let mut value = self.metadata.as_ref().clone();
        value["route"] = Value::Array(self.route.iter().map(|point| point.borrow().to_value()).collect());
        value["vias"] = Value::Array(self.vias.clone());
        value
    }
}

#[derive(Clone, Debug)]
pub struct ViaNode {
    pub route_index: usize,
    pub root_connection_name: String,
    pub point_indexes: Vec<usize>,
    pub z_layers: Vec<f64>,
    pub x: f64,
    pub y: f64,
    pub radius: f64,
    pub movable: bool,
    pub can_canonicalize: bool,
}

#[derive(Clone, Debug)]
pub struct Segment {
    pub route_index: usize,
    pub root_connection_name: String,
    pub start_index: usize,
    pub end_index: usize,
    pub start: Rc<RefCell<RoutePoint>>,
    pub end: Rc<RefCell<RoutePoint>>,
    pub z: f64,
    pub radius: f64,
}

