use serde_json::{Value, json};

#[derive(Clone, Copy, Debug)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Copy)]
pub struct Math {
    pub sin: fn(f64) -> f64,
    pub cos: fn(f64) -> f64,
    pub hypot: fn(f64, f64) -> f64,
}
impl Default for Math {
    fn default() -> Self {
        Self {
            sin: f64::sin,
            cos: f64::cos,
            hypot: f64::hypot,
        }
    }
}

pub fn number(value: Option<&Value>) -> f64 {
    match value {
        Some(Value::Number(n)) => n.as_f64().unwrap(),
        Some(Value::Null) => 0.0,
        Some(Value::Bool(v)) => {
            if *v {
                1.0
            } else {
                0.0
            }
        }
        Some(Value::Object(v)) => match v.get("$traceNumber").and_then(Value::as_str) {
            Some("Infinity") => f64::INFINITY,
            Some("-Infinity") => f64::NEG_INFINITY,
            Some("-0") => -0.0,
            _ => f64::NAN,
        },
        Some(Value::String(v)) => {
            if v.trim().is_empty() {
                0.0
            } else {
                v.parse().unwrap_or(f64::NAN)
            }
        }
        _ => f64::NAN,
    }
}
pub fn point(value: &Value) -> Point {
    Point {
        x: number(value.get("x")),
        y: number(value.get("y")),
    }
}
pub fn encoded_number(value: f64) -> Value {
    if value.is_nan() {
        json!({"$traceNumber":"NaN"})
    } else if value == f64::INFINITY {
        json!({"$traceNumber":"Infinity"})
    } else if value == f64::NEG_INFINITY {
        json!({"$traceNumber":"-Infinity"})
    } else if value == 0.0 && value.is_sign_negative() {
        json!({"$traceNumber":"-0"})
    } else {
        json!(value)
    }
}

// IDs are strings in circuit-json. Separate missing and null keys preserve
// JavaScript equality for optional identifiers at this boundary.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Id {
    Missing,
    Null,
    String(String),
}
impl Id {
    pub fn read(value: Option<&Value>) -> Self {
        match value {
            None => Self::Missing,
            Some(Value::Null) => Self::Null,
            Some(Value::String(v)) => Self::String(v.clone()),
            Some(v) => Self::String(v.to_string()),
        }
    }
    pub fn truthy(&self) -> bool {
        matches!(self, Self::String(s) if !s.is_empty())
    }
}

pub struct RoutePoint {
    pub position: Point,
    pub width: f64,
    pub wire: bool,
    pub via: bool,
    pub start_port: Id,
    pub end_port: Id,
    pub center: Point,
}
impl RoutePoint {
    pub fn read(value: &Value) -> Self {
        let position = point(value);
        let kind = value.get("route_type").and_then(Value::as_str);
        let center = if kind == Some("through_pad") {
            let start = point(&value["start"]);
            let end = point(&value["end"]);
            Point {
                x: (start.x + end.x) / 2.0,
                y: (start.y + end.y) / 2.0,
            }
        } else {
            position
        };
        Self {
            position,
            center,
            width: number(value.get("width")),
            wire: kind == Some("wire"),
            via: kind == Some("via"),
            start_port: Id::read(value.get("start_pcb_port_id")),
            end_port: Id::read(value.get("end_pcb_port_id")),
        }
    }
    pub fn references(&self, id: &Id) -> bool {
        self.wire
            && ((self.start_port.truthy() && &self.start_port == id)
                || (self.end_port.truthy() && &self.end_port == id))
    }
}
pub struct Trace {
    pub index: usize,
    pub id: Id,
    pub source_id: Id,
    pub route: Vec<RoutePoint>,
}
pub struct Port {
    pub index: usize,
    pub id: Id,
    pub source_id: Id,
    pub position: Point,
}
