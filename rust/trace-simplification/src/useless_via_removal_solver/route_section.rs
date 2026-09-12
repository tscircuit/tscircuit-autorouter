use crate::types::PointRef;

#[derive(Clone)]
pub struct RouteSection {
    pub identity: u64,
    pub points_array_identity: u64,
    pub start_index: usize,
    pub end_index: isize,
    pub z: f64,
    pub points: Vec<PointRef>,
}

impl RouteSection {
    pub fn snapshot(&self, codec: &mut crate::graph_codec::GraphCodec) -> serde_json::Value {
        let points = codec.point_array(self.points_array_identity, &self.points);
        codec.object(self.identity, serde_json::json!({
            "startIndex": self.start_index, "endIndex": self.end_index, "z": self.z, "points": points,
        }))
    }

    pub fn restore(value: &serde_json::Value, codec: &mut crate::graph_codec::GraphCodec) -> Result<Self, String> {
        let fields = value.get("fields").unwrap_or(value);
        Ok(Self {
            identity: value["$object"].as_u64().unwrap_or_else(crate::types::next_identity),
            points_array_identity: fields["points"]["$array"].as_u64().unwrap_or_else(crate::types::next_identity),
            start_index: fields["startIndex"].as_u64().ok_or("Route section startIndex required")? as usize,
            end_index: fields["endIndex"].as_i64().ok_or("Route section endIndex required")? as isize,
            z: fields["z"].as_f64().ok_or("Route section z required")?,
            points: codec.read_points(&fields["points"] )?,
        })
    }
}
