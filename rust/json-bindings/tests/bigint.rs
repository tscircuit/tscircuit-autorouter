use json_bindings::JsonInput;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Deserialize, Serialize)]
struct Metadata {
    #[serde(serialize_with = "json_bindings::serialize_js_value")]
    value: Value,
}

#[derive(Deserialize)]
struct FloatInput {
    #[allow(dead_code)]
    value: f64,
}

#[derive(Deserialize)]
struct IntegerInput {
    #[allow(dead_code)]
    value: i32,
}

#[test]
fn bigint_metadata_keeps_existing_numeric_conversion_and_rejection_boundaries() {
    for (tag, expected, serializable) in [
        ("BigInt:42", 42.0, true),
        ("BigInt:9007199254740991", 9007199254740991.0, true),
        ("BigInt:9007199254740992", 9007199254740992.0, false),
        ("Number:10000000000000000", 1e16, true),
    ] {
        let wire =
            json!({ "value": { "value": null }, "numbers": [{ "path": ["value"], "value": tag }] });
        let input: JsonInput<Metadata> = serde_json::from_value(wire.clone()).unwrap();
        let input = input.deserialize().unwrap();
        assert_eq!(input.value.as_f64(), Some(expected));
        assert_eq!(serde_json::to_string(&input).is_ok(), serializable);
        if tag.starts_with("BigInt:") {
            let float: JsonInput<FloatInput> = serde_json::from_value(wire.clone()).unwrap();
            let integer: JsonInput<IntegerInput> = serde_json::from_value(wire).unwrap();
            assert!(float.deserialize().is_err());
            assert!(integer.deserialize().is_err());
        }
    }
}
