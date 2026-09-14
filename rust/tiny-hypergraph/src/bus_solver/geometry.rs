use crate::core::TinyHyperGraphTopology;
use crate::types::PortId;
const EPSILON: f64 = 1e-9;

fn get_port_point(topology: &TinyHyperGraphTopology, port_id: PortId) -> (f64, f64, i32) {
    (
        topology.port_x[port_id as usize],
        topology.port_y[port_id as usize],
        topology.port_z[port_id as usize],
    )
}

pub fn get_port_projection(
    topology: &TinyHyperGraphTopology,
    port_id: PortId,
    normal_x: f64,
    normal_y: f64,
) -> f64 {
    topology.port_x[port_id as usize] * normal_x + topology.port_y[port_id as usize] * normal_y
}

pub fn get_port_distance(topology: &TinyHyperGraphTopology, from: PortId, to: PortId) -> f64 {
    (topology.port_x[from as usize] - topology.port_x[to as usize])
        .hypot(topology.port_y[from as usize] - topology.port_y[to as usize])
}

fn get_point_to_point_distance(x1: f64, y1: f64, x2: f64, y2: f64) -> f64 {
    (x1 - x2).hypot(y1 - y2)
}

fn get_point_to_segment_distance(px: f64, py: f64, ax: f64, ay: f64, bx: f64, by: f64) -> f64 {
    let (ab_x, ab_y) = (bx - ax, by - ay);
    let length_squared = ab_x * ab_x + ab_y * ab_y;
    if length_squared <= EPSILON {
        return get_point_to_point_distance(px, py, ax, ay);
    }

    let t = (((px - ax) * ab_x + (py - ay) * ab_y) / length_squared).clamp(0.0, 1.0);
    get_point_to_point_distance(px, py, ax + ab_x * t, ay + ab_y * t)
}

pub fn get_distance_from_port_to_polyline(
    topology: &TinyHyperGraphTopology,
    port_id: PortId,
    polyline: &[PortId],
) -> f64 {
    if polyline.is_empty() {
        return f64::INFINITY;
    }

    let (x, y, _) = get_port_point(topology, port_id);
    if polyline.len() == 1 {
        let (ax, ay, _) = get_port_point(topology, polyline[0]);
        return get_point_to_point_distance(x, y, ax, ay);
    }

    let mut best_distance = f64::INFINITY;

    for pair in polyline.windows(2) {
        let (ax, ay, _) = get_port_point(topology, pair[0]);
        let (bx, by, _) = get_port_point(topology, pair[1]);
        best_distance = best_distance.min(get_point_to_segment_distance(x, y, ax, ay, bx, by));
    }

    best_distance
}

pub fn get_port_progress_along_polyline(
    topology: &TinyHyperGraphTopology,
    port_id: PortId,
    polyline: &[PortId],
) -> f64 {
    if polyline.len() <= 1 {
        return 0.0;
    }

    let (x, y, _) = get_port_point(topology, port_id);
    let mut best_distance = f64::INFINITY;
    let mut best_progress = 0.0;
    let mut accumulated_length = 0.0;

    for pair in polyline.windows(2) {
        let (ax, ay, _) = get_port_point(topology, pair[0]);
        let (bx, by, _) = get_port_point(topology, pair[1]);
        let (ab_x, ab_y) = (bx - ax, by - ay);
        let length = ab_x.hypot(ab_y);
        if length <= EPSILON {
            continue;
        }

        let t = (((x - ax) * ab_x + (y - ay) * ab_y) / (length * length)).clamp(0.0, 1.0);
        let distance = get_point_to_point_distance(x, y, ax + ab_x * t, ay + ab_y * t);
        if distance < best_distance {
            best_distance = distance;
            best_progress = accumulated_length + length * t;
        }

        accumulated_length += length;
    }

    best_progress
}
