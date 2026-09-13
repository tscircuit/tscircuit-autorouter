use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortPoint {
    pub connection_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub root_connection_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port_point_id: Option<String>,
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

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeWithPortPoints {
    pub capacity_mesh_node_id: String,
    pub center: Point,
    pub width: f64,
    pub height: f64,
    pub port_points: Vec<PortPoint>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub available_z: Option<Vec<f64>>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HighDensityRoutePoint {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inside_jumper_pad: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port_point_id: Option<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HighDensityIntraNodeRoute {
    pub connection_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub root_connection_name: Option<String>,
    pub trace_thickness: f64,
    pub via_diameter: f64,
    pub route: Vec<HighDensityRoutePoint>,
    pub vias: Vec<Point>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub jumpers: Option<Vec<Jumper>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub region_id: Option<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

pub type HighDensityRoute = HighDensityIntraNodeRoute;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HighDensityRouteWithOrder {
    #[serde(flatten)]
    pub route: HighDensityIntraNodeRoute,
    pub segment_order: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Jumper {
    pub route_type: JumperRouteType,
    pub start: Point,
    pub end: Point,
    pub footprint: JumperFootprint,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum JumperRouteType {
    #[serde(rename = "jumper")]
    Jumper,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum JumperFootprint {
    #[serde(rename = "0603")]
    Size0603,
    #[serde(rename = "1206")]
    Size1206,
    #[serde(rename = "1206x4_pair")]
    Size1206x4Pair,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HighDensityIntraNodeRouteWithJumpers {
    pub connection_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub root_connection_name: Option<String>,
    pub trace_thickness: f64,
    pub route: Vec<HighDensityRoutePoint>,
    pub jumpers: Vec<Jumper>,
}
