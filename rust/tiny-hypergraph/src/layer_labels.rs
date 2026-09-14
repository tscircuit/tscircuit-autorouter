use serde_json::Value;

pub fn get_z_layer_label<T: Clone + Into<Value>>(layers: &[T]) -> Option<String> {
    let mut normalized: Vec<f64> = layers
        .iter()
        .filter_map(|layer| layer.clone().into().as_f64())
        .filter(|z| z.is_finite() && z.fract() == 0.0 && *z >= 0.0)
        .collect();
    normalized.sort_by(|a, b| a.partial_cmp(b).unwrap());
    normalized.dedup();
    if normalized.is_empty() {
        return None;
    }

    Some(format!(
        "z{}",
        normalized
            .iter()
            .map(|z| z.to_string())
            .collect::<Vec<_>>()
            .join(",")
    ))
}

pub fn get_available_z_from_mask(mask: i32) -> Vec<i32> {
    let mut available_z = Vec::new();

    for z in 0..31 {
        if (mask & (1 << z)) != 0 {
            available_z.push(z);
        }
    }

    available_z
}
