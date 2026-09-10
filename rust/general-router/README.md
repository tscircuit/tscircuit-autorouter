# General intra-node router

Fresh file-by-file Rust translation of the general routing candidate used by
`PortfolioSingleIntraNodeSolver`. No implementation from the existing Rust ports
is reused.

| TypeScript source | Rust module |
| --- | --- |
| `HighDensitySolver/IntraNodeSolver.ts` | `intra_node_solver.rs` |
| `HighDensitySolver/SingleHighDensityRouteSolver.ts` | `single_high_density_route_solver.rs` |
| `HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost.ts` | `single_high_density_route_solver6_vert_horz_layer_future_cost.rs` |
| `HighDensitySolver/HighDensityHyperParameters.ts` | `high_density_hyper_parameters.rs` |
| `data-structures/SingleRouteCandidatePriorityQueue.ts` | `single_route_candidate_priority_queue.rs` |
| `data-structures/HighDensityRouteSpatialIndex.ts` | `high_density_route_spatial_index.rs` |
| `utils/cloneAndShuffleArray.ts` | `clone_and_shuffle_array.rs` |
| `utils/getBoundsFromNodeWithPortPoints.ts` | `get_bounds_from_node_with_port_points.rs` |
| `utils/getMinDistBetweenEnteringPoints.ts` | `get_min_dist_between_entering_points.rs` |

Paths above are under `lib/solvers`, `lib/data-structures`, and `lib/utils` as
appropriate. `types.rs` carries the routing types. `geometry.rs` translates the
three geometry primitives used from `@tscircuit/math-utils`; `flatbush.rs`
translates the installed Flatbush 4.6.2 indexing and rectangle-query methods,
including their traversal order. Unused Flatbush serialization and nearest-neighbor
APIs are excluded. Its ISC notice is in `FLATBUSH-LICENSE`.

The search subclass has its own file and uses explicit dispatch through the base
struct. The local `BaseSolver` lifecycle is preserved: failure occurs when
iterations **exceed** the limit. It differs from the external BaseSolver used by
A01/A03. Search progress also preserves the source's no-argument NaN result.

`ConnectivityMap` accepts a snapshot of the TypeScript object's `netMap` and
`idToNetMap`, retaining the installed dependency's connectivity comparisons.
JavaScript number formatting and rounding have explicit helpers. Visualization
accepts the existing TypeScript transparency function at its boundary.

Cache storage and `object-hash` key generation remain in the TypeScript
`CachedIntraNodeRouteSolver`. They are outside this crate's search loop.

From the repository root:

```sh
cargo check --manifest-path rust/general-router/Cargo.toml
cargo check --manifest-path rust/general-router/Cargo.toml --target wasm32-unknown-unknown
cargo build --manifest-path rust/general-router/Cargo.toml --example parity
bun rust/general-router/integration/helpers.ts
bun rust/general-router/integration/parity.ts
bunx tsc -p rust/general-router/integration/tsconfig.json --noEmit
```

The parity tools compare against the actual TypeScript implementation. Eleven
routing fixtures cover 7,150 steps, including two replayed SRJ18 nodes, four
layers, branching, connectivity, shuffling, and iteration limits. Each step
compares state and route JSON bytes without sorting keys. The real-node fixtures
reuse captured node geometry with explicitly chosen general-router parameters;
they are not full-board benchmark runs. Helper checks cover heap ties, spatial
updates, seeded random sequences, and exact Flatbush query order.

The native JSON input parser enables `float_roundtrip` to preserve coordinates
exactly. Native parity does not establish WASM runtime parity: the binding and
portfolio adapter are the next integration step. This crate alone does not
enable a new portfolio backend or establish a speedup.
