use serde::Deserialize;
use indexmap::{IndexMap, IndexSet};
use crate::{connectivity_map::ConnectivityMap, map_layer_name_to_z::map_layer_name_to_z};

#[cfg_attr(feature = "wasm-types", derive(tsify::Tsify))]
#[cfg_attr(feature = "wasm-types", tsify(type_prefix = "Connectivity"))]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Input {
    pub strings: Vec<crate::WireString>,
    pub prototype_values: Vec<(usize, Option<usize>)>,
    #[serde(deserialize_with = "crate::deserialize_js_number")]
    #[cfg_attr(feature = "wasm-types", tsify(type = "number | string"))]
    pub layer_count: f64,
    pub connections: Vec<Connection>,
    pub obstacles: Vec<Obstacle>,
    pub traces: Vec<Trace>,
}

#[cfg_attr(feature = "wasm-types", derive(tsify::Tsify))]
#[cfg_attr(feature = "wasm-types", tsify(type_prefix = "Connectivity"))]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub name: usize,
    pub roots: Vec<usize>,
    pub net: Option<usize>,
    pub points: Vec<Point>,
}

#[cfg_attr(feature = "wasm-types", derive(tsify::Tsify))]
#[cfg_attr(feature = "wasm-types", tsify(type_prefix = "Connectivity"))]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    #[serde(deserialize_with = "crate::deserialize_js_number")]
    #[cfg_attr(feature = "wasm-types", tsify(type = "number | string"))]
    pub x: f64,
    #[serde(deserialize_with = "crate::deserialize_js_number")]
    #[cfg_attr(feature = "wasm-types", tsify(type = "number | string"))]
    pub y: f64,
    pub layers: Option<Vec<usize>>,
    pub layer: Option<usize>,
    pub port: Option<usize>,
    pub point_id: Option<usize>,
}

#[cfg_attr(feature = "wasm-types", derive(tsify::Tsify))]
#[cfg_attr(feature = "wasm-types", tsify(type_prefix = "Connectivity"))]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Obstacle {
    pub id: Option<usize>,
    pub connected: Vec<usize>,
    pub off_board: Vec<usize>,
    #[serde(deserialize_with = "crate::deserialize_js_number")]
    #[cfg_attr(feature = "wasm-types", tsify(type = "number | string"))]
    pub x: f64,
    #[serde(deserialize_with = "crate::deserialize_js_number")]
    #[cfg_attr(feature = "wasm-types", tsify(type = "number | string"))]
    pub y: f64,
    pub layers: Vec<usize>,
}

#[cfg_attr(feature = "wasm-types", derive(tsify::Tsify))]
#[cfg_attr(feature = "wasm-types", tsify(type_prefix = "Connectivity"))]
#[derive(Deserialize)]
pub struct Trace {
    pub ids: Vec<usize>,
}

fn point_hash(x: f64, y: f64) -> String {
    fn rounded(value: f64) -> f64 {
        let floor = value.floor();
        if value - floor >= 0.5 { floor + 1.0 } else { floor }
    }
    format!("{},{}",
        ryu_js::Buffer::new().format(rounded(x * 100.0)),
        ryu_js::Buffer::new().format(rounded(y * 100.0)))
}

fn layers_key(layers: &[usize], map: &ConnectivityMap, count: f64) -> String {
    let mut layers: Vec<String> = layers.iter().map(|id| {
        ryu_js::Buffer::new().format(map_layer_name_to_z(&map.strings[*id], count)).to_owned()
    }).collect();
    layers.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    layers.join("-")
}

pub fn get_connectivity_map_from_simple_route_json(input: Input) -> ConnectivityMap {
    let mut map = ConnectivityMap::new(
        input.strings.into_iter().map(crate::WireString::into_units).collect(),
        input.prototype_values.into_iter().collect::<IndexMap<_, _>>(),
    );
    for connection in input.connections {
        for root in connection.roots {
            if !map.add_connections(&[vec![connection.name, root]]) { return map; }
        }
        if let Some(net) = connection.net {
            if !map.add_connections(&[vec![connection.name, net]]) { return map; }
        }

        for point in connection.points {
            let layers = if let Some(layers) = point.layers {
                layers_key(&layers, &map, input.layer_count)
            } else {
                ryu_js::Buffer::new().format(map_layer_name_to_z(
                    &map.strings[point.layer.expect("Point layer required")], input.layer_count,
                )).to_owned()
            };
            let coordinate = map.intern(format!("{}:{layers}", point_hash(point.x, point.y)).encode_utf16().collect());
            if !map.add_connections(&[vec![connection.name, coordinate]]) { return map; }
            if let Some(port) = point.port {
                if !map.add_connections(&[vec![connection.name, port]]) { return map; }
            }
            if let Some(id) = point.point_id {
                if !map.add_connections(&[vec![connection.name, id]]) { return map; }
            }
        }
    }

    for obstacle in input.obstacles {
        let coordinate = map.intern(format!("{}:{}",
            point_hash(obstacle.x, obstacle.y), layers_key(&obstacle.layers, &map, input.layer_count),
        ).encode_utf16().collect());
        let group: IndexSet<_> = obstacle.id.into_iter()
            .chain(obstacle.connected).chain(obstacle.off_board).chain([coordinate]).collect();
        if !group.is_empty() && !map.add_connections(&[group.into_iter().collect()]) { return map; }
    }

    for trace in input.traces {
        let group: IndexSet<_> = trace.ids.into_iter().collect();
        if !group.is_empty() && !map.add_connections(&[group.into_iter().collect()]) { return map; }
    }
    map
}
