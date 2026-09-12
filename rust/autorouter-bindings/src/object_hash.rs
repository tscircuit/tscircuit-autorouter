// Canonical writer for ordered plain objects and arrays, respectType: false.
// Cache key construction creates fresh containers, so there are no shared references.
use sha1::{Digest, Sha1};

#[derive(Clone, Debug)]
pub enum HashValue {
    Undefined,
    Null,
    Bool(bool),
    Number(f64),
    String(Vec<u16>),
    Array(Vec<HashValue>),
    Object(Vec<(Vec<u16>, HashValue)>),
    StaticAsciiObject(Vec<(&'static str, HashValue)>),
}

pub fn number_string(value: f64) -> String {
    let mut buffer = ryu_js::Buffer::new();
    buffer.format(value).to_owned()
}

pub fn hash(value: &HashValue) -> String {
    let mut stream = Vec::new();
    write_value(value, &mut stream);
    let digest = Sha1::digest(&stream);
    let mut result = String::with_capacity(40);
    for byte in digest {
        use std::fmt::Write;
        write!(&mut result, "{byte:02x}").expect("writing cache key digest");
    }
    result
}

fn write_length(prefix: &[u8], mut length: usize, stream: &mut Vec<u8>) {
    stream.extend_from_slice(prefix);
    let mut digits = [0_u8; 20];
    let mut start = digits.len();
    loop {
        start -= 1;
        digits[start] = b'0' + (length % 10) as u8;
        length /= 10;
        if length == 0 { break; }
    }
    stream.extend_from_slice(&digits[start..]);
    stream.push(b':');
}

fn write_string(value: &[u16], stream: &mut Vec<u8>) {
    write_length(b"string:", value.len(), stream);
    // Each object-hash string update independently replaces unpaired surrogates.
    let mut encoded = [0_u8; 4];
    for scalar in char::decode_utf16(value.iter().copied()) {
        let scalar = scalar.unwrap_or(char::REPLACEMENT_CHARACTER);
        stream.extend_from_slice(scalar.encode_utf8(&mut encoded).as_bytes());
    }
}

fn write_value(value: &HashValue, stream: &mut Vec<u8>) {
    match value {
        HashValue::Undefined => stream.extend_from_slice(b"Undefined"),
        HashValue::Null => stream.extend_from_slice(b"Null"),
        HashValue::Bool(value) => {
            stream.extend_from_slice(if *value { b"bool:true" } else { b"bool:false" });
        }
        HashValue::Number(value) => {
            stream.extend_from_slice(b"number:");
            let mut buffer = ryu_js::Buffer::new();
            stream.extend_from_slice(buffer.format(*value).as_bytes());
        }
        HashValue::String(value) => write_string(value, stream),
        HashValue::Array(values) => {
            write_length(b"array:", values.len(), stream);
            for value in values {
                write_value(value, stream);
            }
        }
        HashValue::StaticAsciiObject(values) => {
            write_length(b"object:", values.len(), stream);
            for (key, value) in values {
                debug_assert!(key.is_ascii());
                write_length(b"string:", key.len(), stream);
                stream.extend_from_slice(key.as_bytes());
                stream.push(b':');
                write_value(value, stream);
                stream.push(b',');
            }
        }
        HashValue::Object(values) => {
            write_length(b"object:", values.len(), stream);
            for (key, value) in values {
                write_string(key, stream);
                stream.push(b':');
                write_value(value, stream);
                stream.push(b',');
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn original_write(value: &HashValue, stream: &mut Vec<u8>) {
        match value {
            HashValue::Undefined => stream.extend_from_slice(b"Undefined"),
            HashValue::Null => stream.extend_from_slice(b"Null"),
            HashValue::Bool(value) => stream.extend_from_slice(if *value { b"bool:true" } else { b"bool:false" }),
            HashValue::Number(value) => stream.extend_from_slice(format!("number:{}", number_string(*value)).as_bytes()),
            HashValue::String(value) => {
                stream.extend_from_slice(format!("string:{}:", value.len()).as_bytes());
                stream.extend_from_slice(String::from_utf16_lossy(value).as_bytes());
            }
            HashValue::Array(values) => {
                stream.extend_from_slice(format!("array:{}:", values.len()).as_bytes());
                for value in values { original_write(value, stream); }
            }
            HashValue::Object(values) => {
                stream.extend_from_slice(format!("object:{}:", values.len()).as_bytes());
                for (key, value) in values {
                    original_write(&HashValue::String(key.clone()), stream);
                    stream.push(b':'); original_write(value, stream); stream.push(b',');
                }
            }
            HashValue::StaticAsciiObject(values) => {
                let object = HashValue::Object(values.iter().map(|(key, value)| (key.encode_utf16().collect(), value.clone())).collect());
                original_write(&object, stream);
            }
        }
    }

    #[test]
    fn canonical_writer_keeps_original_bytes() {
        let values = HashValue::StaticAsciiObject(vec![
            ("numbers", HashValue::Array([0.0, -0.0, f64::NAN, f64::INFINITY, f64::NEG_INFINITY, 1e-7, 1e21, f64::MAX].into_iter().map(HashValue::Number).collect())),
            ("strings", HashValue::Array(vec![
                HashValue::String(vec![]), HashValue::String(vec![0, 0x61, 0xffff]),
                HashValue::String(vec![0xd800, 0xd800, 0xdc00, 0xdc00]),
                HashValue::String(vec![0xd800; 150_000]),
            ])),
            ("others", HashValue::Array(vec![HashValue::Undefined, HashValue::Null, HashValue::Bool(true), HashValue::Bool(false)])),
        ]);
        let mut expected = Vec::new();
        original_write(&values, &mut expected);
        let mut actual = Vec::new();
        write_value(&values, &mut actual);
        assert_eq!(actual, expected);
    }
}
