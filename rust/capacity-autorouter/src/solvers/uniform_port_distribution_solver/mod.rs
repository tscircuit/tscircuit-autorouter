pub mod determine_owner_pair;
pub mod get_bounds_from_node_with_port_points;
pub mod get_owner_pair_key;
pub mod get_shared_edge_for_node_pair;
#[cfg(target_arch = "wasm32")]
pub mod live_values;
pub mod precompute_shared_edges;
#[cfg(target_arch = "wasm32")]
pub mod redistribute_port_points_on_shared_edge;
#[cfg(target_arch = "wasm32")]
pub mod should_ignore_port_point;
#[cfg(target_arch = "wasm32")]
pub mod should_ignore_shared_edge;
pub mod types;
#[expect(
    clippy::module_inception,
    reason = "Keep the TypeScript directory and primary source file names."
)]
pub mod uniform_port_distribution_solver;
