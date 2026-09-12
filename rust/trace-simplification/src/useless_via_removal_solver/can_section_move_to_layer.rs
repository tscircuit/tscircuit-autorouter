use crate::types::{ConnectivityMap, Point, RouteRef};
use crate::data_structures::{high_density_route_spatial_index::RouteClearanceIndex, obstacle_tree::ObstacleSpatialHashIndex};
use super::route_section::RouteSection;
use crate::math_utils::segment_to_box_min_distance;
use crate::types::Point2;

pub fn can_section_move_to_layer(
    section: &RouteSection, target_z: f64, route: &RouteRef,
    hd_routes: &dyn RouteClearanceIndex, obstacles: &ObstacleSpatialHashIndex,
    conn_map: &ConnectivityMap, default_thickness: f64, obstacle_margin: f64,
    trace_margin: Option<f64>, check_static: Option<&dyn Fn(&Point, &Point) -> bool>,
) -> Result<bool, String> {
    let route = route.borrow();
    let thickness = if route.metadata.get("traceThickness").is_none_or(|value| value.is_null()) {
        default_thickness
    } else { route.trace_thickness };
    let trace_margin = trace_margin.unwrap_or(0.0);
    let ids = [Some(route.connection_name.as_str()), route.root_connection_name.as_deref()];
    for pair in section.points.windows(2) {
        let start = pair[0].borrow();
        let end = pair[1].borrow();
        let a = Point { x: start.x, y: start.y, z: target_z };
        let b = Point { x: end.x, y: end.y, z: target_z };
        let conflicts = hd_routes.get_conflicting_routes_for_segment(&a, &b, thickness / 2.0 + trace_margin);
        for conflict in conflicts {
            let other = conflict.conflicting_route.borrow();
            let other_ids = [Some(other.connection_name.as_str()), other.root_connection_name.as_deref()];
            if ids.iter().flatten().any(|id| other_ids.iter().flatten().any(|other_id| other_id == id || conn_map.are_ids_connected(other_id, id))) { continue; }
            let other_thickness = if other.metadata.get("traceThickness").is_none_or(|value| value.is_null()) { default_thickness } else { other.trace_thickness };
            let radius = if trace_margin > 0.0 { crate::math_utils::max(other_thickness / 2.0, other.via_diameter / 2.0) } else { other_thickness / 2.0 };
            if conflict.distance < thickness / 2.0 + radius + trace_margin { return Ok(false); }
        }
        if check_static.is_some_and(|check| !check(&a, &b)) { continue; }
        let margin = thickness / 2.0 + obstacle_margin;
        for obstacle in obstacles.search_area((a.x + b.x) / 2.0, (a.y + b.y) / 2.0, (a.x - b.x).abs() + margin * 2.0, (a.y - b.y).abs() + margin * 2.0)? {
            let obstacle = obstacle.borrow();
            if ids.iter().flatten().any(|id| obstacle.connected_to.iter().any(|other| other == id || conn_map.are_ids_connected(other, id))) { continue; }
            if obstacle.z_layers.contains(&target_z) {
                let at_obstacle = ((a.x - obstacle.center.x).abs() < 0.01 && (a.y - obstacle.center.y).abs() < 0.01)
                    || ((b.x - obstacle.center.x).abs() < 0.01 && (b.y - obstacle.center.y).abs() < 0.01);
                if at_obstacle { continue; }
            }
            if segment_to_box_min_distance(Point2 { x: a.x, y: a.y }, Point2 { x: b.x, y: b.y }, obstacle.center, obstacle.width, obstacle.height) < margin { return Ok(false); }
        }
    }
    Ok(true)
}
