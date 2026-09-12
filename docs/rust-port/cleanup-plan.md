# Rust port naming and source correspondence

Historical naming plan. The current entry point is the [experiment overview](README.md); directory/count tables below describe the naming pass, not today's remaining work.

Status: package, binding, adapter, and confirmed orchestration-path migration implemented. See [validation](validation.md) for checks and remaining limitations.

The port should read alongside upstream TypeScript. Preserve source solver names, decomposition, method names, and behavior. Translate casing for Rust, but do not redesign algorithms or remove mutable-object compatibility in this cleanup.

Reference: [upstream main at 109c67b](https://github.com/tscircuit/tscircuit-autorouter/tree/109c67baebc709be95fb37df1fdac9b3b74624c5). See [upstream changes](upstream-changes.md) for differences from the port's merge base and dependency provenance requirements.

## Inventory

[source-map.json](source-map.json) inventories all 229 handwritten Rust files currently present, including examples and tests. It covers uncommitted files as well as committed work. Filename-based matches are explicitly marked as candidates, not verified equivalence. Twenty files still need their exact source or support role identified; module roots also need inspection for mixed implementation and exports. Dependency source candidates were located in existing local installations, not a clean reference installation.

| Current area | Responsibility | Direction |
| --- | --- | --- |
| `rust/tiny-hypergraph` | Ports of main and poly tiny-hypergraph dependencies | Preserve dependency correspondence and identify which revision supplies each module. |
| `rust/high-density` | A01 and A03 from the high-density-a01 dependency | Use the dependency name to explain the family. |
| `rust/general-router` | Repository general and specialized intra-node solvers | Use a scope name covering both kinds; retain individual source names. |
| `rust/drc` | Repair dependency's DRC evaluator and geometry imports | Preserve source decomposition. |
| `rust/repair` | Dependency repair solvers and extracted Pipeline9 evaluation logic | Keep origins explicit in the source map; do not split source helpers based on size alone. |
| `rust/trace-simplification` | Repository simplification solvers, data structures, and identity support | Separate support placement without changing shared-state behavior. |
| `rust/high-density-wasm` | Combined exports plus ported orchestration and cache logic | Rename for autorouter-wide scope; distinguish ported code from bindings internally. |
| `rust/tiny-hypergraph-wasm` | Hypergraph exports and TypeScript adapter | Rename as bindings. |
| `rust/wasm-allocator` | Shared allocation implementation, separate memory per module | Name the memory responsibility without an implementation suffix. |

## Naming rules

1. Source correspondence wins over stylistic cleanup. Keep `MultiHeadPolyLineIntraNodeSolver2`, `SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost`, and source `solverHelpers.ts` decomposition. Keep the upstream `NativeObstacleTree` name in its Rust counterpart: that name was not introduced by this port.
2. No new `Native`, `Wasm`, or `Raw` qualifiers for handwritten solver identities. Do not substitute `Rust` or `Compiled`. Names identify the solver or integration responsibility.
3. Rust algorithms and exported bindings can share domain names through their separate modules. TypeScript can use `import * as bindings` and `bindings.HighDensitySolver` when the public wrapper has the same name. Do not create another prefix convention to resolve collisions.
4. `Adapter` means preserving an existing TypeScript interface. `Codec` means encoding/decoding. `CallbackScope` manages callback ownership. `Supervisor` is reserved for candidate scheduling logic. `Engine` remains where it is part of the source name, such as `AutoroutingDrcEngine`.
5. Preserve actual platform terms in dependency names, `.wasm` extensions, build targets, generated tool internals, and explanations. This is not a textual ban on the word WASM.
6. Do not change externally meaningful wire discriminants, cache schemas, diagnostic solver names, or source-owned identifiers during a mechanical rename. Rename internal call sites together. If an existing port-only exported name has consumers, document and migrate those consumers explicitly rather than leaving indefinite duplicate aliases.

## Package and directory map

These package and directory moves are implemented. The left column records the previous names.

| Current | Proposed | Reason |
| --- | --- | --- |
| `rust/high-density-wasm` / `high-density-wasm` / private `@tscircuit/high-density-wasm` | `rust/autorouter-bindings` / `autorouter-bindings` / private `@tscircuit/autorouter-bindings` | Includes DRC, repair, simplification, and orchestration. |
| `rust/tiny-hypergraph-wasm` / `tiny-hypergraph-wasm` | `rust/tiny-hypergraph-bindings` / `tiny-hypergraph-bindings` | Binding boundary for the dependency port. Match private package name accordingly. |
| `rust/general-router` / `general-router` | `rust/intra-node-routing` / `intra-node-routing` | Covers general, specialized, polyline, and via-possibility solvers. |
| `rust/high-density` / `high-density` | `rust/high-density-a01` / `high-density-a01` | Matches source dependency, which contains A01 and A03. |
| `rust/repair`, crate `broad-repair` | Keep directory; crate `repair` | The crate now contains the full repair portfolio, not only broad repulsion. |
| `rust/wasm-allocator`, crate `wasm-allocator` | `rust/module-allocator`, crate `module-allocator` | Describes per-module allocation responsibility. Keep its actual target restrictions. |
| `lib/wasm` | `lib/bindings` | Initialization and embedded binding assets. |

Do not merge crates or compiled modules. Existing public solver files in `lib/solvers` remain at their source locations. Port-only TypeScript support moves under `lib/bindings/{high-density,repair,trace-simplification,tiny-hypergraph}`. Files already in a private adapter package's `ts/` directory stay there; keep one owner for each adapter rather than duplicating it.

Within the combined binding crate, use `src/bindings/` for boundary exports and `src/ported/` for repository algorithm translations currently under `src/portfolio/` and the cache implementation. Under `ported/`, mirror source directories with Rust casing (`solvers/high_density_solver`, `solvers/hyper_high_density_solver`, and `utils`). Moving these algorithms into another crate can wait; this pass does not alter dependency architecture. Other source crates retain their source-family subdirectories. Resolve remaining candidate mappings before proposing extra directory moves.

## TypeScript class and support map

| Current | Proposed | Placement / explanation |
| --- | --- | --- |
| `WasmHighDensitySolver` | `HighDensitySolverAdapter` | Private adapter package `ts/`; variant wrapper for A01/A03. Do not call it the board-level HighDensitySolver. |
| `WasmSpecializedIntraNodeSolver` | `SpecializedIntraNodeSolverAdapter` | `lib/bindings/high-density`; compatibility base for several source solvers. |
| `WasmPortfolioSupervisor` | `PortfolioSolverAdapter` | `lib/bindings/high-density`; scheduling algorithm stays in its source-named Rust solver. |
| `NativePortfolioExecutionScope` | `PortfolioCallbackScope` | `lib/bindings/high-density`; callback ownership and synchronization scope. |
| `SpecializedCandidateIdentity` | `CandidateIdentityMap` | `lib/bindings/high-density`; candidate and nested-object identity preservation. |
| `getSpecializedRouterContext.ts` | `specializedRouterContext.ts` | `lib/bindings/high-density`; exports both a scope and a context lookup. |
| `WasmCachedIntraNodeRouteSolver` | Remove redundant alias; import `CachedIntraNodeRouteSolver` | Current file is only a renamed re-export. Preserve the actual source-named class. |
| `WasmTraceSimplificationSolver` | `TraceSimplificationSolverAdapter` | `lib/bindings/trace-simplification`; retain public source subclasses. |
| `TraceSimplificationGraphCodec`, `TraceSimplificationIndexCodec` | Keep names | Move support to `lib/bindings/trace-simplification`. |
| `WasmTinyHypergraphPipeline` | `TinyHypergraphPipelineAdapter` | `lib/bindings/tiny-hypergraph`; port-only composition, distinct from source section pipeline solver. |
| `WasmAutoroutingDrcEngine` | `AutoroutingDrcEngine` | `lib/bindings/repair`; matches dependency interface. |
| `WasmRepairPortfolio` | `GlobalDrcBranchPortfolioSolver` | `lib/bindings/repair`; matches the solver being adapted. |
| `WasmBroadRepulsion` | `BroadRepulsionAdapter` | `lib/bindings/repair`; adapts function-based dependency hooks. |
| `WasmTargetedRepair` | `TargetedRepairAdapter` | `lib/bindings/repair`; adapts force and placement hooks. |
| Port-added `GlobalDrcForceImproveSolver` | Keep name | Move integration implementation to `lib/bindings/repair`, unless imports require a forwarding source entry point. |
| `highDensityBackend.ts` | `highDensitySolverFactory.ts` | Factory plus type guard, not a selectable backend. |
| `drcBackend.ts` | `autoroutingDrcEngineFactory.ts` | Factory and interface types. |
| `repairPortfolioBackend.ts` | `repairPortfolio.ts` | Construction and shared integration types. |
| `broadRepulsionBackend.ts` | `broadRepulsionRegistration.ts` | Re-exports a dependency patch contract. Keep contract names consistent with the patch; do not silently rename external exports. |

## Exported Rust binding names

Use corresponding snake_case module filenames under `src/bindings/`. Source algorithm types retain their existing upstream-derived identities and are module-qualified inside bindings.

| Current export | Proposed export |
| --- | --- |
| `NativeHighDensitySolver` | `HighDensitySolver` |
| Existing A01/A03 binding `HighDensitySolver` | `HighDensityCandidateSolver` |
| `NativeGrowShrinkHighDensitySolver` | `GrowShrinkHighDensityIntraNodeSolver` |
| `NativeHighDensityPortfolio` | `PortfolioSingleIntraNodeSolver` |
| `NativeGlobalDrcForceImproveSolver` | `GlobalDrcForceImproveSolver` |
| `RawRepairPortfolio` | `GlobalDrcBranchPortfolioSolver` |
| `NativeTraceSimplificationSolver` | `TraceSimplificationDispatcher` (it dispatches multiple solver kinds) |
| `GeneralRouter` | `IntraNodeRouteSolver` |
| `GeneralRouterContext` | `IntraNodeRouteContext` |
| `DrcEngine` | `AutoroutingDrcEngine` |
| `SingleRouteBridge` | `SingleHighDensityRouteSolver` |
| `SpecializedHighDensitySolver` | `SpecializedIntraNodeDispatcher` |
| `SpecializedRouterContext` | Keep; context has a distinct responsibility |
| `WasmAllocator` | `ModuleAllocator` |

Replace generic `*_bridge.rs` filenames with their export's domain name where focused. Keep a descriptive multi-export module for orchestration until its two exports can be moved without changing shared helpers. Rename the index bridge to `trace_simplification_index_codec.rs`. Do not split algorithms or combine dispatch implementations as part of naming.

## Fields, methods, initialization, and build surface

- Binding fields named `native` or `raw` become `solver` or `binding`, chosen by what they hold. `nativeSupervisor` becomes `portfolioAdapter`; `getNativeSupervisor` becomes `getPortfolioAdapter`.
- `nativeKind` becomes `solverKind`; `nativeFields` becomes `stateFields`; `nativeValues` becomes `stateValues`; state-transfer methods should describe pushing or synchronizing state. Preserve wire values and source field names.
- `NativeCandidate` in the TS snapshot becomes `PortfolioCandidateSnapshot`; `NativeState` becomes a solver-specific state/snapshot type. The Rust portfolio candidate implementation becomes `PortfolioCandidate`. `NativeRepairCounters` becomes `RepairEvaluationCounters`; `nativeCounters` becomes `getRepairEvaluationCounters`.
- `createWasmHighDensitySolver` and `isWasmHighDensitySolver` become `createHighDensityCandidateSolver` and `isHighDensityCandidateSolver`.
- Embedded synchronous initialization becomes `initializeAutorouterBindings` and `initializeTinyHypergraphBindings`. Keep the standalone asynchronous byte-loading initializer distinct (`loadAutorouterBindings`, `loadTinyHypergraphBindings`). This avoids giving synchronous and asynchronous operations the same name.
- `decodeWasmBase64` becomes `decodeEmbeddedModule`; generated assets become `autorouterModule` and `tinyHypergraphModule`. Generated bindgen basenames follow the renamed crates.
- Audit `enableHighDensityWasm` and analogous explicit initialization exports: migrate internal callers; document any compatibility exports needed by existing users. Do not change initialization semantics during renaming.
- `build:wasm` becomes `build:bindings`; `scripts/embed-wasm.mjs` becomes `scripts/embed-bindings.mjs`; the local prepare action becomes `prepare-bindings`. Update workflows, lockfile package names, README commands, parity imports, ignore paths, and package export paths in the same batch.
- Preserve toolchain settings, allocator parameters, compiled module count, solver lifecycle, error propagation, cache behavior, and mathematical callbacks.

## Execution and review checkpoints

1. Inventory and naming proposal (this document): reference checkout established; source candidates and upstream drift recorded. Remaining source ambiguities are explicit.
2. Resolve provenance and naming-map ambiguities before moving corresponding source files. Review this complete naming proposal before production renames.
3. Apply package/build names and regenerate binding output. Run local build and declaration checks. Follow the repository's explicit local-validation policy; Blacksmith is reserved for benchmarks.
4. Rename adapters, exported binding types, and internal state names; relocate integration support. Keep changes mechanical and review with rename-aware diffs. Run focused lifecycle, identity, error-propagation, and adapter checks.
5. Move source-corresponding modules only after their mappings are confirmed. Record any necessary source-path exceptions; do not guess correspondence from filenames.
6. Run relevant parity checks with independently installed reference dependencies. Treat main-vs-base behavior differences as separate findings, not reasons to modify algorithms inside a rename batch.
7. Update this document and source map to the implemented paths and report checks actually run. No PR creation, commits, or publishing are part of this kickoff.

Implementation completed the approved package and adapter moves. The source map now records both current and previous paths. Source ambiguities remain explicitly marked; algorithms were not moved speculatively. See validation.md for completed checks and pre-existing failures.

## Implementation notes

- Also removed the existing port-only `Rust` prefix: the low-level tiny-hypergraph binding now exports `TinyHyperGraphSolver`, while `TinyHypergraphSearchStage` and `EmptySectionStage` name adapter stages. These changes do not alter their source-derived `getSolverName()` results.
- Existing `NativeObstacleTree`, its source-owned fields, wire tags such as `native`, metadata keys, and diagnostic error text are preserved. Remaining platform words in those contexts are intentional.
- Ported orchestration modules follow confirmed upstream paths under `src/ported/`. Boundary modules are under `src/bindings/`; mixed crate-root exports remain in `src/lib.rs` to avoid a broader rewrite.
- The cached-solver alias was removed. Its users import the original `CachedIntraNodeRouteSolver` directly.
- All repository callers of explicit initialization exports were migrated. The root public package did not export the old enable functions; no compatibility aliases were added to these private/internal APIs.
- Validation uses local tools per the repository policy. No formatter, linter, commit, push, PR, or benchmark was run.
