use serde_json::Value;
use crate::types::Bounds;

pub fn get_bounds_from_node_with_port_points(node: &Value) -> Bounds {
    let x = node["center"]["x"].as_f64().expect("node center.x");
    let y = node["center"]["y"].as_f64().expect("node center.y");
    let width = node["width"].as_f64().expect("node width");
    let height = node["height"].as_f64().expect("node height");
    let mut bounds = Bounds {
        min_x: x - width / 2.0,
        max_x: x + width / 2.0,
        min_y: y - height / 2.0,
        max_y: y + height / 2.0,
    };

    for point in node["portPoints"].as_array().expect("node portPoints") {
        let x = point["x"].as_f64().expect("port point x");
        let y = point["y"].as_f64().expect("port point y");
        if x < bounds.min_x { bounds.min_x = x; }
        if x > bounds.max_x { bounds.max_x = x; }
        if y < bounds.min_y { bounds.min_y = y; }
        if y > bounds.max_y { bounds.max_y = y; }
    }
    bounds
}
