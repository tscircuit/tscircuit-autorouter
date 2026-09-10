use super::derive_bus_trace_order::BusTraceOrder;
use crate::core::{Candidate, TinyHyperGraphSolverOptions};
use crate::types::{PortId, RegionId, RegionIntersectionCache, RouteId};

#[derive(Clone, Debug, Default)]
pub struct TinyHyperGraphBusSolverOptions {
    pub core: TinyHyperGraphSolverOptions,
    pub bus_end_margin_steps: Option<usize>,
    pub bus_max_remainder_steps: Option<usize>,
    pub bus_remainder_guide_weight: Option<f64>,
    pub bus_remainder_goal_weight: Option<f64>,
    pub bus_remainder_side_weight: Option<f64>,
    pub center_greedy_heuristic_multiplier: Option<f64>,
    pub center_port_options_per_edge: Option<usize>,
    pub queue_all_candidates: Option<bool>,
    pub visualize_unassigned_ports: Option<bool>,
}
pub type BusCenterCandidate = Candidate;

#[derive(Clone, Debug)]
pub struct BoundaryStep {
    pub from_region_id: RegionId,
    pub to_region_id: RegionId,
    pub center_port_id: PortId,
    pub normal_x: f64,
    pub normal_y: f64,
}

#[derive(Clone, Debug)]
pub struct TraceSegment {
    pub region_id: RegionId,
    pub from_port_id: PortId,
    pub to_port_id: PortId,
}

#[derive(Clone, Debug)]
pub struct TracePreview {
    pub trace_index: usize,
    pub route_id: RouteId,
    pub segments: Vec<TraceSegment>,
    pub complete: bool,
    pub terminal_port_id: PortId,
    pub terminal_region_id: Option<RegionId>,
    pub preview_cost: Option<f64>,
}

#[derive(Clone, Debug)]
pub struct BusPreview {
    pub trace_previews: Vec<TracePreview>,
    pub total_length: f64,
    pub total_cost: f64,
    pub complete_trace_count: usize,
    pub same_layer_intersection_count: i32,
    pub crossing_layer_intersection_count: i32,
    pub reason: Option<String>,
}

#[derive(Clone, Debug)]
pub struct PreviewRoutingStateSnapshot {
    pub port_assignment: Vec<i32>,
    pub region_segments: Vec<Vec<(RouteId, PortId, PortId)>>,
    pub region_intersection_caches: Vec<RegionIntersectionCache>,
}
pub const BUS_CANDIDATE_EPSILON: f64 = 1e-9;

pub fn compare_bus_candidates_by_f(left: &Candidate, right: &Candidate) -> f64 {
    let f = left.f - right.f;
    if f != 0.0 {
        return f;
    }

    let h = left.h - right.h;
    if h != 0.0 {
        return h;
    }

    left.g - right.g
}

pub fn get_region_pair_key(a: RegionId, b: RegionId) -> String {
    if a < b {
        format!("{a}:{b}")
    } else {
        format!("{b}:{a}")
    }
}

pub fn compute_median_trace_pitch(order: &BusTraceOrder) -> f64 {
    let mut deltas: Vec<f64> = order
        .traces
        .windows(2)
        .map(|p| (p[1].score - p[0].score).abs())
        .filter(|d| d.is_finite() && *d > BUS_CANDIDATE_EPSILON)
        .collect();
    deltas.sort_by(f64::total_cmp);
    if deltas.is_empty() {
        return 0.5;
    }

    deltas[deltas.len() / 2]
}
