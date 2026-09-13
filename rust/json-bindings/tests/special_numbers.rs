use json_bindings::JsonInput;
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Deserialize)]
struct Input {
    coordinate: f64,
    optional: Option<f64>,
    metadata: Value,
}

#[test]
fn preserves_typed_special_numbers_and_existing_metadata_deserialization() {
    let input: JsonInput<Input> = serde_json::from_value(json!({
        "value": { "coordinate": null, "optional": null, "metadata": { "zero": null, "nonfinite": null } },
        "numbers": [
            { "path": ["coordinate"], "value": "-0" },
            { "path": ["optional"], "value": "Infinity" },
            { "path": ["metadata", "zero"], "value": "-0" },
            { "path": ["metadata", "nonfinite"], "value": "NaN" }
        ]
    })).unwrap();
    let input = input.deserialize().unwrap();
    assert_eq!(input.coordinate.to_bits(), (-0.0_f64).to_bits());
    assert_eq!(input.optional, Some(f64::INFINITY));
    assert_eq!(input.metadata["zero"], json!(0));
    assert!(input.metadata["nonfinite"].is_null());
}
