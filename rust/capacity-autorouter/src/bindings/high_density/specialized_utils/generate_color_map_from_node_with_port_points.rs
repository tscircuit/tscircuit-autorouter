use serde_json::{Value, Map};
use crate::utils::js_number::js_number_to_string;

pub fn generate_color_map_from_node_with_port_points(node: &Value) -> Value {
    let points = node["portPoints"].as_array().expect("Node portPoints required");
    let mut colors = Map::new();
    for (index, point) in points.iter().enumerate() {
        let name = point["connectionName"].as_str().expect("Port connectionName required");
        colors.insert(name.to_owned(), Value::from(format!("hsl({}, 100%, 50%)", js_number_to_string(index as f64 * 360.0 / points.len() as f64))));
    }
    Value::Object(colors)
}
