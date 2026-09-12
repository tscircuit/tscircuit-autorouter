use serde_json::Value;

pub fn js_json(value: &Value) -> String {
    let mut output = String::new();
    write_js_json(value, &mut output);
    output
}

pub fn js_json_slice(values: &[Value]) -> String {
    let mut output = String::new();
    write_js_json_slice(values, &mut output);
    output
}

fn write_js_json_slice(values: &[Value], output: &mut String) {
    output.push('[');
    for (index, value) in values.iter().enumerate() {
        if index != 0 {
            output.push(',');
        }
        write_js_json(value, output);
    }
    output.push(']');
}

pub fn write_json_number(value: f64, output: &mut String) {
    if value.is_finite() {
        output.push_str(ryu_js::Buffer::new().format(value));
    } else {
        output.push_str("null");
    }
}

pub fn write_json_string(value: &str, output: &mut String) {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    output.push('"');
    let mut start = 0;
    for (index, byte) in value.bytes().enumerate() {
        if byte != b'"' && byte != b'\\' && byte >= 0x20 {
            continue;
        }
        // Every escaped byte is ASCII, so both slice boundaries are UTF-8 boundaries.
        output.push_str(&value[start..index]);
        match byte {
            b'"' => output.push_str("\\\""),
            b'\\' => output.push_str("\\\\"),
            b'\x08' => output.push_str("\\b"),
            b'\t' => output.push_str("\\t"),
            b'\n' => output.push_str("\\n"),
            b'\x0c' => output.push_str("\\f"),
            b'\r' => output.push_str("\\r"),
            _ => {
                output.push_str("\\u00");
                output.push(HEX[(byte >> 4) as usize] as char);
                output.push(HEX[(byte & 15) as usize] as char);
            }
        }
        start = index + 1;
    }
    output.push_str(&value[start..]);
    output.push('"');
}

pub fn write_js_json(value: &Value, output: &mut String) {
    match value {
        Value::Number(n) => write_json_number(n.as_f64().expect("JSON number"), output),
        Value::Array(values) => write_js_json_slice(values, output),
        Value::Object(values) => {
            output.push('{');
            for (index, (key, value)) in values.iter().enumerate() {
                if index != 0 {
                    output.push(',');
                }
                write_json_string(key, output);
                output.push(':');
                write_js_json(value, output);
            }
            output.push('}');
        }
        Value::String(value) => write_json_string(value, output),
        Value::Bool(value) => output.push_str(if *value { "true" } else { "false" }),
        Value::Null => output.push_str("null"),
    }
}
