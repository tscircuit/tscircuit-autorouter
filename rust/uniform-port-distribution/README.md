# Uniform port distribution

Direct port of `lib/solvers/UniformPortDistributionSolver`, compared against
the frozen TypeScript checkout at `22800e78` with its retained local changes.
This is the same oracle used by the existing SRJ18 comparisons, not a new
claim of parity with newer upstream main.

| Rust file | TypeScript source |
| --- | --- |
| `uniform_port_distribution_solver.rs` | `UniformPortDistributionSolver.ts`: constructor, step and rebuild |
| `determine_owner_pair.rs` | `determineOwnerPair.ts` |
| `get_owner_pair_key.rs` | `getOwnerPairKey.ts` |
| `get_bounds_from_node_with_port_points.rs` | `lib/utils/getBoundsFromNodeWithPortPoints.ts` |
| `get_shared_edge_for_node_pair.rs` | `getSharedEdgeForNodePair.ts` |
| `precompute_shared_edges.rs` | `precomputeSharedEdges.ts` |
| `should_ignore_port_point.rs` | `shouldIgnorePortPoint.ts` |
| `should_ignore_shared_edge.rs` | `shouldIgnoreSharedEdge.ts` |
| `redistribute_port_points_on_shared_edge.rs` | `redistributePortPointsOnSharedEdge.ts` |

The public TypeScript class retains its name, Maps, queue, output and graphics.
TypeScript materializes shallow copies from the original objects so metadata,
symbols and nested aliases do not pass through serialization. The Rust port
preserves the source's grouping, scan order, sorting and coordinate arithmetic.
Two small adapters invoke `find` on the original JavaScript arrays. Keeping
these standard collection lookups in the owning runtime avoids a WASM crossing
per scanned element and preserves caller-provided methods. The surrounding
filtering decisions, redistribution and rebuild traversal remain in Rust.
Obstacle fields cross together in a small numeric buffer, in the exact source
getter order; the bounds arithmetic stays in Rust. Inputs are read afresh on
each step, without a cached copy of the scene or mutation-detection scans.
Repeated terminal `step()` calls still rebuild output, and `iterations` remains
unchanged because the source overrides `step()` directly.

The frozen-reference oracle is
`rust/autorouter-bindings/integration/uniform-port-distribution-parity.ts`.
It compares each step and checks public mutations, shallow aliases, nonfinite
numbers, signed zero, stable ties, getter reads and custom Map methods. Rebuild
uses the original array `map` methods with Rust callbacks; the oracle covers
custom method results, retained callbacks, array species and holes as well.
