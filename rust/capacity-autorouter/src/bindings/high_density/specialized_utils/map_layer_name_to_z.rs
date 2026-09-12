pub fn map_layer_name_to_z(name: &str, layer_count: f64) -> f64 {
    if name == "top" {
        return 0.0;
    }
    if name == "bottom" {
        return layer_count - 1.0;
    }
    let suffix: String = String::from_utf16_lossy(&name.encode_utf16().skip(5).collect::<Vec<_>>());
    let mut value = suffix.trim_start();
    let sign = if let Some(rest) = value.strip_prefix('-') {
        value = rest;
        -1.0
    } else {
        if let Some(rest) = value.strip_prefix('+') {
            value = rest;
        }
        1.0
    };
    let radix = if value.starts_with("0x") || value.starts_with("0X") {
        value = &value[2..];
        16
    } else {
        10
    };
    let mut number = 0.0;
    let mut found = false;
    for ch in value.chars() {
        let Some(digit) = ch.to_digit(radix) else {
            break;
        };
        number = number * radix as f64 + digit as f64;
        found = true;
    }
    if found { sign * number } else { f64::NAN }
}

pub fn get_unique_valid_z_layers(layers: &[f64], layer_count: f64) -> Vec<f64> {
    let mut result = Vec::new();
    for &z in layers {
        if z.is_finite() && z.fract() == 0.0 && z >= 0.0 && z < layer_count && !result.contains(&z)
        {
            result.push(if z == 0.0 { 0.0 } else { z });
        }
    }
    result.sort_by(|a, b| a.partial_cmp(b).expect("Finite layer"));
    result
}

pub fn get_unique_valid_z_layers_from_layer_names(names: &[&str], layer_count: f64) -> Vec<f64> {
    get_unique_valid_z_layers(
        &names
            .iter()
            .map(|name| map_layer_name_to_z(name, layer_count))
            .collect::<Vec<_>>(),
        layer_count,
    )
}
