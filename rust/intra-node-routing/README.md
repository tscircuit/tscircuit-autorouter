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

Cache storage, key data, and canonical `object-hash` serialization remain in
`CachedIntraNodeRouteSolver`. The final SHA-1 digest is computed in one WASM
call by the companion binding, preserving existing cache keys.

From the repository root, with a separate frozen TypeScript checkout and its
own installed dependencies:

```sh
export TSCIRCUIT_TS_REFERENCE=/absolute/path/to/frozen-ts-checkout
cargo check --manifest-path rust/intra-node-routing/Cargo.toml
cargo check --manifest-path rust/intra-node-routing/Cargo.toml --target wasm32-unknown-unknown
cargo build --manifest-path rust/intra-node-routing/Cargo.toml --example parity
bun rust/intra-node-routing/integration/helpers.ts
bun rust/intra-node-routing/integration/parity.ts
bun rust/autorouter-bindings/integration/general-parity.ts
bunx tsc -p rust/intra-node-routing/integration/tsconfig.json --noEmit
```

The native `rust/intra-node-routing/integration/parity.ts` harness compares the Rust
example executable against the frozen TS solver selected by
`TSCIRCUIT_TS_REFERENCE`. Its eleven fixtures covered 7,150 steps in the recorded
validation run, including two replayed SRJ18 nodes, four layers, branching,
connectivity, shuffling, and iteration limits. Each step compares state and route
JSON bytes without sorting keys. The companion
`rust/autorouter-bindings/integration/general-parity.ts` is a separate three-fixture
WASM adapter check; the eleven-fixture count does not describe that command.
The real-node fixtures
reuse captured node geometry with explicitly chosen intra-node-routing parameters;
they are not full-board benchmark runs. Helper checks cover heap ties, spatial
updates, seeded random sequences, and exact Flatbush query order.

The native JSON input parser enables `float_roundtrip` to preserve coordinates
exactly. The WASM binding lives in `../autorouter-bindings`; its additional checks cover
host math rounding and the TypeScript cache adapter. The autorouter uses this
port directly and initializes its embedded WASM module synchronously. No backend
flag or explicit initialization call is required for normal package use.

## Specialized portfolio candidates

The remaining specialized candidates are direct, separate source-file ports in
this crate. Their TypeScript classes retain the constructor and debugger-facing
API and call the embedded WASM implementation synchronously. The native portfolio
shares those engines and steps them locally; candidate selection, order, effort,
and failure conditions remain those of the TypeScript source.

| TypeScript source under `lib/solvers/HighDensitySolver` | Rust module under `src` |
| --- | --- |
| `SingleLayerNoDifferentRootIntersectionsIntraNodeSolver.ts` | `single_layer_no_different_root_intersections_intra_node_solver.rs` |
| `SingleTransitionIntraNodeSolver.ts` | `single_transition_intra_node_solver.rs` |
| `SingleTransitionThroughObstacleIntraNodeSolver.ts` | `single_transition_through_obstacle_intra_node_solver.rs` |
| `TwoRouteHighDensitySolver/TwoCrossingRoutesHighDensitySolver.ts` | `two_route_high_density_solver/two_crossing_routes_high_density_solver.rs` |
| `TwoRouteHighDensitySolver/SingleTransitionCrossingRouteSolver.ts` | `two_route_high_density_solver/single_transition_crossing_route_solver.rs` |
| `MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver.ts` | `multi_head_poly_line_intra_node_solver/multi_head_poly_line_intra_node_solver.rs` |
| `MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver2_Optimized.ts` | `multi_head_poly_line_intra_node_solver/multi_head_poly_line_intra_node_solver2_optimized.rs` |
| `MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration.ts` | `multi_head_poly_line_intra_node_solver/multi_head_poly_line_intra_node_solver3_via_possibilities_solver_integration.rs` |
| `../ViaPossibilitiesSolver/ViaPossibilitiesSolver2.ts` | `via_possibilities_solver/via_possibilities_solver2.rs` |

The corresponding helper files remain separate: connection port pairing and
layer normalization live in `specialized_utils`; MultiHead graph traversal,
centroid calculation, combinations, and via-position preparation live alongside
their solver. `specialized_solver.rs` dispatches the engines and preserves mutable
snapshots. `specialized_base_solver.rs` implements their original lifecycle.
A01/A03 remain in the separate `high-density` crate; the general candidate and
these specialized candidates use this crate. Normal package use has no
TypeScript backend fallback or initialization flag.

The portfolio shares board connectivity and normalized obstacles through a native
constructor context. Rust candidates hold `Rc` references to that immutable data;
their search state remains separate. This follows the source's shared object
references without copying the entire board into every candidate. Context caching
is scoped to portfolio construction. Direct solver constructors read their inputs
again, including mutations made between constructions. A direct `solve()` runs
its loop in Rust; `step()` and public diagnostic methods remain synchronous.

Routing calculations stay native. Host callbacks retain JavaScript math behavior
where needed, and visualization still calls the existing TypeScript color
transparency utility. Cache storage remains a TypeScript boundary. These ports do
not cover later whole-board simplification or via-removal stages and do not
imply a measured whole-board speedup.

The focused simple-candidate comparison checks the independent frozen TypeScript
classes, constructor and step states, route JSON, snapshot restoration, and
GraphicsObject/SVG output:

```sh
TSCIRCUIT_TS_REFERENCE=/absolute/path/to/frozen-ts-checkout \
  bun rust/autorouter-bindings/integration/specialized-simple-parity.ts
```

The recorded run covered 15 fixtures and 34 constructor, step, restore, and
terminal checks. It is a raw-engine comparison; public facade reference identity
and mutation behavior require the separate adapter checks.

Additional comparison commands cover crossing geometry, MultiHead/Via2 search,
the public facades, and native portfolio scheduling:

```sh
bun rust/autorouter-bindings/integration/specialized-crossing-parity.ts
bun rust/autorouter-bindings/integration/specialized-multi-head-parity.ts
bun rust/autorouter-bindings/integration/specialized-facade-parity.ts
bun rust/autorouter-bindings/integration/native-portfolio-specialized-parity.ts
bun rust/autorouter-bindings/integration/native-portfolio-parity.ts
```

These commands use the same `TSCIRCUIT_TS_REFERENCE` environment variable. The
focused native portfolio check rejects TypeScript candidate `_step` calls and
compares public state mutations between native batches. Diagnostic values and
the tested source-object aliases are preserved; identity between distinct
candidate snapshot fields still needs explicit native identity metadata.
