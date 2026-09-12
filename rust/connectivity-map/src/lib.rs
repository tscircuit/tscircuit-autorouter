pub mod connectivity_map;
pub mod get_connectivity_map_from_simple_route_json;
pub mod map_layer_name_to_z;

#[cfg_attr(feature = "wasm-types", derive(tsify::Tsify))]
#[cfg_attr(feature = "wasm-types", tsify(type_prefix = "Connectivity"))]
#[derive(serde::Deserialize, serde::Serialize)]
#[serde(untagged)]
pub enum WireString {
    Text(String),
    Units(Vec<u16>),
}

impl WireString {
    pub fn into_units(self) -> Vec<u16> {
        match self {
            Self::Text(value) => value.encode_utf16().collect(),
            Self::Units(value) => value,
        }
    }

    pub fn from_units(value: Vec<u16>) -> Self {
        match String::from_utf16(&value) {
            Ok(text) => Self::Text(text),
            Err(_) => Self::Units(value),
        }
    }
}

pub fn deserialize_js_number<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<f64, D::Error> {
    use serde::Deserialize;
    match serde_json::Value::deserialize(deserializer)? {
        serde_json::Value::Number(number) => number.as_f64().ok_or_else(|| serde::de::Error::custom("Number required")),
        serde_json::Value::String(tag) => match tag.as_str() {
            "NaN" => Ok(f64::NAN),
            "Infinity" => Ok(f64::INFINITY),
            "-Infinity" => Ok(f64::NEG_INFINITY),
            _ => Err(serde::de::Error::custom("Invalid number tag")),
        },
        _ => Err(serde::de::Error::custom("Number required")),
    }
}
