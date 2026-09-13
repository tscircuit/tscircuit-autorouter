use serde_json::Value;

use super::map_z_to_layer_name;

pub fn get_via_layers(via: &Value, layer_count: usize) -> Vec<String> {
    let from_layer = via["from_layer"]
        .as_str()
        .expect("Via from_layer is required");
    let to_layer = via["to_layer"].as_str().expect("Via to_layer is required");
    get_via_layers_from_span(from_layer, to_layer, layer_count)
}

pub fn get_via_layers_from_span(
    from_layer: &str,
    to_layer: &str,
    layer_count: usize,
) -> Vec<String> {
    assert!(layer_count >= 1, "Invalid board layer count: {layer_count}");
    let board_layers: Vec<String> = (0..layer_count)
        .map(|z| map_z_to_layer_name::map_z_to_layer_name(z, layer_count))
        .collect();
    let from = board_layers.iter().position(|layer| layer == from_layer);
    let to = board_layers.iter().position(|layer| layer == to_layer);
    let (Some(from), Some(to)) = (from, to) else {
        panic!("Via span {from_layer} -> {to_layer} is outside the board");
    };
    board_layers[from.min(to)..=from.max(to)].to_vec()
}
