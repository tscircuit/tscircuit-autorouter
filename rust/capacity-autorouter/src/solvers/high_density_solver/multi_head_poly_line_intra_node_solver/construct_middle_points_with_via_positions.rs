use super::{create_symmetric_array::create_symmetric_array, types2::MHPoint2};
use crate::bindings::high_density::specialized_utils::math::Point;
use serde_json::Map;

pub fn construct_middle_points_with_via_positions(
    start: &MHPoint2,
    end: &MHPoint2,
    segments_per_polyline: usize,
    via_count: usize,
    available_z: &[f64],
    via_positions: &[Point],
) -> Vec<MHPoint2> {
    let indices = create_symmetric_array(segments_per_polyline, via_count);
    let mut points = vec![None; indices.len()];
    let mut vias_added = 0;
    let mut last_z = start.z1;
    let offset = available_z
        .iter()
        .position(|&z| z == start.z1)
        .map(|i| i as isize)
        .unwrap_or(-1);
    for (index, &is_via) in indices.iter().enumerate() {
        if is_via == 1 {
            let next_z = available_z
                [((offset + vias_added as isize + 1) % available_z.len() as isize) as usize];
            let p = via_positions[vias_added];
            points[index] = Some(MHPoint2 {
                diagnostic_id: super::types1::next_diagnostic_id(),
                x: p.x,
                y: p.y,
                z1: last_z,
                z2: next_z,
                metadata: Map::new(),
            });
            last_z = next_z;
            vias_added += 1;
        }
    }
    let mut left = start.clone();
    for index in 0..points.len() {
        if let Some(p) = &points[index] {
            left = p.clone();
            continue;
        }
        let mut right = end.clone();
        let mut right_index = points.len();
        for (next, point) in points.iter().enumerate().skip(index + 1) {
            if let Some(p) = point {
                right = p.clone();
                right_index = next;
                break;
            }
        }
        let count = right_index - index;
        let dx = right.x - left.x;
        let dy = right.y - left.y;
        let mut t = 1.0 / (count + 1) as f64;
        let mut offset = 0;
        loop {
            if index + offset == right_index {
                break;
            }
            points[index + offset] = Some(MHPoint2 {
                diagnostic_id: super::types1::next_diagnostic_id(),
                x: left.x + dx * t,
                y: left.y + dy * t,
                z1: left.z2,
                z2: left.z2,
                metadata: Map::new(),
            });
            t += 1.0 / (count + 1) as f64;
            offset += 1;
        }
    }
    points.into_iter().map(Option::unwrap).collect()
}
