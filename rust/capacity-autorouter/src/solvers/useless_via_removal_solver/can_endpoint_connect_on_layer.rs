pub use crate::bindings::trace_simplification::shared_maps::TerminalLayers;
use crate::bindings::trace_simplification::types::{ConnectivityMap, RouteRef};
use crate::data_structures::obstacle_tree::ObstacleSpatialHashIndex;

#[expect(
    clippy::too_many_arguments,
    reason = "Keep the argument list aligned with the TypeScript source."
)]
pub fn can_endpoint_connect_on_layer(
    endpoint_x: f64,
    endpoint_y: f64,
    target_z: f64,
    endpoint_pcb_port_id: Option<&str>,
    terminal_layers: Option<&TerminalLayers>,
    obstacles: &ObstacleSpatialHashIndex,
    route: &RouteRef,
    conn_map: &ConnectivityMap,
) -> Result<bool, String> {
    if let Some(layers) = endpoint_pcb_port_id
        .filter(|id| !id.is_empty())
        .and_then(|id| terminal_layers.and_then(|map| map.get(id)))
        && !layers.contains(&target_z)
    {
        return Ok(false);
    }
    let route = route.borrow();
    let ids = std::iter::once(route.connection_name.as_str())
        .chain(route.root_connection_name.as_deref());
    let ids: Vec<_> = ids.collect();
    let nearby = obstacles.search_area(endpoint_x, endpoint_y, 2.0, 2.0)?;
    let connected: Vec<_> = nearby
        .into_iter()
        .filter(|obstacle| {
            let obstacle = obstacle.borrow();
            let connected = ids.iter().any(|route_id| {
                obstacle
                    .connected_to
                    .iter()
                    .any(|id| id == route_id || conn_map.are_ids_connected(route_id, id))
            });
            if !connected {
                return false;
            }
            let half_width = obstacle.width / 2.0 + 0.05;
            let half_height = obstacle.height / 2.0 + 0.05;
            (endpoint_x - obstacle.center.x).abs() <= half_width
                && (endpoint_y - obstacle.center.y).abs() <= half_height
        })
        .collect();
    if !connected.is_empty() {
        return Ok(connected
            .iter()
            .any(|obstacle| obstacle.borrow().z_layers.contains(&target_z)));
    }
    Ok(false)
}
