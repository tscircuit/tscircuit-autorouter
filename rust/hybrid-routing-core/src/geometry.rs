use crate::protocol::{Bounds, Geometry, RoutePoint, WorkCounters};
use rstar::{AABB, RTree, RTreeObject};

#[derive(Clone)]
struct IndexedGeometry {
    geometry: Geometry,
    envelope: AABB<[f64; 2]>,
}

impl RTreeObject for IndexedGeometry {
    type Envelope = AABB<[f64; 2]>;

    fn envelope(&self) -> Self::Envelope {
        self.envelope
    }
}

pub struct GeometryIndex {
    by_layer: Vec<RTree<IndexedGeometry>>,
}

impl GeometryIndex {
    pub fn new(layer_names: &[String], geometry: &[Geometry]) -> Self {
        let by_layer = layer_names
            .iter()
            .map(|layer| {
                let indexed = geometry
                    .iter()
                    .filter(|item| item.layer() == layer)
                    .cloned()
                    .map(|item| IndexedGeometry {
                        envelope: geometry_envelope(&item),
                        geometry: item,
                    })
                    .collect();
                RTree::bulk_load(indexed)
            })
            .collect();
        Self { by_layer }
    }

    pub fn segment_is_clear(
        &self,
        layer_index: usize,
        start: (f64, f64),
        end: (f64, f64),
        route_radius: f64,
        clearance: f64,
        work: &mut WorkCounters,
    ) -> bool {
        work.spatial_index_queries += 1;
        let padding = route_radius + clearance;
        let envelope = AABB::from_corners(
            [start.0.min(end.0) - padding, start.1.min(end.1) - padding],
            [start.0.max(end.0) + padding, start.1.max(end.1) + padding],
        );
        for item in self.by_layer[layer_index].locate_in_envelope_intersecting(&envelope) {
            work.geometry_predicate_calls += 1;
            if segment_intersects_geometry(start, end, padding, &item.geometry) {
                return false;
            }
        }
        true
    }

    pub fn via_is_clear(
        &self,
        layer_indices: impl Iterator<Item = usize>,
        point: (f64, f64),
        via_radius: f64,
        clearance: f64,
        work: &mut WorkCounters,
    ) -> bool {
        let padding = via_radius + clearance;
        let envelope = AABB::from_corners(
            [point.0 - padding, point.1 - padding],
            [point.0 + padding, point.1 + padding],
        );
        for layer_index in layer_indices {
            work.spatial_index_queries += 1;
            for item in self.by_layer[layer_index].locate_in_envelope_intersecting(&envelope) {
                work.geometry_predicate_calls += 1;
                if point_intersects_geometry(point, padding, &item.geometry) {
                    return false;
                }
            }
        }
        true
    }
}

pub fn point_within_bounds(point: (f64, f64), bounds: &Bounds) -> bool {
    bounds.contains_point(point.0, point.1)
}

pub fn route_point_distance(start: &RoutePoint, end: &RoutePoint) -> f64 {
    ((end.x - start.x).powi(2) + (end.y - start.y).powi(2)).sqrt()
}

fn geometry_envelope(geometry: &Geometry) -> AABB<[f64; 2]> {
    match geometry {
        Geometry::Circle {
            center_x,
            center_y,
            radius_mm,
            ..
        } => AABB::from_corners(
            [center_x - radius_mm, center_y - radius_mm],
            [center_x + radius_mm, center_y + radius_mm],
        ),
        Geometry::Segment {
            start_x,
            start_y,
            end_x,
            end_y,
            width_mm,
            ..
        } => {
            let radius = width_mm / 2.0;
            AABB::from_corners(
                [start_x.min(*end_x) - radius, start_y.min(*end_y) - radius],
                [start_x.max(*end_x) + radius, start_y.max(*end_y) + radius],
            )
        }
        Geometry::RotatedRect {
            center_x,
            center_y,
            width_mm,
            height_mm,
            rotation_degrees,
            ..
        } => {
            let radians = rotation_degrees.to_radians();
            let half_x = width_mm / 2.0;
            let half_y = height_mm / 2.0;
            let extent_x = radians.cos().abs() * half_x + radians.sin().abs() * half_y;
            let extent_y = radians.sin().abs() * half_x + radians.cos().abs() * half_y;
            AABB::from_corners(
                [center_x - extent_x, center_y - extent_y],
                [center_x + extent_x, center_y + extent_y],
            )
        }
    }
}

fn segment_intersects_geometry(
    start: (f64, f64),
    end: (f64, f64),
    padding: f64,
    geometry: &Geometry,
) -> bool {
    match geometry {
        Geometry::Circle {
            center_x,
            center_y,
            radius_mm,
            ..
        } => point_to_segment_distance((*center_x, *center_y), start, end)
            <= padding + radius_mm,
        Geometry::Segment {
            start_x,
            start_y,
            end_x,
            end_y,
            width_mm,
            ..
        } => {
            segment_to_segment_distance(start, end, (*start_x, *start_y), (*end_x, *end_y))
                <= padding + width_mm / 2.0
        }
        Geometry::RotatedRect {
            center_x,
            center_y,
            width_mm,
            height_mm,
            rotation_degrees,
            ..
        } => {
            let local_start = rotate_to_local(start, (*center_x, *center_y), *rotation_degrees);
            let local_end = rotate_to_local(end, (*center_x, *center_y), *rotation_degrees);
            segment_to_axis_aligned_rect_distance(
                local_start,
                local_end,
                width_mm / 2.0,
                height_mm / 2.0,
            ) <= padding
        }
    }
}

fn point_intersects_geometry(point: (f64, f64), padding: f64, geometry: &Geometry) -> bool {
    match geometry {
        Geometry::Circle {
            center_x,
            center_y,
            radius_mm,
            ..
        } => distance(point, (*center_x, *center_y)) <= padding + radius_mm,
        Geometry::Segment {
            start_x,
            start_y,
            end_x,
            end_y,
            width_mm,
            ..
        } => {
            point_to_segment_distance(
                point,
                (*start_x, *start_y),
                (*end_x, *end_y),
            ) <= padding + width_mm / 2.0
        }
        Geometry::RotatedRect {
            center_x,
            center_y,
            width_mm,
            height_mm,
            rotation_degrees,
            ..
        } => {
            let local = rotate_to_local(point, (*center_x, *center_y), *rotation_degrees);
            point_to_axis_aligned_rect_distance(local, width_mm / 2.0, height_mm / 2.0)
                <= padding
        }
    }
}

fn rotate_to_local(
    point: (f64, f64),
    center: (f64, f64),
    rotation_degrees: f64,
) -> (f64, f64) {
    let radians = -rotation_degrees.to_radians();
    let translated = (point.0 - center.0, point.1 - center.1);
    (
        translated.0 * radians.cos() - translated.1 * radians.sin(),
        translated.0 * radians.sin() + translated.1 * radians.cos(),
    )
}

fn segment_to_axis_aligned_rect_distance(
    start: (f64, f64),
    end: (f64, f64),
    half_width: f64,
    half_height: f64,
) -> f64 {
    if segment_intersects_axis_aligned_rect(start, end, half_width, half_height) {
        return 0.0;
    }
    let corners = [
        (-half_width, -half_height),
        (half_width, -half_height),
        (half_width, half_height),
        (-half_width, half_height),
    ];
    (0..4)
        .map(|index| {
            segment_to_segment_distance(
                start,
                end,
                corners[index],
                corners[(index + 1) % 4],
            )
        })
        .fold(f64::INFINITY, f64::min)
}

fn segment_intersects_axis_aligned_rect(
    start: (f64, f64),
    end: (f64, f64),
    half_width: f64,
    half_height: f64,
) -> bool {
    if start.0.abs() <= half_width && start.1.abs() <= half_height {
        return true;
    }
    if end.0.abs() <= half_width && end.1.abs() <= half_height {
        return true;
    }
    let corners = [
        (-half_width, -half_height),
        (half_width, -half_height),
        (half_width, half_height),
        (-half_width, half_height),
    ];
    (0..4).any(|index| {
        segments_intersect(start, end, corners[index], corners[(index + 1) % 4])
    })
}

fn point_to_axis_aligned_rect_distance(
    point: (f64, f64),
    half_width: f64,
    half_height: f64,
) -> f64 {
    let dx = (point.0.abs() - half_width).max(0.0);
    let dy = (point.1.abs() - half_height).max(0.0);
    (dx * dx + dy * dy).sqrt()
}

fn point_to_segment_distance(
    point: (f64, f64),
    start: (f64, f64),
    end: (f64, f64),
) -> f64 {
    let segment = (end.0 - start.0, end.1 - start.1);
    let length_squared = segment.0 * segment.0 + segment.1 * segment.1;
    if length_squared == 0.0 {
        return distance(point, start);
    }
    let projection = (((point.0 - start.0) * segment.0
        + (point.1 - start.1) * segment.1)
        / length_squared)
        .clamp(0.0, 1.0);
    distance(
        point,
        (
            start.0 + projection * segment.0,
            start.1 + projection * segment.1,
        ),
    )
}

fn segment_to_segment_distance(
    first_start: (f64, f64),
    first_end: (f64, f64),
    second_start: (f64, f64),
    second_end: (f64, f64),
) -> f64 {
    if segments_intersect(first_start, first_end, second_start, second_end) {
        return 0.0;
    }
    point_to_segment_distance(first_start, second_start, second_end)
        .min(point_to_segment_distance(first_end, second_start, second_end))
        .min(point_to_segment_distance(second_start, first_start, first_end))
        .min(point_to_segment_distance(second_end, first_start, first_end))
}

fn segments_intersect(
    first_start: (f64, f64),
    first_end: (f64, f64),
    second_start: (f64, f64),
    second_end: (f64, f64),
) -> bool {
    let first_a = orientation(first_start, first_end, second_start);
    let first_b = orientation(first_start, first_end, second_end);
    let second_a = orientation(second_start, second_end, first_start);
    let second_b = orientation(second_start, second_end, first_end);
    if first_a.signum() != first_b.signum() && second_a.signum() != second_b.signum() {
        return true;
    }
    const EPSILON: f64 = 1e-12;
    (first_a.abs() <= EPSILON && point_on_segment(second_start, first_start, first_end))
        || (first_b.abs() <= EPSILON && point_on_segment(second_end, first_start, first_end))
        || (second_a.abs() <= EPSILON
            && point_on_segment(first_start, second_start, second_end))
        || (second_b.abs() <= EPSILON && point_on_segment(first_end, second_start, second_end))
}

fn orientation(start: (f64, f64), end: (f64, f64), point: (f64, f64)) -> f64 {
    (end.0 - start.0) * (point.1 - start.1) - (end.1 - start.1) * (point.0 - start.0)
}

fn point_on_segment(point: (f64, f64), start: (f64, f64), end: (f64, f64)) -> bool {
    point.0 >= start.0.min(end.0)
        && point.0 <= start.0.max(end.0)
        && point.1 >= start.1.min(end.1)
        && point.1 <= start.1.max(end.1)
}

fn distance(first: (f64, f64), second: (f64, f64)) -> f64 {
    ((second.0 - first.0).powi(2) + (second.1 - first.1).powi(2)).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rotated_rectangle_uses_rounded_clearance_distance() {
        let geometry = Geometry::RotatedRect {
            geometry_id: "rect".into(),
            layer: "top".into(),
            center_x: 0.0,
            center_y: 0.0,
            width_mm: 2.0,
            height_mm: 1.0,
            rotation_degrees: 45.0,
        };
        assert!(point_intersects_geometry((0.0, 0.0), 0.0, &geometry));
        assert!(!point_intersects_geometry((3.0, 3.0), 0.2, &geometry));
    }
}
