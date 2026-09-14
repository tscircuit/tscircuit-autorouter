use high_density_repair03::solvers::global_drc_force_improve_solver::internal_types::{
    MutableRoute, RoutePoint,
};
use serde_json::Value;

// This private encoding preserves equality of the ordered JSON cache key. Tags,
// fixed-width numbers and length-prefixed UTF-8 make it unambiguous without hashes.
fn write_number(value: f64, output: &mut Vec<u8>) {
    if !value.is_finite() {
        output.push(b'n');
    } else {
        output.push(b'd');
        // JSON.stringify collapses both zero signs; every other finite double
        // has its own round-trippable shortest decimal representation.
        output.extend_from_slice(&if value == 0.0 { 0_u64 } else { value.to_bits() }.to_le_bytes());
    }
}

fn write_string(value: &str, output: &mut Vec<u8>) {
    // Fixed domain tokens are distinct from literal strings, including when the
    // same text occurs as a metadata value instead of an object key.
    let token = match value {
        "x" => Some(0),
        "y" => Some(1),
        "z" => Some(2),
        "traceThickness" => Some(3),
        "pcb_port_id" => Some(4),
        "connectionName" => Some(5),
        "rootConnectionName" => Some(6),
        "viaDiameter" => Some(7),
        "route" => Some(8),
        "vias" => Some(9),
        "jumpers" => Some(10),
        "portPointId" => Some(11),
        _ => None,
    };
    if let Some(token) = token {
        output.extend_from_slice(&[b'k', token]);
    } else {
        output.push(b's');
        output.extend_from_slice(&(value.len() as u64).to_le_bytes());
        output.extend_from_slice(value.as_bytes());
    }
}

fn write_value(value: &Value, output: &mut Vec<u8>) {
    match value {
        Value::Null => output.push(b'n'),
        Value::Bool(value) => output.push(if *value { b't' } else { b'f' }),
        Value::Number(value) => write_number(value.as_f64().expect("JSON number"), output),
        Value::String(value) => write_string(value, output),
        Value::Array(values) => write_values(values, output),
        Value::Object(values) => {
            output.push(b'{');
            for (key, value) in values {
                write_string(key, output);
                write_value(value, output);
            }
            output.push(b'}');
        }
    }
}

fn write_values(values: &[Value], output: &mut Vec<u8>) {
    output.push(b'[');
    for value in values {
        write_value(value, output);
    }
    output.push(b']');
}

fn write_point(point: &RoutePoint, output: &mut Vec<u8>) {
    let metadata = point.metadata.as_object();
    output.push(b'{');
    for (key, value) in metadata.into_iter().flatten() {
        write_string(key, output);
        match key.as_str() {
            "x" => write_number(point.x, output),
            "y" => write_number(point.y, output),
            "z" => write_number(point.z, output),
            _ => write_value(value, output),
        }
    }
    for (key, value) in [("x", point.x), ("y", point.y), ("z", point.z)] {
        if metadata.is_some_and(|object| object.contains_key(key)) {
            continue;
        }
        write_string(key, output);
        write_number(value, output);
    }
    output.push(b'}');
}

fn write_points(route: &MutableRoute, output: &mut Vec<u8>) {
    output.push(b'[');
    for point in &route.route {
        write_point(&point.borrow(), output);
    }
    output.push(b']');
}

pub(crate) fn write_route_values_key(routes: &[Value], output: &mut Vec<u8>) {
    output.clear();
    write_values(routes, output);
}

#[cfg(test)]
fn route_values_key(routes: &[Value]) -> Vec<u8> {
    let mut output = Vec::new();
    write_route_values_key(routes, &mut output);
    output
}

pub(crate) fn write_mutable_routes_key(routes: &[MutableRoute], output: &mut Vec<u8>) {
    output.clear();
    output.push(b'[');
    for route in routes {
        let metadata = route.metadata.as_object();
        output.push(b'{');
        for (key, value) in metadata.into_iter().flatten() {
            write_string(key, output);
            match key.as_str() {
                "route" => write_points(route, output),
                "vias" => write_values(&route.vias, output),
                _ => write_value(value, output),
            }
        }
        for key in ["route", "vias"] {
            if metadata.is_some_and(|object| object.contains_key(key)) {
                continue;
            }
            write_string(key, output);
            if key == "route" {
                write_points(route, output);
            } else {
                write_values(&route.vias, output);
            }
        }
        output.push(b'}');
    }
    output.push(b']');
}

#[cfg(test)]
fn mutable_routes_key(routes: &[MutableRoute]) -> Vec<u8> {
    let mut output = Vec::new();
    write_mutable_routes_key(routes, &mut output);
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bindings::repair::mutable_route_json::js_json_routes;
    use indexmap::IndexMap;
    use json_bindings::js_json::js_json_slice;
    use serde_json::json;
    use std::rc::Rc;

    #[test]
    fn binary_keys_preserve_json_equality_and_typed_value_cache_order() {
        let mut corpus = vec![
            vec![],
            vec![Value::Null],
            vec![json!(true)],
            vec![json!(false)],
            vec![json!("")],
            vec![json!("n")],
            vec![json!("[{}]ds\u{0000}")],
            vec![json!("é漢字😀\u{2028}\u{2029}")],
            vec![json!([])],
            vec![json!({})],
            vec![json!([null])],
            vec![json!({"a": 1, "b": 2})],
            vec![json!({"b": 2, "a": 1})],
            vec![json!(9007199254740992_u64)],
            vec![json!(9007199254740993_u64)],
        ];
        for token in [
            "x",
            "y",
            "z",
            "traceThickness",
            "pcb_port_id",
            "connectionName",
            "rootConnectionName",
            "viaDiameter",
            "route",
            "vias",
            "jumpers",
            "portPointId",
        ] {
            corpus.push(vec![json!(token)]);
            corpus.push(vec![json!({token: token})]);
            corpus.push(vec![json!(format!("{token}\0"))]);
            corpus.push(vec![json!(format!("k{token}"))]);
        }
        if let Ok(path) = std::env::var("REPAIR_CACHE_KEY_FIXTURE") {
            let fixture: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
            let values = fixture["params"]["hdRoutes"].as_array().unwrap();
            let routes: Vec<_> = values.iter().map(MutableRoute::from_value).collect();
            let key = mutable_routes_key(&routes);
            assert_eq!(key, route_values_key(values));
            assert_eq!(js_json_routes(&routes), js_json_slice(values));
            eprintln!(
                "Captured routes: {}, binary key bytes: {}, JSON bytes: {}",
                routes.len(),
                key.len(),
                js_json_slice(values).len()
            );
        }
        let mut typed_keys = Vec::new();
        for number in [
            0.0,
            -0.0,
            1e-7,
            1e-6,
            1e20,
            1e21,
            f64::MIN_POSITIVE,
            f64::from_bits(1),
            f64::MAX,
            -f64::MAX,
            f64::NAN,
            f64::INFINITY,
            f64::NEG_INFINITY,
        ] {
            corpus.push(vec![Value::from(number)]);
            for omit_overlay_keys in [false, true] {
                let mut route = MutableRoute::from_owned_value(json!({
                    "connectionName": "a\u{0000}b", "vias": [{"x": 1, "y": 2}],
                    "route": [{"y": 2, "custom": {"quote\"": [null, true, "\\"]}, "z": 0, "x": 1}],
                    "metadata": {"second": 2, "first": 1}
                }));
                {
                    let mut point = route.route[0].borrow_mut();
                    point.x = number;
                    point.y = -number;
                    point.z = -0.0;
                    if omit_overlay_keys {
                        let metadata = Rc::make_mut(&mut point.metadata).as_object_mut().unwrap();
                        metadata.remove("x");
                        metadata.remove("y");
                        metadata.remove("z");
                    }
                }
                if omit_overlay_keys {
                    let metadata = Rc::make_mut(&mut route.metadata).as_object_mut().unwrap();
                    metadata.remove("route");
                    metadata.remove("vias");
                }
                let values = vec![route.to_value()];
                let typed_key = mutable_routes_key(std::slice::from_ref(&route));
                assert_eq!(typed_key, route_values_key(&values));
                assert_eq!(js_json_routes(&[route]), js_json_slice(&values));
                typed_keys.push((typed_key, values.clone()));
                corpus.push(values);
            }
        }
        // Exercise ordinary and exponent-boundary bit patterns without relying
        // on decimal parsing to generate the numeric oracle corpus.
        let mut bits = 0x123456789abcdef0_u64;
        for _ in 0..256 {
            bits = bits.wrapping_mul(6364136223846793005).wrapping_add(1);
            corpus.push(vec![Value::from(f64::from_bits(bits))]);
        }
        let mut scratch = Vec::with_capacity(65536);
        let allocation = scratch.as_ptr();
        for values in &corpus {
            write_route_values_key(values, &mut scratch);
            assert_eq!(scratch, route_values_key(values));
            assert_eq!(scratch.as_ptr(), allocation);
        }
        let encoded: Vec<_> = corpus
            .iter()
            .map(|values| (route_values_key(values), js_json_slice(values)))
            .collect();
        for (left_key, left_json) in &encoded {
            for (right_key, right_json) in &encoded {
                assert_eq!(left_key == right_key, left_json == right_json);
            }
        }
        let mut json_cache = IndexMap::new();
        let mut binary_cache = IndexMap::new();
        let mut sequence: Vec<_> = encoded
            .iter()
            .map(|(key, json)| (key.clone(), json.clone()))
            .collect();
        sequence.extend(
            typed_keys
                .iter()
                .map(|(key, values)| (key.clone(), js_json_slice(values))),
        );
        sequence.extend(sequence.clone());
        let mut evaluation_count = 0;
        for (key, json) in sequence {
            assert_eq!(binary_cache.get(&key), json_cache.get(&json));
            if !json_cache.contains_key(&json) {
                if json_cache.len() >= 64 {
                    json_cache.shift_remove_index(0);
                    binary_cache.shift_remove_index(0);
                }
                evaluation_count += 1;
                json_cache.insert(json, evaluation_count);
                binary_cache.insert(key, evaluation_count);
            }
            assert_eq!(binary_cache.len(), json_cache.len());
            assert_eq!(
                binary_cache.values().collect::<Vec<_>>(),
                json_cache.values().collect::<Vec<_>>()
            );
        }
    }
}
