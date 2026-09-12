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
// Corresponds to the optional fields extending Candidate in busSolverTypes.ts.
#[derive(Clone, Debug, Default)]
pub struct BusCandidateState {
    pub bus_cost: Option<f64>,
    pub boundary_normal_x: Option<f64>,
    pub boundary_normal_y: Option<f64>,
}

pub type BusCenterCandidate = Candidate;

#[cfg(target_arch = "wasm32")]
const _: () = assert!(std::mem::size_of::<Candidate>() == 64);

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

#[cfg(test)]
mod candidate_representation_tests {
    use super::*;
    use std::rc::Rc;
    use crate::bus_solver::bus_path_helpers::get_candidate_boundary_normal;

    #[test]
    fn shared_bus_fields_preserve_absence_bits_and_independent_mutations() {
        let base = Candidate::default();
        assert!(base.bus.is_none());
        assert!(base.clone().bus.is_none());
        assert!(get_candidate_boundary_normal(&base).is_none());
        for value in [f64::from_bits(0x7ff8000000000042), -0.0, f64::INFINITY, f64::NEG_INFINITY] {
            let original = Candidate {
                bus: Some(Rc::new(BusCandidateState {
                    bus_cost: Some(value),
                    boundary_normal_x: Some(-0.0),
                    boundary_normal_y: None,
                })),
                ..Default::default()
            };
            let mut copy = original.clone();
            assert!(Rc::ptr_eq(original.bus.as_ref().unwrap(), copy.bus.as_ref().unwrap()));
            assert_eq!(copy.bus.as_ref().unwrap().bus_cost.unwrap().to_bits(), value.to_bits());
            assert!(get_candidate_boundary_normal(&copy).is_none());
            Rc::make_mut(copy.bus.as_mut().unwrap()).boundary_normal_y = Some(f64::INFINITY);
            Rc::make_mut(copy.bus.as_mut().unwrap()).bus_cost = None;
            let normal = get_candidate_boundary_normal(&copy).unwrap();
            assert_eq!(normal.x.to_bits(), (-0.0_f64).to_bits());
            assert_eq!(normal.y, f64::INFINITY);
            assert!(original.bus.as_ref().unwrap().boundary_normal_y.is_none());
            assert_eq!(original.bus.as_ref().unwrap().bus_cost.unwrap().to_bits(), value.to_bits());
        }
    }
}
