use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

#[cfg_attr(feature = "wasm-types", derive(tsify::Tsify))]
#[cfg_attr(feature = "wasm-types", tsify(type_prefix = "Uniform"))]
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

#[cfg_attr(feature = "wasm-types", derive(tsify::Tsify))]
#[cfg_attr(feature = "wasm-types", tsify(type_prefix = "Uniform"))]
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
pub struct Point {
    #[cfg_attr(feature = "wasm-types", serde(with = "wire_number"))]
    #[cfg_attr(feature = "wasm-types", tsify(type = "UniformNumber"))]
    pub x: f64,
    #[cfg_attr(feature = "wasm-types", serde(with = "wire_number"))]
    #[cfg_attr(feature = "wasm-types", tsify(type = "UniformNumber"))]
    pub y: f64,
}

#[cfg_attr(feature = "wasm-types", derive(tsify::Tsify))]
#[cfg_attr(feature = "wasm-types", tsify(type_prefix = "Uniform"))]
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortPoint {
    pub port_point_id: Option<Name>,
    #[cfg_attr(feature = "wasm-types", serde(with = "wire_number"))]
    #[cfg_attr(feature = "wasm-types", tsify(type = "UniformNumber"))]
    pub x: f64,
    #[cfg_attr(feature = "wasm-types", serde(with = "wire_number"))]
    #[cfg_attr(feature = "wasm-types", tsify(type = "UniformNumber"))]
    pub y: f64,
}

#[cfg_attr(feature = "wasm-types", derive(tsify::Tsify))]
#[cfg_attr(feature = "wasm-types", tsify(type_prefix = "Uniform"))]
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeWithPortPoints {
    pub capacity_mesh_node_id: Name,
    pub center: Point,
    #[cfg_attr(feature = "wasm-types", serde(with = "wire_number"))]
    #[cfg_attr(feature = "wasm-types", tsify(type = "UniformNumber"))]
    pub width: f64,
    #[cfg_attr(feature = "wasm-types", serde(with = "wire_number"))]
    #[cfg_attr(feature = "wasm-types", tsify(type = "UniformNumber"))]
    pub height: f64,
    pub port_points: Vec<PortPoint>,
}

#[cfg_attr(feature = "wasm-types", derive(tsify::Tsify))]
#[cfg_attr(feature = "wasm-types", tsify(type_prefix = "Uniform"))]
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputPortPoint {
    pub port_point_id: Option<Name>,
    pub connection_node_ids: Option<Vec<Name>>,
}

#[cfg_attr(feature = "wasm-types", derive(tsify::Tsify))]
#[cfg_attr(feature = "wasm-types", tsify(type_prefix = "Uniform"))]
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputNodeWithPortPoints {
    pub port_points: Vec<InputPortPoint>,
}

#[cfg_attr(feature = "wasm-types", derive(tsify::Tsify))]
#[cfg_attr(feature = "wasm-types", tsify(type_prefix = "Uniform"))]
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bounds {
    #[cfg_attr(feature = "wasm-types", serde(with = "wire_number"))]
    #[cfg_attr(feature = "wasm-types", tsify(type = "UniformNumber"))]
    pub min_x: f64,
    #[cfg_attr(feature = "wasm-types", serde(with = "wire_number"))]
    #[cfg_attr(feature = "wasm-types", tsify(type = "UniformNumber"))]
    pub max_x: f64,
    #[cfg_attr(feature = "wasm-types", serde(with = "wire_number"))]
    #[cfg_attr(feature = "wasm-types", tsify(type = "UniformNumber"))]
    pub min_y: f64,
    #[cfg_attr(feature = "wasm-types", serde(with = "wire_number"))]
    #[cfg_attr(feature = "wasm-types", tsify(type = "UniformNumber"))]
    pub max_y: f64,
}

#[cfg_attr(feature = "wasm-types", derive(tsify::Tsify))]
#[cfg_attr(feature = "wasm-types", tsify(type_prefix = "Uniform"))]
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    Left,
    Right,
    Top,
    Bottom,
}

#[cfg_attr(feature = "wasm-types", derive(tsify::Tsify))]
#[cfg_attr(feature = "wasm-types", tsify(type_prefix = "Uniform"))]
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EdgeOrientation {
    Vertical,
    Horizontal,
}

#[cfg_attr(feature = "wasm-types", derive(tsify::Tsify))]
#[cfg_attr(feature = "wasm-types", tsify(type_prefix = "Uniform"))]
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedEdge {
    #[cfg_attr(feature = "wasm-types", tsify(type = "[UniformName, UniformName]"))]
    pub owner_node_ids: OwnerPair,
    pub owner_pair_key: Name,
    pub orientation: EdgeOrientation,
    #[cfg_attr(feature = "wasm-types", serde(with = "wire_number"))]
    #[cfg_attr(feature = "wasm-types", tsify(type = "UniformNumber"))]
    pub x1: f64,
    #[cfg_attr(feature = "wasm-types", serde(with = "wire_number"))]
    #[cfg_attr(feature = "wasm-types", tsify(type = "UniformNumber"))]
    pub y1: f64,
    #[cfg_attr(feature = "wasm-types", serde(with = "wire_number"))]
    #[cfg_attr(feature = "wasm-types", tsify(type = "UniformNumber"))]
    pub x2: f64,
    #[cfg_attr(feature = "wasm-types", serde(with = "wire_number"))]
    #[cfg_attr(feature = "wasm-types", tsify(type = "UniformNumber"))]
    pub y2: f64,
    pub center: Point,
    #[cfg_attr(feature = "wasm-types", serde(with = "wire_number"))]
    #[cfg_attr(feature = "wasm-types", tsify(type = "UniformNumber"))]
    pub length: f64,
    #[serde(serialize_with = "serialize_node_sides")]
    #[cfg_attr(feature = "wasm-types", tsify(type = "[UniformName, UniformSide][]"))]
    pub node_side_by_owner_id: IndexMap<Name, Side>,
}

fn serialize_node_sides<S: serde::Serializer>(
    sides: &IndexMap<Name, Side>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    // JS reconstructs computed properties with Object.fromEntries, including
    // __proto__ as an own property rather than invoking its inherited setter.
    let entries: Vec<_> = sides.iter().collect();
    entries.serialize(serializer)
}

#[cfg(feature = "wasm-types")]
#[derive(Serialize, Deserialize, tsify::Tsify)]
#[serde(untagged)]
pub enum UniformNumber {
    Number(f64),
    Special(UniformNumberSpecial),
}

#[cfg(feature = "wasm-types")]
#[derive(Serialize, Deserialize, tsify::Tsify)]
pub enum UniformNumberSpecial {
    NaN,
    Infinity,
    #[serde(rename = "-Infinity")]
    NegativeInfinity,
    #[serde(rename = "-0")]
    NegativeZero,
}

#[cfg(feature = "wasm-types")]
mod wire_number {
    use super::{UniformNumber, UniformNumberSpecial};
    use serde::{Deserialize, Serialize};

    pub fn serialize<S: serde::Serializer>(value: &f64, serializer: S) -> Result<S::Ok, S::Error> {
        let wire = if value.is_nan() {
            UniformNumber::Special(UniformNumberSpecial::NaN)
        } else if *value == f64::INFINITY {
            UniformNumber::Special(UniformNumberSpecial::Infinity)
        } else if *value == f64::NEG_INFINITY {
            UniformNumber::Special(UniformNumberSpecial::NegativeInfinity)
        } else if *value == 0.0 && value.is_sign_negative() {
            UniformNumber::Special(UniformNumberSpecial::NegativeZero)
        } else {
            UniformNumber::Number(*value)
        };
        wire.serialize(serializer)
    }

    pub fn deserialize<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<f64, D::Error> {
        Ok(match UniformNumber::deserialize(deserializer)? {
            UniformNumber::Number(value) => value,
            UniformNumber::Special(UniformNumberSpecial::NaN) => f64::NAN,
            UniformNumber::Special(UniformNumberSpecial::Infinity) => f64::INFINITY,
            UniformNumber::Special(UniformNumberSpecial::NegativeInfinity) => f64::NEG_INFINITY,
            UniformNumber::Special(UniformNumberSpecial::NegativeZero) => -0.0,
        })
    }
}
