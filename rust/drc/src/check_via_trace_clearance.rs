use indexmap::{IndexMap, IndexSet};
use rustc_hash::FxBuildHasher;
use serde::{Deserialize, Serialize};

use crate::math_utils::{Circle, Point, segment_to_circle_min_distance};

const EPSILON: f64 = 5e-3;

#[derive(Deserialize)]
pub struct CheckViaTraceClearanceInput {
    pub vias: Vec<Via>,
    pub segments: Vec<TraceSegment>,
    #[serde(rename = "minClearance")]
    pub min_clearance: f64,
}

#[derive(Deserialize)]
pub struct Via {
    pub pcb_via_id: String,
    pub x: f64,
    pub y: f64,
    pub outer_diameter: f64,
    pub layers: Vec<String>,
    #[serde(rename = "netId")]
    pub net_id: Option<String>,
}

#[derive(Deserialize)]
pub struct TraceSegment {
    pub pcb_trace_id: String,
    pub thickness: f64,
    pub layer: String,
    pub x1: f64,
    pub y1: f64,
    pub x2: f64,
    pub y2: f64,
    #[serde(rename = "netId")]
    pub net_id: Option<String>,
    pub center: Point,
}

#[derive(Serialize)]
pub struct ViaTraceClearanceViolation {
    pub pcb_via_id: String,
    pub pcb_trace_id: String,
    pub minimum_clearance: f64,
    pub actual_clearance: f64,
    pub center: Point,
}

pub fn check_via_trace_clearance(
    input: &CheckViaTraceClearanceInput,
) -> Vec<ViaTraceClearanceViolation> {
    let vias = &input.vias;
    let segments = &input.segments;
    if vias.is_empty() || segments.is_empty() {
        return Vec::new();
    }
    let min_clearance = input.min_clearance;
    let mut errors: IndexMap<String, ViaTraceClearanceViolation, FxBuildHasher> =
        IndexMap::with_hasher(FxBuildHasher);
    let mut overlapping_pair_ids: IndexSet<String, FxBuildHasher> =
        IndexSet::with_hasher(FxBuildHasher);

    for via in vias {
        for segment in segments {
            if !via.layers.contains(&segment.layer) {
                continue;
            }
            if are_ids_connected(segment, via) {
                continue;
            }
            let start = Point { x: segment.x1, y: segment.y1 };
            let end = Point { x: segment.x2, y: segment.y2 };
            let trace_radius = segment.thickness / 2.0;
            let circle = Circle {
                x: via.x,
                y: via.y,
                radius: via.outer_diameter / 2.0,
            };
            let gap = segment_to_circle_min_distance(&start, &end, &circle) - trace_radius;
            // Distant pairs cannot change either result collection. Delay their
            // string key allocation while keeping overlap and error ordering.
            if gap > 0.0 && gap + EPSILON >= min_clearance {
                continue;
            }
            let pair_id = format!("{}_{}", via.pcb_via_id, segment.pcb_trace_id);
            if gap <= 0.0 {
                errors.shift_remove(&pair_id);
                overlapping_pair_ids.insert(pair_id);
                continue;
            }
            if overlapping_pair_ids.contains(&pair_id) {
                continue;
            }
            if gap + EPSILON >= min_clearance {
                continue;
            }

            let current = errors.get(&pair_id);
            if current.is_none_or(|current| gap < current.actual_clearance) {
                let next_error = ViaTraceClearanceViolation {
                    pcb_via_id: via.pcb_via_id.clone(),
                    pcb_trace_id: segment.pcb_trace_id.clone(),
                    minimum_clearance: min_clearance,
                    actual_clearance: gap,
                    center: segment.center,
                };
                errors.insert(pair_id, next_error);
            }
        }
    }
    errors.into_values().collect()
}

fn are_ids_connected(segment: &TraceSegment, via: &Via) -> bool {
    if segment.pcb_trace_id == via.pcb_via_id {
        return true;
    }
    let Some(net_id1) = segment.net_id.as_deref().filter(|id| !id.is_empty()) else {
        return false;
    };
    let Some(net_id2) = via.net_id.as_deref().filter(|id| !id.is_empty()) else {
        return false;
    };
    // ConnectivityMap compares the second net with the first ID in both final terms.
    net_id1 == net_id2 || net_id2 == segment.pcb_trace_id
}
