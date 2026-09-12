use serde_json::{json, Value};

pub struct MergedSegment {
    pub points: Vec<Value>,
    pub z: f64,
    pub connection_name: String,
    pub color: Option<Value>,
}

pub fn merge_route_segments(route: &[Value], connection_name: &str, color: Option<&Value>) -> Vec<MergedSegment> {
    let mut segments = Vec::new();
    let mut current: Option<MergedSegment> = None;
    for point in route {
        let z = point["z"].as_f64().expect("Route layer required");
        if current.as_ref().is_some_and(|segment| segment.z != z) {
            segments.push(current.take().unwrap());
        }
        let segment = current.get_or_insert_with(|| MergedSegment {
            points: Vec::new(), z, connection_name: connection_name.to_owned(), color: color.cloned(),
        });
        segment.points.push(json!({"x":point["x"],"y":point["y"]}));
    }
    if let Some(segment) = current { segments.push(segment); }
    segments
}
