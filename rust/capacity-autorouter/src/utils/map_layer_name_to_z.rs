pub fn map_layer_name_to_z(name: &str, layer_count: f64) -> f64 {
    if name == "top" {
        return 0.0;
    }
    if name == "bottom" {
        return layer_count - 1.0;
    }
    let units: Vec<_> = name.encode_utf16().skip(5).collect();
    let suffix = String::from_utf16_lossy(&units);
    let text = suffix.trim_start();
    let (sign, text) = if let Some(text) = text.strip_prefix('-') {
        (-1.0, text)
    } else {
        (1.0, text.strip_prefix('+').unwrap_or(text))
    };
    let (radix, text) = if text.starts_with("0x") || text.starts_with("0X") {
        (16, &text[2..])
    } else {
        (10, text)
    };
    let mut value = 0.0;
    let mut digits = 0;
    for c in text.chars() {
        let Some(d) = c.to_digit(radix) else {
            break;
        };
        value = value * radix as f64 + d as f64;
        digits += 1;
    }
    if digits == 0 { f64::NAN } else { sign * value }
}
pub fn get_unique_valid_z_layers(layers: &[f64], layer_count: f64) -> Vec<f64> {
    let mut output = Vec::new();
    for &z in layers {
        if z.is_finite() && z.fract() == 0.0 && z >= 0.0 && z < layer_count && !output.contains(&z)
        {
            output.push(if z == 0.0 { 0.0 } else { z });
        }
    }
    output.sort_by(|a, b| a.partial_cmp(b).unwrap());
    output
}
pub fn get_unique_valid_z_layers_from_layer_names(layers: &[String], count: f64) -> Vec<f64> {
    get_unique_valid_z_layers(
        &layers
            .iter()
            .map(|n| map_layer_name_to_z(n, count))
            .collect::<Vec<_>>(),
        count,
    )
}
