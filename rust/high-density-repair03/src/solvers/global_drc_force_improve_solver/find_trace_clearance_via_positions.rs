use crate::solvers::global_drc_force_improve_solver::clearance_math::*;
use crate::solvers::global_drc_force_improve_solver::find_pad_clearance_via_position::{
    boundary_intersections, boundary_projections, create_circle, create_line,
};
use crate::solvers::global_drc_force_improve_solver::internal_types::{Point, Segment, ViaNode};
use crate::solvers::global_drc_force_improve_solver::net_utils::{
    RepairConnectivityMap, shares_net,
};
use crate::solvers::global_drc_force_improve_solver::solver_config::{
    MAX_ERROR_MOVE, POSITION_EPSILON,
};
use crate::solvers::global_drc_force_improve_solver::solver_helpers::RepairMath;
use math_utils::point_to_segment_distance;
use std::cmp::Ordering;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm-types", derive(tsify::Tsify))]
pub struct TracePlacements {
    pub points: Vec<Point>,
    pub via_identity_indices: Vec<usize>,
}

pub fn find_trace_clearance_via_positions(
    via: &ViaNode,
    segments: &[Segment],
    clearance: f64,
    conn_map: Option<&RepairConnectivityMap>,
    math: &RepairMath,
) -> Vec<Point> {
    find_trace_clearance_via_positions_with_identity(via, segments, clearance, conn_map, math)
        .points
}

pub fn find_trace_clearance_via_positions_with_identity(
    via: &ViaNode,
    segments: &[Segment],
    clearance: f64,
    conn_map: Option<&RepairConnectivityMap>,
    math: &RepairMath,
) -> TracePlacements {
    let min_z = via.z_layers.iter().copied().fold(f64::INFINITY, js_min);
    let max_z = via.z_layers.iter().copied().fold(f64::NEG_INFINITY, js_max);
    let via_point = Point { x: via.x, y: via.y };
    let constraints: Vec<(&Segment, f64)> = segments
        .iter()
        .filter(|segment| {
            segment.z >= min_z
                && segment.z <= max_z
                && !shares_net(
                    &via.root_connection_name,
                    Some(&segment.root_connection_name),
                    conn_map,
                )
        })
        .map(|segment| (segment, via.radius + segment.radius + clearance))
        .filter(|(segment, required)| {
            point_to_segment_distance(
                &via_point,
                &segment.start.borrow().point(),
                &segment.end.borrow().point(),
            ) <= required + MAX_ERROR_MOVE
        })
        .collect();
    let boundaries: Vec<_> = constraints
        .iter()
        .flat_map(|(segment, required)| {
            let start = segment.start.borrow().point();
            let end = segment.end.borrow().point();
            let length = dist_sq(&start, &end).sqrt();
            if length <= POSITION_EPSILON {
                return vec![];
            }
            let radius = required + POSITION_EPSILON;
            let dx = ((end.y - start.y) / length) * radius;
            let dy = ((start.x - end.x) / length) * radius;
            vec![
                create_line(
                    Point {
                        x: start.x + dx,
                        y: start.y + dy,
                    },
                    Point {
                        x: end.x + dx,
                        y: end.y + dy,
                    },
                ),
                create_line(
                    Point {
                        x: start.x - dx,
                        y: start.y - dy,
                    },
                    Point {
                        x: end.x - dx,
                        y: end.y - dy,
                    },
                ),
                create_circle(start, radius),
                create_circle(end, radius),
            ]
        })
        .filter(|boundary| {
            point_to_bounds_distance(&via_point, boundary.bounds()) <= MAX_ERROR_MOVE
        })
        .collect();
    let mut candidates: Vec<(Point, bool)> = Vec::new();
    let consider = |point: Point, is_via: bool, candidates: &mut Vec<(Point, bool)>| {
        if dist_sq(&point, &via_point) > MAX_ERROR_MOVE * MAX_ERROR_MOVE
            || candidates.iter().any(|(candidate, _)| {
                dist_sq(candidate, &point) < POSITION_EPSILON * POSITION_EPSILON
            })
            || constraints.iter().any(|(segment, required)| {
                point_to_segment_distance(
                    &point,
                    &segment.start.borrow().point(),
                    &segment.end.borrow().point(),
                ) < *required
            })
        {
            return;
        }
        candidates.push((point, is_via));
    };
    consider(via_point, true, &mut candidates);
    for left in 0..boundaries.len() {
        let a = &boundaries[left];
        for point in boundary_projections(&via_point, a, math) {
            consider(point, false, &mut candidates);
        }
        for b in &boundaries[left + 1..] {
            if !do_bounds_overlap(a.bounds(), b.bounds()) {
                continue;
            }
            for point in boundary_intersections(a, b, math) {
                consider(point, false, &mut candidates);
            }
        }
    }
    candidates.sort_by(|(a, _), (b, _)| {
        let difference = dist_sq(a, &via_point) - dist_sq(b, &via_point);
        if difference < 0.0 {
            Ordering::Less
        } else if difference > 0.0 {
            Ordering::Greater
        } else {
            Ordering::Equal
        }
    });
    let via_identity_indices = candidates
        .iter()
        .enumerate()
        .filter_map(|(index, (_, is_via))| is_via.then_some(index))
        .collect();
    TracePlacements {
        points: candidates.into_iter().map(|(point, _)| point).collect(),
        via_identity_indices,
    }
}
