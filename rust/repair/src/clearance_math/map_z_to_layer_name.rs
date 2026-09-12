use autorouting_drc::math_utils::js_number_to_string;

pub fn map_z_to_layer_name(z: f64, layer_count: f64) -> String {
    if z == 0.0 { return "top".to_owned(); }
    if z == layer_count - 1.0 { return "bottom".to_owned(); }
    format!("inner{}", js_number_to_string(z))
}
