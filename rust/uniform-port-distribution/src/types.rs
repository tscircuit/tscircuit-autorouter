use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(untagged)]
pub enum Name {
    String(String),
    Units { __utf16: Vec<u16> },
}

impl Name {
    pub fn is_empty(&self) -> bool {
        match self {
            Self::String(value) => value.is_empty(),
            Self::Units { __utf16 } => __utf16.is_empty(),
        }
    }

    pub fn utf16(&self) -> Vec<u16> {
        match self {
            Self::String(value) => value.encode_utf16().collect(),
            Self::Units { __utf16 } => __utf16.clone(),
        }
    }
}

pub type OwnerPair = [Name; 2];

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
pub struct Point { pub x: f64, pub y: f64 }

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortPoint {
    pub port_point_id: Option<Name>,
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeWithPortPoints {
    pub capacity_mesh_node_id: Name,
    pub center: Point,
    pub width: f64,
    pub height: f64,
    pub port_points: Vec<PortPoint>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputPortPoint {
    pub port_point_id: Option<Name>,
    pub connection_node_ids: Option<Vec<Name>>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputNodeWithPortPoints { pub port_points: Vec<InputPortPoint> }

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bounds {
    pub min_x: f64,
    pub max_x: f64,
    pub min_y: f64,
    pub max_y: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Side { Left, Right, Top, Bottom }

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EdgeOrientation { Vertical, Horizontal }

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedEdge {
    pub owner_node_ids: OwnerPair,
    pub owner_pair_key: Name,
    pub orientation: EdgeOrientation,
    pub x1: f64,
    pub y1: f64,
    pub x2: f64,
    pub y2: f64,
    pub center: Point,
    pub length: f64,
    #[serde(serialize_with = "serialize_node_sides")]
    pub node_side_by_owner_id: IndexMap<Name, Side>,
}

fn serialize_node_sides<S: serde::Serializer>(sides: &IndexMap<Name, Side>, serializer: S) -> Result<S::Ok, S::Error> {
    // JS reconstructs computed properties with Object.fromEntries, including
    // __proto__ as an own property rather than invoking its inherited setter.
    let entries: Vec<_> = sides.iter().collect();
    entries.serialize(serializer)
}
