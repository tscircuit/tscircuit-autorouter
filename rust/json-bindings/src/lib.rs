pub mod js_json;
use serde::{Deserialize, Serialize, de::{self, DeserializeOwned, DeserializeSeed, IntoDeserializer, MapAccess, SeqAccess, Visitor}};
use serde_json::Value;
use std::marker::PhantomData;
use tsify::Tsify;

#[derive(Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct SpecialNumber {
    pub path: Vec<String>,
    pub value: String,
}

#[derive(Deserialize, Tsify)]
#[tsify(type_params = "T")]
pub struct JsonInput<T> {
    #[tsify(type = "ReadonlyInput<T>")]
    value: Value,
    numbers: Vec<SpecialNumber>,
    #[serde(skip)]
    marker: PhantomData<T>,
}

#[derive(Serialize, Tsify)]
pub struct JsonOutput<T> {
    pub value: T,
    pub numbers: Vec<SpecialNumber>,
}

impl<T: DeserializeOwned> JsonInput<T> {
    pub fn deserialize(self) -> Result<T, serde_json::Error> {
        if self.numbers.is_empty() {
            return serde_json::from_value(self.value);
        }
        T::deserialize(NumberDeserializer { value: self.value, path: Vec::new(), numbers: &self.numbers })
    }
}

// JSON has no representation for nonfinite numbers or negative zero on input.
// Paths distinguish those values from arbitrary metadata with the same strings.
struct NumberDeserializer<'a> {
    value: Value,
    path: Vec<String>,
    numbers: &'a [SpecialNumber],
}

macro_rules! deserialize_js_integer {
    ($($method:ident),*) => {$(
        fn $method<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, Self::Error> {
            if self.numbers.iter().any(|number| number.path == self.path && number.value.starts_with("BigInt:")) {
                return Err(de::Error::custom("Expected a JavaScript number, received BigInt"));
            }
            self.deserialize_any(visitor)
        }
    )*};
}

impl<'de> de::Deserializer<'de> for NumberDeserializer<'_> {
    type Error = serde_json::Error;

    fn deserialize_any<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, Self::Error> {
        if let Some(number) = self.numbers.iter().find(|number| number.path == self.path) {
            let value = match number.value.as_str() {
                "NaN" => f64::NAN,
                "Infinity" => f64::INFINITY,
                "-Infinity" => f64::NEG_INFINITY,
                "-0" => return visitor.visit_i64(0),
                value if value.starts_with("BigInt:") => {
                    let text = &value[7..];
                    if let Ok(value) = text.parse::<i64>() {
                        return visitor.visit_i64(value);
                    }
                    let value = text.parse::<u64>().map_err(|_| de::Error::custom("BigInt is outside i64::MIN..u64::MAX bounds"))?;
                    return visitor.visit_u64(value);
                }
                value if value.starts_with("Number:") => value[7..].parse::<f64>().map_err(de::Error::custom)?,
                _ => return Err(de::Error::custom("Invalid special number")),
            };
            return visitor.visit_f64(value);
        }
        match self.value {
            Value::Array(values) => visitor.visit_seq(NumberSequence { values: values.into_iter(), index: 0, path: self.path, numbers: self.numbers }),
            Value::Object(values) => visitor.visit_map(NumberMap { values: values.into_iter(), pending: None, path: self.path, numbers: self.numbers }),
            value => value.into_deserializer().deserialize_any(visitor),
        }
    }

    fn deserialize_f64<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, Self::Error> {
        if self.numbers.iter().any(|number| number.path == self.path && number.value.starts_with("BigInt:")) {
            return Err(de::Error::custom("Expected a JavaScript number, received BigInt"));
        }
        if self.numbers.iter().any(|number| number.path == self.path && number.value == "-0") {
            return visitor.visit_f64(-0.0);
        }
        self.deserialize_any(visitor)
    }

    fn deserialize_f32<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, Self::Error> {
        self.deserialize_f64(visitor)
    }

    fn deserialize_option<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, Self::Error> {
        if self.value.is_null() && !self.numbers.iter().any(|number| number.path == self.path) {
            visitor.visit_none()
        } else {
            visitor.visit_some(self)
        }
    }

    fn deserialize_newtype_struct<V: Visitor<'de>>(self, _name: &'static str, visitor: V) -> Result<V::Value, Self::Error> {
        visitor.visit_newtype_struct(self)
    }

    fn deserialize_enum<V: Visitor<'de>>(self, name: &'static str, variants: &'static [&'static str], visitor: V) -> Result<V::Value, Self::Error> {
        self.value.into_deserializer().deserialize_enum(name, variants, visitor)
    }

    deserialize_js_integer!(deserialize_i8, deserialize_i16, deserialize_i32, deserialize_u8, deserialize_u16, deserialize_u32);

    serde::forward_to_deserialize_any! {
        bool i64 u64 char str string bytes byte_buf unit
        unit_struct seq tuple tuple_struct map struct identifier ignored_any
    }
}

struct NumberSequence<'a> {
    values: std::vec::IntoIter<Value>,
    index: usize,
    path: Vec<String>,
    numbers: &'a [SpecialNumber],
}

impl<'de> SeqAccess<'de> for NumberSequence<'_> {
    type Error = serde_json::Error;

    fn next_element_seed<T: DeserializeSeed<'de>>(&mut self, seed: T) -> Result<Option<T::Value>, Self::Error> {
        let Some(value) = self.values.next() else { return Ok(None); };
        let mut path = self.path.clone();
        path.push(self.index.to_string());
        self.index += 1;
        seed.deserialize(NumberDeserializer { value, path, numbers: self.numbers }).map(Some)
    }
}

struct NumberMap<'a> {
    values: serde_json::map::IntoIter,
    pending: Option<(String, Value)>,
    path: Vec<String>,
    numbers: &'a [SpecialNumber],
}

impl<'de> MapAccess<'de> for NumberMap<'_> {
    type Error = serde_json::Error;

    fn next_key_seed<K: DeserializeSeed<'de>>(&mut self, seed: K) -> Result<Option<K::Value>, Self::Error> {
        let Some((key, value)) = self.values.next() else { return Ok(None); };
        self.pending = Some((key.clone(), value));
        seed.deserialize(key.into_deserializer()).map(Some)
    }

    fn next_value_seed<V: DeserializeSeed<'de>>(&mut self, seed: V) -> Result<V::Value, Self::Error> {
        let (key, value) = self.pending.take().ok_or_else(|| de::Error::custom("Missing JSON object key"))?;
        let mut path = self.path.clone();
        path.push(key);
        seed.deserialize(NumberDeserializer { value, path, numbers: self.numbers })
    }
}


#[wasm_bindgen::prelude::wasm_bindgen(typescript_custom_section)]
const INPUT_TYPES: &str = r#"
export type ReadonlyInput<T> = T extends null ? null | undefined : T extends Int8Array | Int32Array | Float64Array ? T : T extends number[] ? readonly number[] | Int32Array | Int8Array | Float64Array : T extends readonly (infer U)[] ? readonly ReadonlyInput<U>[] : T extends object ? { readonly [K in keyof T]: ReadonlyInput<T[K]> } : T;
"#;

pub fn serialize_js_value<S: serde::Serializer>(value: &Value, serializer: S) -> Result<S::Ok, S::Error> {
    JsonValue(value).serialize(serializer)
}

pub fn serialize_optional_js_value<S: serde::Serializer>(value: &Option<Value>, serializer: S) -> Result<S::Ok, S::Error> {
    match value {
        Some(value) => serializer.serialize_some(&JsonValue(value)),
        None => serializer.serialize_none(),
    }
}

pub fn serialize_optional_js_values<S: serde::Serializer>(values: &Option<Vec<Value>>, serializer: S) -> Result<S::Ok, S::Error> {
    use serde::ser::SerializeSeq;
    let Some(values) = values else { return serializer.serialize_none(); };
    let mut sequence = serializer.serialize_seq(Some(values.len()))?;
    for value in values {
        sequence.serialize_element(&JsonValue(value))?;
    }
    sequence.end()
}

// Match serde-wasm's integer range checks during the existing serialization
// traversal, so unsafe BigInt metadata fails when it is returned to JavaScript.
struct JsonValue<'a>(&'a Value);

impl Serialize for JsonValue<'_> {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::{SerializeMap, SerializeSeq};
        match self.0 {
            Value::Number(number) => {
                let unsafe_integer = number.as_i64().is_some_and(|number| !(-9_007_199_254_740_991..=9_007_199_254_740_991).contains(&number))
                    || number.as_u64().is_some_and(|number| number > 9_007_199_254_740_991);
                if unsafe_integer {
                    return Err(serde::ser::Error::custom(format!("{number} can't be represented as a JavaScript number")));
                }
                number.serialize(serializer)
            }
            Value::Array(values) => {
                let mut sequence = serializer.serialize_seq(Some(values.len()))?;
                for value in values {
                    sequence.serialize_element(&JsonValue(value))?;
                }
                sequence.end()
            }
            Value::Object(values) => {
                let mut map = serializer.serialize_map(Some(values.len()))?;
                for (key, value) in values {
                    map.serialize_entry(key, &JsonValue(value))?;
                }
                map.end()
            }
            value => value.serialize(serializer),
        }
    }
}
