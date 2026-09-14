use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bounds {
    pub min_x: f64,
    pub max_x: f64,
    pub min_y: f64,
    pub max_y: f64,
}

pub fn get_bounds_from_node_with_port_points(node: &Value) -> Bounds {
    let x = node["center"]["x"]
        .as_f64()
        .expect("Node center.x required");
    let y = node["center"]["y"]
        .as_f64()
        .expect("Node center.y required");
    let width = node["width"].as_f64().expect("Node width required");
    let height = node["height"].as_f64().expect("Node height required");
    let mut bounds = Bounds {
        min_x: x - width / 2.0,
        max_x: x + width / 2.0,
        min_y: y - height / 2.0,
        max_y: y + height / 2.0,
    };
    for point in node["portPoints"]
        .as_array()
        .expect("Node portPoints required")
    {
        let x = point["x"].as_f64().expect("Port x required");
        let y = point["y"].as_f64().expect("Port y required");
        if x < bounds.min_x {
            bounds.min_x = x;
        }
        if x > bounds.max_x {
            bounds.max_x = x;
        }
        if y < bounds.min_y {
            bounds.min_y = y;
        }
        if y > bounds.max_y {
            bounds.max_y = y;
        }
    }
    bounds
}
