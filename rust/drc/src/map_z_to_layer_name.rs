pub fn map_z_to_layer_name(z: usize, layer_count: usize) -> String {
    if z == 0 { return "top".to_owned(); }
    if z == layer_count - 1 { return "bottom".to_owned(); }
    format!("inner{z}")
}
