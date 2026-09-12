use indexmap::IndexMap;
use std::cell::Cell;

thread_local! { static NEXT_DIAGNOSTIC_ID: Cell<u64> = const { Cell::new(1) }; }
pub fn next_diagnostic_id() -> u64 {
    NEXT_DIAGNOSTIC_ID.with(|next| {
        let value = next.get();
        next.set(value + 1);
        value
    })
}

use serde::ser::SerializeMap;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{Map, Value};

#[derive(Clone, Debug)]
pub struct MHPoint {
    pub diagnostic_id: u64,
    pub x: f64,
    pub y: f64,
    pub z1: f64,
    pub z2: f64,
    pub metadata: Map<String, Value>,
}

impl Serialize for MHPoint {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut fields = self.metadata.clone();
        fields.insert("x".into(), Value::from(self.x));
        fields.insert("y".into(), Value::from(self.y));
        fields.insert("z1".into(), Value::from(self.z1));
        fields.insert("z2".into(), Value::from(self.z2));
        fields.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for MHPoint {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let metadata = Map::<String, Value>::deserialize(deserializer)?;
        let number = |name: &str| {
            metadata
                .get(name)
                .and_then(Value::as_f64)
                .ok_or_else(|| serde::de::Error::custom(format!("Missing numeric MHPoint.{name}")))
        };
        Ok(Self {
            diagnostic_id: next_diagnostic_id(),
            x: number("x")?,
            y: number("y")?,
            z1: number("z1")?,
            z2: number("z2")?,
            metadata,
        })
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolyLine {
    #[serde(skip, default = "next_diagnostic_id")]
    pub diagnostic_id: u64,
    #[serde(skip, default = "next_diagnostic_id")]
    pub m_points_id: u64,
    pub connection_name: String,
    pub start: MHPoint,
    pub end: MHPoint,
    pub m_points: Vec<MHPoint>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Force {
    pub fx: f64,
    pub fy: f64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    #[serde(skip, default = "next_diagnostic_id")]
    pub diagnostic_id: u64,
    #[serde(skip, default = "next_diagnostic_id")]
    pub poly_lines_id: u64,
    #[serde(skip, default = "next_diagnostic_id")]
    pub min_gaps_id: u64,
    pub poly_lines: Vec<PolyLine>,
    pub g: f64,
    pub h: f64,
    pub f: f64,
    pub min_gaps: Vec<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub forces: Option<Vec<Vec<IndexMap<String, Force>>>>,
    pub via_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mag_force_applied: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_closed_same_layer_face: Option<bool>,
}

impl Serialize for Candidate {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(None)?;
        map.serialize_entry("polyLines", &self.poly_lines)?;
        map.serialize_entry("g", &self.g)?;
        map.serialize_entry("h", &self.h)?;
        map.serialize_entry("f", &self.f)?;
        if self.forces.is_none() {
            map.serialize_entry("viaCount", &self.via_count)?;
        }
        map.serialize_entry("minGaps", &self.min_gaps)?;
        if let Some(forces) = &self.forces {
            map.serialize_entry("forces", forces)?;
            map.serialize_entry("viaCount", &self.via_count)?;
        }
        if let Some(value) = self.mag_force_applied {
            map.serialize_entry("magForceApplied", &value)?;
        }
        if let Some(value) = self.has_closed_same_layer_face {
            map.serialize_entry("hasClosedSameLayerFace", &value)?;
        }
        map.end()
    }
}

pub fn candidate_identity(candidate: &Candidate) -> Value {
    let lines: Vec<Value> = candidate.poly_lines.iter().map(|line| {
        serde_json::json!({"id":line.diagnostic_id,"fields":{
            "start":{"id":line.start.diagnostic_id},"end":{"id":line.end.diagnostic_id},
            "mPoints":{"id":line.m_points_id,"items":line.m_points.iter().map(|point|serde_json::json!({"id":point.diagnostic_id})).collect::<Vec<_>>()}
        }})
    }).collect();
    serde_json::json!({"id":candidate.diagnostic_id,"fields":{
        "polyLines":{"id":candidate.poly_lines_id,"items":lines},
        "minGaps":{"id":candidate.min_gaps_id}
    }})
}

fn identity_id(value: &Value) -> Result<u64, String> {
    value["id"]
        .as_u64()
        .filter(|id| *id > 0)
        .ok_or_else(|| "Candidate diagnostic identity requires a positive integer ID".into())
}

pub fn restore_candidate_identity(
    candidate: &mut Candidate,
    identity: &Value,
) -> Result<(), String> {
    candidate.diagnostic_id = identity_id(identity)?;
    let fields = &identity["fields"];
    candidate.poly_lines_id = identity_id(&fields["polyLines"])?;
    candidate.min_gaps_id = identity_id(&fields["minGaps"])?;
    let lines = fields["polyLines"]["items"]
        .as_array()
        .ok_or("Candidate identity requires polyline identities")?;
    if lines.len() != candidate.poly_lines.len() {
        return Err("Candidate polyline identity count mismatch".into());
    }
    for (line, identity) in candidate.poly_lines.iter_mut().zip(lines) {
        line.diagnostic_id = identity_id(identity)?;
        let fields = &identity["fields"];
        line.start.diagnostic_id = identity_id(&fields["start"])?;
        line.end.diagnostic_id = identity_id(&fields["end"])?;
        line.m_points_id = identity_id(&fields["mPoints"])?;
        let points = fields["mPoints"]["items"]
            .as_array()
            .ok_or("Polyline identity requires middle-point identities")?;
        if points.len() != line.m_points.len() {
            return Err("Middle-point identity count mismatch".into());
        }
        for (point, identity) in line.m_points.iter_mut().zip(points) {
            point.diagnostic_id = identity_id(identity)?;
        }
    }
    Ok(())
}

pub fn multi_head_mut(
    engine: &mut crate::bindings::high_density::specialized_solver::SpecializedEngine,
) -> Option<&mut super::multi_head_poly_line_intra_node_solver::MultiHeadPolyLineIntraNodeSolver> {
    use crate::bindings::high_density::specialized_solver::SpecializedEngine;
    match engine {
        SpecializedEngine::MultiHead(solver) => Some(solver),
        SpecializedEngine::MultiHead2(solver) => Some(&mut solver.inner),
        SpecializedEngine::MultiHead3(solver) => Some(&mut solver.inner.inner),
        _ => None,
    }
}

pub fn snapshot_identity(
    engine: &mut crate::bindings::high_density::specialized_solver::SpecializedEngine,
) -> Value {
    let Some(solver) = multi_head_mut(engine) else {
        return Value::Null;
    };
    serde_json::json!({"fields":{
        "candidates":{"items":solver.candidates.iter().map(candidate_identity).collect::<Vec<_>>()},
        "lastCandidate":solver.last_candidate.as_ref().map(candidate_identity)
    }})
}

pub fn restore_snapshot_identity(
    engine: &mut crate::bindings::high_density::specialized_solver::SpecializedEngine,
    identity: &Value,
) -> Result<(), String> {
    let solver = multi_head_mut(engine).ok_or("Candidate identities require a MultiHead solver")?;
    let candidates = identity["fields"]["candidates"]["items"]
        .as_array()
        .ok_or("Missing queued candidate identities")?;
    if candidates.len() != solver.candidates.len() {
        return Err("Queued candidate identity count mismatch".into());
    }
    for (candidate, identity) in solver.candidates.iter_mut().zip(candidates) {
        restore_candidate_identity(candidate, identity)?;
    }
    if let Some(candidate) = &mut solver.last_candidate {
        restore_candidate_identity(candidate, &identity["fields"]["lastCandidate"])?;
    }
    let mut queued_ids = std::collections::HashSet::new();
    solver.has_candidate_aliases = solver
        .candidates
        .iter()
        .any(|candidate| !queued_ids.insert(candidate.diagnostic_id));
    Ok(())
}
