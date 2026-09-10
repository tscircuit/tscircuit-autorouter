use super::bus_solver_types::PreviewRoutingStateSnapshot;
use crate::core::{TinyHyperGraphWorkingState, create_empty_region_intersection_cache};

pub fn clear_preview_routing_state(
    state: &mut TinyHyperGraphWorkingState,
    region_count: usize,
) -> () {
    state.port_assignment.fill(-1);
    state.region_segments = vec![vec![]; region_count];
    state.region_intersection_caches = (0..region_count)
        .map(|_| create_empty_region_intersection_cache())
        .collect();
    state.region_congestion_cost.fill(0.0);
    state.rip_count = 0;
}

pub fn get_preview_region_cost(state: &TinyHyperGraphWorkingState) -> f64 {
    state
        .region_intersection_caches
        .iter()
        .map(|cache| cache.existing_region_cost)
        .sum()
}

#[derive(Clone, Debug)]
pub struct PreviewIntersectionCounts {
    pub same_layer_intersection_count: i32,
    pub crossing_layer_intersection_count: i32,
}

pub fn get_preview_intersection_counts(
    state: &TinyHyperGraphWorkingState,
) -> PreviewIntersectionCounts {
    let mut same = 0;
    let mut crossing = 0;

    for cache in &state.region_intersection_caches {
        same += cache.existing_same_layer_intersections;
        crossing += cache.existing_crossing_layer_intersections;
    }

    PreviewIntersectionCounts {
        same_layer_intersection_count: same,
        crossing_layer_intersection_count: crossing,
    }
}

pub fn snapshot_preview_routing_state(
    state: &TinyHyperGraphWorkingState,
) -> PreviewRoutingStateSnapshot {
    PreviewRoutingStateSnapshot {
        port_assignment: state.port_assignment.clone(),
        region_segments: state.region_segments.clone(),
        region_intersection_caches: state.region_intersection_caches.clone(),
    }
}

pub fn restore_preview_routing_state(
    state: &mut TinyHyperGraphWorkingState,
    snapshot: &PreviewRoutingStateSnapshot,
) -> () {
    state.port_assignment = snapshot.port_assignment.clone();
    state.region_segments = snapshot.region_segments.clone();
    state.region_intersection_caches = snapshot.region_intersection_caches.clone();
}
