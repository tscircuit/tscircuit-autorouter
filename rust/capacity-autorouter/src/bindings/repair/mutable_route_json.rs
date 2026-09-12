use serde_json::Value;
use high_density_repair03::solvers::global_drc_force_improve_solver::internal_types::{MutableRoute, RoutePoint};
use json_bindings::js_json::write_js_json;
use json_bindings::js_json::write_json_number;
use json_bindings::js_json::write_json_string;

fn write_point(point: &RoutePoint, output: &mut String) {
    let metadata = point.metadata.as_object();
    output.push('{');
    let mut first = true;
    for (key, value) in metadata.into_iter().flatten() {
        if !first { output.push(','); }
        first = false;
        write_json_string(key, output);
        output.push(':');
        match key.as_str() {
            "x" => write_json_number(point.x, output),
            "y" => write_json_number(point.y, output),
            "z" => write_json_number(point.z, output),
            _ => write_js_json(value, output),
        }
    }
    for (key, value) in [("x", point.x), ("y", point.y), ("z", point.z)] {
        if metadata.is_some_and(|object| object.contains_key(key)) { continue; }
        if !first { output.push(','); }
        first = false;
        write_json_string(key, output);
        output.push(':');
        write_json_number(value, output);
    }
    output.push('}');
}

fn write_points(route: &MutableRoute, output: &mut String) {
    output.push('[');
    for (index, point) in route.route.iter().enumerate() {
        if index != 0 { output.push(','); }
        write_point(&point.borrow(), output);
    }
    output.push(']');
}

fn write_vias(vias: &[Value], output: &mut String) {
    output.push('[');
    for (index, via) in vias.iter().enumerate() {
        if index != 0 { output.push(','); }
        write_js_json(via, output);
    }
    output.push(']');
}

pub fn js_json_routes(routes: &[MutableRoute]) -> String {
    let mut output = String::new();
    output.push('[');
    for (index, route) in routes.iter().enumerate() {
        if index != 0 { output.push(','); }
        let metadata = route.metadata.as_object();
        output.push('{');
        let mut first = true;
        for (key, value) in metadata.into_iter().flatten() {
            if !first { output.push(','); }
            first = false;
            write_json_string(key, &mut output);
            output.push(':');
            match key.as_str() {
                "route" => write_points(route, &mut output),
                "vias" => write_vias(&route.vias, &mut output),
                _ => write_js_json(value, &mut output),
            }
        }
        for key in ["route", "vias"] {
            if metadata.is_some_and(|object| object.contains_key(key)) { continue; }
            if !first { output.push(','); }
            first = false;
            write_json_string(key, &mut output);
            output.push(':');
            if key == "route" { write_points(route, &mut output); }
            else { write_vias(&route.vias, &mut output); }
        }
        output.push('}');
    }
    output.push(']');
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::rc::Rc;
    use serde_json::json;
    use math_utils::js_number_to_string;
    use json_bindings::js_json::js_json;

    fn previous_writer(value: &Value, output: &mut String) {
        match value {
            Value::Number(number) => output.push_str(&js_number_to_string(number.as_f64().unwrap())),
            Value::Array(values) => {
                output.push('[');
                for (index, value) in values.iter().enumerate() {
                    if index != 0 { output.push(','); }
                    previous_writer(value, output);
                }
                output.push(']');
            }
            Value::Object(values) => {
                output.push('{');
                for (index, (key, value)) in values.iter().enumerate() {
                    if index != 0 { output.push(','); }
                    output.push_str(&serde_json::to_string(key).unwrap());
                    output.push(':');
                    previous_writer(value, output);
                }
                output.push('}');
            }
            _ => output.push_str(&serde_json::to_string(value).unwrap()),
        }
    }

    #[test]
    fn appended_json_matches_previous_bytes_for_metadata_and_numeric_overlays() {
        let escaped = (0_u8..=127).map(char::from).collect::<String>() + "é漢字😀\u{2028}\u{2029}";
        let mut strings = vec![String::new(), escaped.clone(), "plain/ASCII".to_owned()];
        strings.extend(escaped.chars().map(|character| character.to_string()));
        for value in strings {
            let mut encoded = String::new();
            write_json_string(&value, &mut encoded);
            assert_eq!(encoded, serde_json::to_string(&value).unwrap());
        }
        let numbers = [0.0, -0.0, 1e-7, 1e-6, 1e20, 1e21, f64::MIN_POSITIVE,
            f64::from_bits(1), f64::MAX, -f64::MAX, 9007199254740992.0,
            f64::NAN, f64::INFINITY, f64::NEG_INFINITY];
        for number in numbers {
            let mut encoded = String::new();
            write_json_number(number, &mut encoded);
            let expected = if number.is_finite() { js_number_to_string(number) } else { "null".to_owned() };
            assert_eq!(encoded, expected);
            for omit_overlay_keys in [false, true] {
                let mut metadata = serde_json::Map::new();
                metadata.insert(escaped.clone(), json!([escaped, true, false, null, {"nested": [number]}]));
                metadata.insert("y".to_owned(), json!(2));
                metadata.insert("x".to_owned(), json!(1));
                metadata.insert("z".to_owned(), json!(0));
                let mut route = MutableRoute::from_owned_value(json!({
                    "vias": [{"x": 1, "y": 2, "name": escaped}],
                    "connectionName": escaped,
                    "route": [Value::Object(metadata)],
                    "extra": {"quote\"\\\n": [null, true, number]}
                }));
                {
                    let mut point = route.route[0].borrow_mut();
                    point.x = number;
                    point.y = -number;
                    point.z = -0.0;
                    if omit_overlay_keys {
                        let object = Rc::make_mut(&mut point.metadata).as_object_mut().unwrap();
                        object.remove("x"); object.remove("y"); object.remove("z");
                    }
                }
                if omit_overlay_keys {
                    let object = Rc::make_mut(&mut route.metadata).as_object_mut().unwrap();
                    object.remove("route"); object.remove("vias");
                }
                let value = Value::Array(vec![route.to_value()]);
                let mut expected = String::new();
                previous_writer(&value, &mut expected);
                assert_eq!(js_json(&value), expected);
                assert_eq!(js_json_routes(&[route]), expected);
            }
        }
    }
}
