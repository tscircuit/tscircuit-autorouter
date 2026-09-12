use crate::object_hash::{self, HashValue as H};
use serde_json::Value;
use std::{cmp::Ordering, collections::HashMap};
use wasm_bindgen::prelude::*;

fn scalar(value: &Value) -> Result<H, String> {
    match value {
        Value::Null => Ok(H::Null),
        Value::Bool(v) => Ok(H::Bool(*v)),
        Value::Number(v) => Ok(H::Number(v.as_f64().ok_or("Invalid cache number")?)),
        Value::String(v) => Ok(H::String(v.encode_utf16().collect())),
        Value::Object(v) if v.len() == 1 && v.contains_key("cacheScalar") => {
            match &v["cacheScalar"] {
                Value::String(tag) => match tag.as_str() {
                    "undefined" => Ok(H::Undefined),
                    "NaN" => Ok(H::Number(f64::NAN)),
                    "Infinity" => Ok(H::Number(f64::INFINITY)),
                    "-Infinity" => Ok(H::Number(f64::NEG_INFINITY)),
                    _ => Err("Invalid cache scalar tag".into()),
                },
                Value::Array(units) => Ok(H::String(
                    units.iter().map(|v| {
                        v.as_u64()
                            .filter(|n| *n <= 65535)
                            .map(|n| n as u16)
                            .ok_or("Invalid UTF16 cache string".to_owned())
                    }).collect::<Result<_, _>>()?,
                )),
                _ => Err("Invalid cache scalar".into()),
            }
        }
        _ => Err("Cache key fields must be scalar values".into()),
    }
}

fn field(value: &Value, name: &str) -> Result<H, String> {
    value.get(name).map(scalar).unwrap_or(Ok(H::Undefined))
}

fn number(value: &Value, name: &str) -> Result<f64, String> {
    match field(value, name)? {
        H::Number(v) => Ok(v),
        H::Undefined => Ok(f64::NAN),
        H::Null => Ok(0.0),
        _ => Err(format!("Cache {name} must be numeric")),
    }
}

fn rounded(value: f64) -> H {
    H::Number(crate::solvers::high_density_solver::geometry::js_round(value * 200.0) / 200.0)
}

fn array<'a>(value: &'a Value, name: &str) -> Result<&'a Vec<Value>, String> {
    value.get(name)
        .and_then(Value::as_array)
        .ok_or_else(|| format!("Cache {name} must be an array"))
}

fn obj(fields: Vec<(&'static str, H)>) -> H {
    H::StaticAsciiObject(fields)
}

fn nullish(value: H, default: H) -> H {
    if matches!(value, H::Undefined | H::Null) {
        default
    } else {
        value
    }
}

fn text(value: H) -> Result<Vec<u16>, String> {
    match value {
        H::String(v) => Ok(v),
        _ => Err("Cache ID must be a string".into()),
    }
}

struct LocaleStrings {
    values: HashMap<Vec<u16>, js_sys::JsString>,
}

impl LocaleStrings {
    fn get(&mut self, value: &[u16]) -> js_sys::JsString {
        if let Some(text) = self.values.get(value) {
            return text.clone();
        }
        // UTF8 bindings avoid spreading an entire Uint16Array on every comparison.
        // Only unpaired surrogates require the lossless UTF16 constructor.
        let text = match String::from_utf16(value) {
            Ok(text) => js_sys::JsString::from(text.as_str()),
            Err(_) => {
                let mut text = js_sys::JsString::from("");
                for chunk in value.chunks(4096) {
                    text = text.concat(&js_sys::JsString::from_char_code(chunk));
                }
                text
            },
        };
        self.values.insert(value.to_vec(), text.clone());
        text
    }

    fn compare(&mut self, locale: &js_sys::Function, left: &[u16], right: &[u16]) -> Ordering {
        let a = self.get(left);
        let b = self.get(right);
        let n = locale.call2(&JsValue::UNDEFINED, &a, &b)
            .expect("localeCompare failed")
            .as_f64()
            .expect("localeCompare must return a number");
        n.partial_cmp(&0.0).unwrap_or(Ordering::Equal)
    }
}

fn default_sort_string(value: &H) -> Result<Vec<u16>, String> {
    match value {
        H::String(v) => Ok(v.clone()),
        H::Number(v) => Ok(object_hash::number_string(*v).encode_utf16().collect()),
        H::Null => Ok("null".encode_utf16().collect()),
        H::Undefined => Ok("undefined".encode_utf16().collect()),
        _ => Err("Unsupported default-sort value".into()),
    }
}


pub fn compute(snapshot_json: &str, locale: &js_sys::Function) -> Result<String, String> {
    let snapshot: Value = serde_json::from_str(snapshot_json).map_err(|error| error.to_string())?;
    let mut locale_strings = LocaleStrings { values: HashMap::new() };
    let node = &snapshot["node"];
    let center = &snapshot["normalizationCenter"];
    let cx = number(center, "x")?;
    let cy = number(center, "y")?;
    let connections = array(&snapshot, "initialUnsolvedConnections")?;

    let mut normalized_connections = Vec::new();
    for connection in connections {
        let name = field(connection, "connectionName")?;
        let mut points = Vec::new();
        for point in array(connection, "points")? {
            points.push(obj(vec![
                ("connectionName", name.clone()),
                ("x", rounded(number(point, "x")? - cx)),
                ("y", rounded(number(point, "y")? - cy)),
                ("z", nullish(field(point, "z")?, H::Number(0.0))),
            ]));
        }
        normalized_connections.push(obj(vec![
            ("connectionName", name),
            ("rootConnectionName", field(connection, "rootConnectionName")?),
            ("points", H::Array(points)),
        ]));
    }

    let mut ports = array(&snapshot, "portPoints")?.iter().map(|port| {
        Ok((
            port,
            text(field(port, "connectionName")?)?,
            text(nullish(field(port, "portPointId")?, H::String(vec![])))?,
            number(port, "x")?,
            number(port, "y")?,
            match nullish(field(port, "z")?, H::Number(0.0)) {
                H::Number(v) => v,
                _ => return Err("Cache layer must be numeric".into()),
            },
        ))
    }).collect::<Result<Vec<_>, String>>()?;

    ports.sort_by(|a, b| {
        if a.1 != b.1 {
            return locale_strings.compare(locale, &a.1, &b.1);
        }
        if a.2 != b.2 {
            return locale_strings.compare(locale, &a.2, &b.2);
        }
        if a.3 != b.3 {
            return (a.3 - b.3).partial_cmp(&0.0).unwrap_or(Ordering::Equal);
        }
        if a.4 != b.4 {
            return (a.4 - b.4).partial_cmp(&0.0).unwrap_or(Ordering::Equal);
        }
        (a.5 - b.5).partial_cmp(&0.0).unwrap_or(Ordering::Equal)
    });

    let normalized_ports = ports.iter().map(|(port, _, _, _, _, _)| {
        Ok(obj(vec![
            ("connectionName", field(port, "connectionName")?),
            ("rootConnectionName", field(port, "rootConnectionName")?),
            ("portPointId", field(port, "portPointId")?),
            ("prevPortPointId", field(port, "prevPortPointId")?),
            ("nextPortPointId", field(port, "nextPortPointId")?),
            ("x", rounded(number(port, "x")? - cx)),
            ("y", rounded(number(port, "y")? - cy)),
            ("z", nullish(field(port, "z")?, H::Number(0.0))),
        ]))
    }).collect::<Result<Vec<_>, String>>()?;

    let mut hyper = Vec::new();
    for pair in array(&snapshot, "hyperParameters")? {
        let key = scalar(&pair[0])?;
        let value = scalar(&pair[1])?;
        if !matches!(value, H::Undefined) {
            hyper.push((text(key)?, value));
        }
    }
    hyper.sort_by(|a, b| locale_strings.compare(locale, &a.0, &b.0));

    // Object.fromEntries enumerates integer index keys first, regardless of insertion order.
    let index = |key: &[u16]| -> Option<u32> {
        let text = String::from_utf16(key).ok()?;
        let n: u32 = text.parse().ok()?;
        if n != u32::MAX && n.to_string() == text {
            Some(n)
        } else {
            None
        }
    };
    hyper.sort_by(|a, b| match (index(&a.0), index(&b.0)) {
        (Some(a), Some(b)) => a.cmp(&b),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        _ => Ordering::Equal,
    });
    let hyper = H::Object(hyper);

    let conn_map = if let Some(ids) = snapshot.get("connectedIds").and_then(Value::as_array) {
        let mut normalized = Vec::new();
        for group in ids {
            let mut unique = Vec::<Vec<u16>>::new();
            for id in array(group, "ids")? {
                let id = text(scalar(id)?)?;
                if !unique.contains(&id) {
                    unique.push(id);
                }
            }
            unique.sort();
            normalized.push(obj(vec![
                ("connectionName", field(group, "connectionName")?),
                ("connectedIds", H::Array(unique.into_iter().map(H::String).collect())),
            ]));
        }
        H::Array(normalized)
    } else {
        H::Undefined
    };

    let available_z = match node.get("availableZ") {
        Some(Value::Array(values)) => {
            let mut values = values.iter().map(|v| {
                let h = scalar(v)?;
                Ok((default_sort_string(&h)?, h))
            }).collect::<Result<Vec<_>, String>>()?;
            values.sort_by(|a, b| a.0.cmp(&b.0));
            H::Array(values.into_iter().map(|(_, v)| v).collect())
        }
        _ => H::Undefined,
    };

    let key_data = obj(vec![
        ("cacheSchemaVersion", H::Number(4.0)),
        ("node", obj(vec![
            ("width", rounded(number(node, "width")?)),
            ("height", rounded(number(node, "height")?)),
            ("center", obj(vec![
                ("x", rounded(number(&node["center"], "x")?)),
                ("y", rounded(number(&node["center"], "y")?)),
            ])),
            ("availableZ", available_z),
            ("portPoints", H::Array(normalized_ports)),
        ])),
        ("normalizedConnections", H::Array(normalized_connections)),
        ("normalizedHyperParameters", hyper),
        ("minDistBetweenEnteringPoints", rounded(number(&snapshot, "minDistBetweenEnteringPoints")?)),
        ("traceWidth", rounded(number(&snapshot, "traceWidth")?)),
        ("viaDiameter", rounded(number(&snapshot, "viaDiameter")?)),
        ("obstacleMargin", rounded(number(&snapshot, "obstacleMargin")?)),
        ("normalizedConnMap", conn_map),
    ]);

    Ok(format!("intranode-solver:{}", object_hash::hash(&key_data)))
}
