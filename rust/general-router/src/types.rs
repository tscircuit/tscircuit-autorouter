use serde::{Deserialize, Serialize, Serializer};
use serde::ser::SerializeMap;
use serde_json::{Map, Value};

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Point2 {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

pub type Point3 = Point;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutePoint {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inside_jumper_pad: Option<bool>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl RoutePoint {
    pub fn point(&self) -> Point {
        Point {
            x: self.x,
            y: self.y,
            z: self.z,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Route {
    pub connection_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub root_connection_name: Option<String>,
    pub trace_thickness: f64,
    pub via_diameter: f64,
    pub route: Vec<RoutePoint>,
    pub vias: Vec<Point2>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub region_id: Option<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
    #[serde(skip)]
    pub simple_path: bool,
}

impl Serialize for Route {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(None)?;
        map.serialize_entry("connectionName", &self.connection_name)?;
        if let Some(root) = &self.root_connection_name {
            map.serialize_entry("rootConnectionName", root)?;
        }
        if let Some(region) = &self.region_id {
            map.serialize_entry("regionId", region)?;
        }
        // handleSimpleCases inserts the route before dimensions; setSolvedPath
        // and the intra-node same-point case insert it after dimensions.
        if self.simple_path { map.serialize_entry("route", &self.route)?; }
        map.serialize_entry("traceThickness", &self.trace_thickness)?;
        map.serialize_entry("viaDiameter", &self.via_diameter)?;
        if !self.simple_path { map.serialize_entry("route", &self.route)?; }
        map.serialize_entry("vias", &self.vias)?;
        for (key, value) in &self.extra { map.serialize_entry(key, value)?; }
        map.end()
    }
}

pub type HighDensityIntraNodeRoute = Route;
pub type HighDensityRoute = Route;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortPoint {
    pub connection_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub root_connection_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port_point_id: Option<String>,
    #[serde(default, rename = "pcb_port_id", skip_serializing_if = "Option::is_none")]
    pub pcb_port_id: Option<String>,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prev_port_point_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_port_point_id: Option<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl PortPoint {
    pub fn point(&self) -> Point {
        Point {
            x: self.x,
            y: self.y,
            z: self.z,
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeWithPortPoints {
    pub capacity_mesh_node_id: String,
    pub center: Point2,
    pub width: f64,
    pub height: f64,
    pub port_points: Vec<PortPoint>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub available_z: Option<Vec<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port_points_in_pairs: Option<Vec<[PortPoint; 2]>>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bounds {
    pub min_x: f64,
    pub max_x: f64,
    pub min_y: f64,
    pub max_y: f64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FutureConnection {
    pub connection_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub root_connection_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub region_id: Option<String>,
    pub points: Vec<Point>,
}
