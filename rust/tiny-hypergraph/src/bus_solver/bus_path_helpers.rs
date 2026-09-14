use super::bus_boundary_planner::BoundaryNormal;
use super::bus_solver_types::{BusCenterCandidate, TracePreview};
use super::geometry::get_port_distance;
use crate::core::TinyHyperGraphTopology;
use crate::types::{PortId, RegionId, RouteId};
use std::collections::HashMap;

pub fn get_center_candidate_path(candidate: &BusCenterCandidate) -> Vec<BusCenterCandidate> {
    let mut path = Vec::new();
    let mut cursor = Some(candidate);

    while let Some(current) = cursor {
        path.push(current.clone());
        cursor = current.prev_candidate.as_deref();
    }

    path.reverse();
    path
}

pub fn get_center_candidate_path_key(candidate: &BusCenterCandidate) -> String {
    get_center_candidate_path(candidate)
        .iter()
        .map(|c| {
            format!(
                "{}:{}:{}",
                c.port_id,
                c.next_region_id,
                usize::from(c.at_goal)
            )
        })
        .collect::<Vec<_>>()
        .join("|")
}

pub fn center_candidate_path_contains_hop(
    candidate: &BusCenterCandidate,
    port_id: PortId,
    next_region_id: RegionId,
) -> bool {
    let mut cursor = Some(candidate);

    while let Some(current) = cursor {
        if current.port_id == port_id && current.next_region_id == next_region_id {
            return true;
        }

        cursor = current.prev_candidate.as_deref();
    }

    false
}

pub fn center_candidate_path_contains_region(
    candidate: &BusCenterCandidate,
    region_id: RegionId,
) -> bool {
    let mut cursor = Some(candidate);

    while let Some(current) = cursor {
        if current.next_region_id == region_id {
            return true;
        }

        cursor = current.prev_candidate.as_deref();
    }

    false
}

pub fn get_guide_port_ids(
    center_path: &[BusCenterCandidate],
    shared_step_count: usize,
) -> Vec<PortId> {
    let start = shared_step_count.min(center_path.len().saturating_sub(1));
    center_path[start..].iter().map(|c| c.port_id).collect()
}

pub fn get_candidate_boundary_normal(candidate: &BusCenterCandidate) -> Option<BoundaryNormal> {
    let bus = candidate.bus.as_ref()?;
    Some(BoundaryNormal {
        x: bus.boundary_normal_x?,
        y: bus.boundary_normal_y?,
    })
}

pub fn get_polyline_length(topology: &TinyHyperGraphTopology, ports: &[PortId]) -> f64 {
    ports
        .windows(2)
        .map(|p| get_port_distance(topology, p[0], p[1]))
        .sum()
}

pub fn get_trace_preview_length(topology: &TinyHyperGraphTopology, preview: &TracePreview) -> f64 {
    preview
        .segments
        .iter()
        .map(|s| get_port_distance(topology, s.from_port_id, s.to_port_id))
        .sum()
}

pub fn is_port_incident_to_region(
    topology: &TinyHyperGraphTopology,
    port: PortId,
    region: RegionId,
) -> bool {
    topology
        .incident_port_region
        .get(port as usize)
        .is_some_and(|ids| ids.contains(&region))
}

pub fn ensure_port_ownership(
    route: RouteId,
    port: PortId,
    owners: &mut HashMap<PortId, RouteId>,
) -> bool {
    if owners.get(&port).is_some_and(|owner| *owner != route) {
        return false;
    }

    owners.insert(port, route);
    true
}
