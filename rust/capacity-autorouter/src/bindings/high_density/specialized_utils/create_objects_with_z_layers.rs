use super::map_layer_name_to_z::{
    get_unique_valid_z_layers, get_unique_valid_z_layers_from_layer_names,
};
use serde_json::{Value, json};

pub fn create_objects_with_z_layers(objects: &[Value], layer_count: f64) -> Vec<Value> {
    create_objects_with_z_layers_owned(objects.to_vec(), layer_count)
}

pub fn create_objects_with_z_layers_owned(objects: Vec<Value>, layer_count: f64) -> Vec<Value> {
    let all: Vec<f64> = (0..layer_count.max(0.0).floor() as usize)
        .map(|index| index as f64)
        .collect();
    objects
        .into_iter()
        .map(|mut object| {
            let candidates =
                if let Some(layers) = object.get("__zLayers").filter(|value| !value.is_null()) {
                    layers
                        .as_array()
                        .expect("Z layers array")
                        .iter()
                        .map(|value| value.as_f64().expect("Numeric layer"))
                        .collect()
                } else if let Some(layers) = object
                    .get("layers")
                    .filter(|value| !value.is_null() && **value != false)
                {
                    let names: Vec<_> = layers
                        .as_array()
                        .expect("Layers array")
                        .iter()
                        .map(|value| value.as_str().expect("Layer name"))
                        .collect();
                    get_unique_valid_z_layers_from_layer_names(&names, layer_count)
                } else {
                    all.clone()
                };
            let layers = get_unique_valid_z_layers(&candidates, layer_count);
            object["__zLayers"] = json!(if layers.is_empty() { &all } else { &layers });
            object
        })
        .collect()
}
