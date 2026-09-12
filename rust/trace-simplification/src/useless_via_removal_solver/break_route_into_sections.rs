use crate::types::RouteRef;
use super::route_section::RouteSection;

pub fn break_route_into_sections(route: &RouteRef) -> Vec<RouteSection> {
    let route = route.borrow();
    let points = &route.route;
    if points.is_empty() { return Vec::new(); }
    let mut sections = Vec::new();
    let mut current = RouteSection { identity: crate::types::next_identity(), points_array_identity: crate::types::next_identity(),
        start_index: 0, end_index: -1, z: points[0].borrow().z,
        points: vec![points[0].clone()],
    };
    for (index, point) in points.iter().enumerate().skip(1) {
        if point.borrow().z == current.z {
            current.points.push(point.clone());
        } else {
            current.end_index = index as isize - 1;
            sections.push(current);
            current = RouteSection { identity: crate::types::next_identity(), points_array_identity: crate::types::next_identity(),
                start_index: index, end_index: -1, z: point.borrow().z,
                points: vec![point.clone()],
            };
        }
    }
    current.end_index = points.len() as isize - 1;
    sections.push(current);
    sections
}
