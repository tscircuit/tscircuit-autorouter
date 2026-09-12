# Repair geometry Rust port

Fresh, direct file-by-file port of repair geometry and the candidate loop in `high-density-repair03` at commit `5f6c9af547dbb70c8948227011e1769b5dfa16a5`, together with Pipeline9's repository-owned indexed DRC evaluator. Pipeline 9 uses the Rust repair loop directly, keeping candidate generation, scoring, selection, and geometry native. The narrower geometry adapters retain their existing TS orchestration.

Source mapping:

- `src/global_drc_force_improve_solver.rs`: `GlobalDrcForceImproveSolver.ts`, including its candidate loop and acceptance rules.
- `src/global_drc_branch_portfolio_solver.rs`: `GlobalDrcBranchPortfolioSolver.ts`, including branch ordering and portfolio selection.
- `src/drc_snapshot.rs` and `src/types.rs`: snapshot construction, scoring, and shared solver state from `solverHelpers.ts` and `types.ts`.
- `src/trace_to_pad_clearance_relaxation.rs` and `src/via_to_pad_clearance_relaxation.rs`: the corresponding source relaxation modules.
- `src/solver_helpers.rs`: broad repulsion, `applyDrcErrorForces`, and their reachable helpers from `lib/solvers/GlobalDrcForceImproveSolver/solverHelpers.ts`, including route cloning/materialization, via and segment movement, spatial interactions, board constraints, and final via/segment cleanup.
- `src/find_pad_clearance_via_position.rs`: `findPadClearanceViaPosition.ts`, including its boundary construction, projection, and intersection helpers.
- `src/find_trace_clearance_via_positions.rs`: `findTraceClearanceViaPositions.ts`.
- `src/internal_types.rs`: the route, via, segment, point, and bounds types from `internalTypes.ts`. Segment endpoints retain references to mutable route points, matching the source's shared point objects.
- `src/net_utils.rs`: `netUtils.ts` connectivity and net-alias helpers.
- `src/spatial_index.rs`: `spatialIndex.ts` cell indexing, bounds, and sorted candidate queries.
- `src/solver_config.rs`: `solverConfig.ts` constants and effort/clearance calculations.
- `src/get_drc_errors.rs` and `src/drc_presets.rs`: the clearance constants imported by the broad pass from the corresponding source files.
- Geometry primitives imported from `autorouting-drc` are the companion fresh ports of the same `@tscircuit/math-utils` dependencies.

The WASM binding lives in `rust/autorouter-bindings`. A call transfers candidate routes into Rust, runs all broad passes and optional final cleanup there, and returns the resulting routes. Pass counts, ordering, movement limits, same-net handling, and early termination follow the TypeScript source. The adapter returns the original route array when the Rust result reports no change.

`lib/solvers/DrcSolver/BroadRepulsionAdapter.ts` retains a Rust context for each SRJ object. The SRJ is captured once; the repair solver treats its board geometry as fixed. Connectivity is synchronized before each call because regional repair may extend the map. The context parses fixed geometry and connectivity into typed Rust fields once, so movement loops borrow the outline and read fields without repeated JSON lookups. JSON transport preserves route metadata and property ordering; Rust enables exact floating-point parsing.

The dependency patch in `patches/high-density-repair03-git-5f6c9af.patch` retains typed function boundaries for broad and targeted repair. Pipeline 9 registers its Rust adapters automatically. The adapters initialize the embedded module synchronously; normal callers neither select a backend nor call an enable function. Failures propagate to the caller.

Targeted repair retains a context per SRJ for force application and pad placement; trace placement has no SRJ argument and uses a static WASM call. Error forces mutate the existing route arrays and point objects in place, using Rust point-origin metadata to preserve references when detour points are inserted. Via arrays remain caller-owned until materialization. Placement results carry explicit markers when the source returns the original preferred point or via object.

The patch is tracked through Bun's `patchedDependencies`. Comparison harnesses load the original functions from a separate frozen checkout with its own dependencies, using `TSCIRCUIT_TS_REFERENCE`. That checkout is never a production backend.

Focused parity checks:

```sh
export TSCIRCUIT_TS_REFERENCE=/absolute/path/to/frozen-ts-checkout
bun rust/autorouter-bindings/integration/broad-repulsion-parity.ts
bun rust/autorouter-bindings/integration/broad-repulsion-parity.ts --input-dir /path/to/captured-calls
```

Captured calls contain `srj`, `routes`, `effort`, `passMultiplier`, `connMap`, `allowSameNetViaPairs`, and `cleanup`. The harness checks exact serialized route output, unchanged array identity, input immutability, and changing connectivity against the original TS function.

Targeted checks:

```sh
bun rust/autorouter-bindings/integration/targeted-repair-parity.ts --input-dir /path/to/targeted-calls
bun rust/autorouter-bindings/integration/via-clearance-parity.ts
```

Targeted captured files are `force-N.json`, `pad-N.json`, and `trace-N.json`, each containing the source function's positional argument array. Connectivity maps serialize their data fields and trace-index maps serialize as objects. Force output reports only modified routes, with original route indexes and point provenance. Owned input decoding avoids duplicate route/point metadata copies. Pad placement retains a typed immutable board context; per-query constraints, candidates, and ordering follow the source.

## Pipeline9 indexed candidate evaluation

`pipeline9_drc_evaluator.rs` ports the indexed evaluation closures in `Pipeline9JointDrcRepairSolver.ts`. It keeps candidate conversion, trace-ID preparation, baseline filtering, error normalization, the 64-entry candidate cache, and calls into the companion Rust DRC engine in native code. Reference-check validation remains a separate TypeScript boundary controlled by the parent solver.

Additional source mapping:

- `convert_hd_route_to_simplified_route.rs`: repository `lib/utils/convertHdRouteToSimplifiedRoute.ts`, including terminal vias, through-obstacle segments, and jumpers. This is the repository conversion path, which differs from the dependency's helper.
- `convert_pipeline7_hd_routes_to_simplified_pcb_traces.rs`: repository `convertPipeline7HdRoutesToSimplifiedPcbTraces.ts` and its prepared connection metadata/cache.
- `is_obstacle_connected_to_route.rs`: repository `TraceWidthSolver/isObstacleConnectedToRoute.ts`, using the injected connectivity map's lookup behavior.
- `assign_unique_pcb_trace_ids_to_new_traces.rs`: repository `assignUniquePcbTraceIdsToNewTraces.ts`.
- `combine_preloaded_and_routed_traces.rs`: `combinePreloadedAndRoutedTraces` from repository `evaluate-relaxed-drc.ts`.
- `filter_pipeline9_drc_errors_against_baseline.rs`: repository `filterPipeline9DrcErrorsAgainstBaseline.ts`.
- `normalize_pipeline9_drc_errors_for_repair.rs`: repository `normalizePipeline9DrcErrorsForRepair.ts`.
- `pipeline9_drc_trace_ids.rs`: `getAutoroutingViaElements`, `addAutoroutingViaTraceIds`, and `remapDrcTraceIds` from `Pipeline9JointDrcRepairSolver.ts`.

The evaluator descriptor supplies `engineSrj`, `engineOptions`, `solverSrj`, `connMap`, `originalTraces`, `newConnections`, `originalConnections`, `layerCount`, `defaultViaHoleDiameter`, `obstacles`, `movablePreloadedSections`, and `nonMovableMutatedPreloadedTraces`. Each movable section carries `syntheticConnectionName`, `evaluationTraceId`, and `originalTrace`. Static board and conversion inputs are retained for the evaluator's lifetime. Candidate routes are evaluated without calling TypeScript conversion or normalization functions.

Native candidate evaluation passes typed routes and simplified traces directly into DRC ingestion. Cache keys stream the current coordinates over borrowed metadata in their original JSON property order. Candidate clones share immutable metadata; coordinate changes remain independent, and metadata edits copy on write. The existing JSON interfaces remain available at caller boundaries. Repair spatial indexes use numeric cell keys while retaining the source's cell traversal and sorted candidate order.

Pipeline 9 passes its evaluator descriptor directly to the Rust portfolio. Native evaluation retains the source's required reference-check callback when indexed errors reach zero, including reference-cache and false-negative accounting. An unvalidated zero-error result cannot substitute for it. The parent also retains post-portfolio validation and later repair stages.

```sh
./benchmark.sh --dataset srj18 --concurrency 4 --sample-timeout 600s
TSCIRCUIT_TS_REFERENCE=/absolute/path/to/frozen-ts-checkout bun rust/autorouter-bindings/integration/repair-loop-parity.ts 8
```

There are no runtime backend-selection flags. The parity harness compares live indexed evaluations and final portfolio behavior against the frozen TS implementation. Benchmark it separately under matched conditions; current aggregate measurements have not established a significant whole-board speedup.

Native evaluation counters are merged into Pipeline9 totals after the portfolio completes. The adapter caches final output and releases the Rust solver on completion or failure, breaking the cross-runtime reference cycle created by the validation callback. Evaluator elapsed time is measured only when a clock has been installed; the WASM binding supplies that clock.

The standalone `GlobalDrcForceImproveSolver` also has a persistent native stage bridge in `autorouter-bindings/src/global_drc_bridge.rs`. Its default evaluator uses the repair03 route conversion in `src/standalone_global_drc/convert_hd_route_to_simplified_route.rs`, including exact layer-transition, width and endpoint-port rules. Explicit custom evaluators, supplied DRC engines and reference evaluators continue to use their original TypeScript callback contracts. The TypeScript facade retains constructor behavior and visualization; the search and acceptance loop run in Rust.

Route packets preserve observed outer arrays, route objects, point arrays and point objects. Explicit callback/public mutations are sent back before subsequent native reads; immutable native route versions keep references alive across callbacks. Ordinary native candidate evaluations do not serialize route packets. Focused checks include `global-force-stage-parity.ts`, `global-force-callback-parity.ts`, `global-force-public-api-parity.ts`, `global-force-mutation-parity.ts` and `global-force-captured-parity.ts` under `rust/autorouter-bindings/integration`, with `TSCIRCUIT_TS_REFERENCE` pointing to the independent frozen TypeScript checkout.
