pub mod compute_via_count_variants;
pub mod construct_middle_points_with_via_positions;
pub mod create_symmetric_array;
pub mod detect_multi_connection_closed_faces_without_vias;
pub mod generate_binary_combinations;
pub mod get_centroids_from_inner_box_intersections;
pub mod get_every_combination_from_choice_array;
pub mod get_every_possible_ordering;
pub mod get_possible_initial_via_positions;
#[expect(
    clippy::module_inception,
    reason = "Keep the TypeScript directory and primary source file names."
)]
pub mod multi_head_poly_line_intra_node_solver;
pub mod multi_head_poly_line_intra_node_solver2_optimized;
pub mod multi_head_poly_line_intra_node_solver3_via_possibilities_solver_integration;
pub mod types1;
pub mod types2;
pub mod within_bounds;
