# Source file map

Source: `tiny-hypergraph` commit `c60c55266323974507ca3de06ff6ff3c4860436d` (clean checkout).

Each library TypeScript file has one Rust counterpart. This is an inventory, not a compilation or behavior check.

| TypeScript source | Rust counterpart |
| --- | --- |
| `lib/DuplicateCongestedPortSolver.ts` | [src/duplicate_congested_port_solver.rs](src/duplicate_congested_port_solver.rs) |
| `lib/MinHeap.ts` | [src/min_heap.rs](src/min_heap.rs) |
| `lib/bus-solver/BusBoundaryPlanner.ts` | [src/bus_solver/bus_boundary_planner.rs](src/bus_solver/bus_boundary_planner.rs) |
| `lib/bus-solver/BusTraceInferencePlanner.ts` | [src/bus_solver/bus_trace_inference_planner.rs](src/bus_solver/bus_trace_inference_planner.rs) |
| `lib/bus-solver/TinyHyperGraphBusSolver.ts` | [src/bus_solver/tiny_hyper_graph_bus_solver.rs](src/bus_solver/tiny_hyper_graph_bus_solver.rs) |
| `lib/bus-solver/busGoalSearch.ts` | [src/bus_solver/bus_goal_search.rs](src/bus_solver/bus_goal_search.rs) |
| `lib/bus-solver/busPathHelpers.ts` | [src/bus_solver/bus_path_helpers.rs](src/bus_solver/bus_path_helpers.rs) |
| `lib/bus-solver/busSolverTypes.ts` | [src/bus_solver/bus_solver_types.rs](src/bus_solver/bus_solver_types.rs) |
| `lib/bus-solver/deriveBusTraceOrder.ts` | [src/bus_solver/derive_bus_trace_order.rs](src/bus_solver/derive_bus_trace_order.rs) |
| `lib/bus-solver/geometry.ts` | [src/bus_solver/geometry.rs](src/bus_solver/geometry.rs) |
| `lib/bus-solver/index.ts` | [src/bus_solver/mod.rs](src/bus_solver/mod.rs) |
| `lib/bus-solver/previewRoutingState.ts` | [src/bus_solver/preview_routing_state.rs](src/bus_solver/preview_routing_state.rs) |
| `lib/compat/convertPortPointPathingSolverInputToSerializedHyperGraph.ts` | [src/compat/convert_port_point_pathing_solver_input_to_serialized_hyper_graph.rs](src/compat/convert_port_point_pathing_solver_input_to_serialized_hyper_graph.rs) |
| `lib/compat/convertToSerializedHyperGraph.ts` | [src/compat/convert_to_serialized_hyper_graph.rs](src/compat/convert_to_serialized_hyper_graph.rs) |
| `lib/compat/loadSerializedHyperGraph.ts` | [src/compat/load_serialized_hyper_graph.rs](src/compat/load_serialized_hyper_graph.rs) |
| `lib/computeRegionCost.ts` | [src/compute_region_cost.rs](src/compute_region_cost.rs) |
| `lib/core.ts` | [src/core.rs](src/core.rs) |
| `lib/countIntersectionsFromAnglePairsDynamic.ts` | [src/count_intersections_from_angle_pairs_dynamic.rs](src/count_intersections_from_angle_pairs_dynamic.rs) |
| `lib/countNewIntersections.ts` | [src/count_new_intersections.rs](src/count_new_intersections.rs) |
| `lib/distance-aware-tiny-hypergraph-solver.ts` | [src/distance_aware_tiny_hypergraph_solver.rs](src/distance_aware_tiny_hypergraph_solver.rs) |
| `lib/find-distinct-owner-blocker-path.ts` | [src/find_distinct_owner_blocker_path.rs](src/find_distinct_owner_blocker_path.rs) |
| `lib/index.ts` | [src/lib.rs](src/lib.rs) |
| `lib/indexed-candidate-heap.ts` | [src/indexed_candidate_heap.rs](src/indexed_candidate_heap.rs) |
| `lib/initialAssignments.ts` | [src/initial_assignments.rs](src/initial_assignments.rs) |
| `lib/layerLabels.ts` | [src/layer_labels.rs](src/layer_labels.rs) |
| `lib/mapPortsToAnglePairs.ts` | [src/map_ports_to_angle_pairs.rs](src/map_ports_to_angle_pairs.rs) |
| `lib/outside-in-partial-rip-tiny-hypergraph-solver.ts` | [src/outside_in_partial_rip_tiny_hypergraph_solver.rs](src/outside_in_partial_rip_tiny_hypergraph_solver.rs) |
| `lib/poly-types.ts` | [src/poly_types.rs](src/poly_types.rs) |
| `lib/poly.ts` | [src/poly.rs](src/poly.rs) |
| `lib/region-graph/filterPortPointPathingSolverInputByConnectionPatches.ts` | [src/region_graph/filter_port_point_pathing_solver_input_by_connection_patches.rs](src/region_graph/filter_port_point_pathing_solver_input_by_connection_patches.rs) |
| `lib/region-graph/graph.ts` | [src/region_graph/graph.rs](src/region_graph/graph.rs) |
| `lib/region-graph/index.ts` | [src/region_graph/mod.rs](src/region_graph/mod.rs) |
| `lib/region-graph/region-path-solver.ts` | [src/region_graph/region_path_solver.rs](src/region_graph/region_path_solver.rs) |
| `lib/region-graph/visualizeRegionGraph.ts` | [src/region_graph/visualize_region_graph.rs](src/region_graph/visualize_region_graph.rs) |
| `lib/section-solver/TinyHyperGraphSectionPipelineSolver.ts` | [src/section_solver/tiny_hyper_graph_section_pipeline_solver.rs](src/section_solver/tiny_hyper_graph_section_pipeline_solver.rs) |
| `lib/section-solver/index.ts` | [src/section_solver/mod.rs](src/section_solver/mod.rs) |
| `lib/section-solver/sectionCandidateFamilies.ts` | [src/section_solver/section_candidate_families.rs](src/section_solver/section_candidate_families.rs) |
| `lib/selective-rerip-tiny-hyper-graph-solver.ts` | [src/selective_rerip_tiny_hyper_graph_solver.rs](src/selective_rerip_tiny_hyper_graph_solver.rs) |
| `lib/shuffle.ts` | [src/shuffle.rs](src/shuffle.rs) |
| `lib/static-reachability.ts` | [src/static_reachability.rs](src/static_reachability.rs) |
| `lib/types.ts` | [src/types.rs](src/types.rs) |
| `lib/utils.ts` | [src/utils.rs](src/utils.rs) |
| `lib/visualizeStaticReachabilityFailure.ts` | [src/visualize_static_reachability_failure.rs](src/visualize_static_reachability_failure.rs) |
| `lib/visualizeTinyGraph.ts` | [src/visualize_tiny_graph.rs](src/visualize_tiny_graph.rs) |

`src/graphics.rs` carries the external graphics value type; `src/compat/mod.rs` declares the compatibility modules.
