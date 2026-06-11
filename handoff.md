# Tiny-Hypergraph Memory Handoff

## 2026-06-11 duplicate-port prepass pass
- Scope: investigate and reduce the `after-duplicateCongestedPortPrepass` heap spike seen from the autorouter wrapper path in this repo.
- Real source edited: `/home/ohmx/Documents/tiny-hypergraph`.
- Repo-local verification path preserved: resynced with `bun install` and reran the harness from this repo.

## What Changed
- [DuplicateCongestedPortSolver.ts](/home/ohmx/Documents/tiny-hypergraph/lib/DuplicateCongestedPortSolver.ts:1)
- Replaced full recursive cloning of every region, port, and connection with copy-on-write for the revised graph.
- Kept deep cloning only for new duplicate-port payloads to avoid nested metadata aliasing.
- Stopped recursively cloning `connections`; the returned graph now uses a shallow copied connection array.
- [TinyHyperGraphSectionPipelineSolver.ts](/home/ohmx/Documents/tiny-hypergraph/lib/section-solver/TinyHyperGraphSectionPipelineSolver.ts:321)
- Skip `optimizeSection` entirely when the computed section mask is empty.
- Cache section-stage params so the skip path does not recompute setup work.
- [tinyhypergraph-portpoint-constructor-memory-regression.test.ts](/home/ohmx/Documents/tscircuit-autorouter/tests/repro/tinyhypergraph-portpoint-constructor-memory-regression.test.ts:1)
- Added stable regression coverage for the constructor prepass path without relying on a brittle raw memory threshold.

## Verification
- `bun test ./tests/repro/tinyhypergraph-portpoint-memory-profile.test.ts`
- `bun test ./tests/repro/tinyhypergraph-portpoint-constructor-memory-regression.test.ts`
- `bun scripts/analyze-portpoint-tiny-memory.ts --runs 1 --output-root ./ai-artifacts/memory-analysis/pipeline7-srj18-sample001/deep-portpoint-tiny-postfix3`

## Latest Measured Result
- Artifact root: `./ai-artifacts/memory-analysis/pipeline7-srj18-sample001/deep-portpoint-tiny-postfix3`
- `before-duplicateCongestedPortPrepass`: `71.7 MiB` heap after GC.
- `after-duplicateCongestedPortPrepass`: `778.5 MiB` heap after GC.
- Constructor jump on this run: `+706.7 MiB`.
- `solveGraph` still releases about `467.5 MiB`, so the constructor/prepass remains the dominant source.
- `optimizeSection` now reports `sectionOptimizationSkipped=true`, `sectionOptimizationReason="empty-section-mask"`, and `timeSpent=0`.
- Final retained heap after solve remains about `370.6 MiB`.

## Sub-Agent Findings Worth Keeping
- Explorer review confirmed the original dominant issue was full-graph duplication in `DuplicateCongestedPortSolver`.
- Explorer review also confirmed pipeline 4 always feeds an empty section mask, so section-stage work was dead for this path.
- Review caveat already addressed: cached section params were needed so the skip path did not run stage setup twice.
- Review caveat already addressed: duplicate-port payloads needed deep cloning to avoid nested metadata aliasing.

## Remaining Likely Hotspots
- The prepass still solves each route independently through `TinyHyperGraphSolver`, which allocates large route-solver state repeatedly.
- `loadSerializedHyperGraph()` still materializes a second object-heavy topology view during the prepass.
- The constructor still holds multiple representations alive across `buildSerializedTinyGraph`, prepass output, and pipeline input creation.

## Recommended Next Pass
- Instrument inside `DuplicateCongestedPortSolver.getPortUseCounts()` to split retained vs transient cost for `loadSerializedHyperGraph()` versus the per-route `TinyHyperGraphSolver` loop.
- Prototype a lighter-weight congested-port usage counter that avoids constructing a full `TinyHyperGraphSolver` for every route.
- Audit `loadSerializedHyperGraph()` metadata cloning, especially if large serialized metadata objects are being copied but not read by the prepass.

## 2026-06-11 duplicate-port prepass collapse pass
- Scope: keep the repo-local tiny-hypergraph code path, reduce constructor retained heap further, and re-check for obvious regressions with delegated review.
- Real source edited: `/home/ohmx/Documents/tiny-hypergraph`.
- Repo-local wrapper edited: [TinyHypergraphPortPointPathingSolver.ts](/home/ohmx/Documents/tscircuit-autorouter/lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver.ts:1).

## What Changed
- [DuplicateCongestedPortSolver.ts](/home/ohmx/Documents/tiny-hypergraph/lib/DuplicateCongestedPortSolver.ts:1)
- Kept the earlier copy-on-write graph rewrite.
- Enabled `USE_LAZY_ROUTE_HEURISTIC` and `USE_SPARSE_CANDIDATE_STORAGE` for the duplicate-port prepass's per-route `TinyHyperGraphSolver` runs only.
- Preserved the prepass's normal solve options otherwise, so the main `solveGraph` path is unchanged.
- [TinyHypergraphPortPointPathingSolver.ts](/home/ohmx/Documents/tscircuit-autorouter/lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver.ts:1)
- Stopped eagerly materializing `inputNodeWithPortPoints` in the constructor.
- The wrapper now keeps the serialized graph reference and builds `inputNodeWithPortPoints` lazily on first `getOutput()`.
- Memory instrumentation still records the constructor checkpoint, now marked as deferred, and records the actual input-node materialization when `getOutput()` runs.

## Verification
- `bun test ./tests/repro/tinyhypergraph-portpoint-memory-profile.test.ts`
- `bun test ./tests/repro/tinyhypergraph-portpoint-constructor-memory-regression.test.ts`
- `bun scripts/analyze-portpoint-tiny-memory.ts --runs 1 --output-root ./ai-artifacts/memory-analysis/pipeline7-srj18-sample001/deep-portpoint-tiny-postfix8`

## Latest Measured Result
- Artifact root: `./ai-artifacts/memory-analysis/pipeline7-srj18-sample001/deep-portpoint-tiny-postfix8`
- `before-duplicateCongestedPortPrepass`: `71.7 MiB` heap after GC.
- `after-duplicateCongestedPortPrepass`: `88.3 MiB` heap after GC.
- Constructor jump on this run: `+16.7 MiB`.
- Previous comparable run in `deep-portpoint-tiny-postfix3`: `+706.7 MiB`.
- Final retained heap after solve is still about `365.0 MiB`, so the dominant retained allocation has moved from constructor/prepass into `solveGraph`.
- `inputNodeWithPortPoints` is no longer retained during constructor; it is built at `solver:getOutput:after-buildInputNodesWithPortPoints`.

## Delegated Review Notes
- Source review found the biggest remaining structural risk is still full metadata/object duplication inside `loadSerializedHyperGraph()`, which is likely the next large memory lever after the constructor fix.
- Data-shape review confirmed the raw input is only about `3.8 MiB`, while the old prepass spike was about `3.5 MiB` per duplicated port, which reinforces that the issue was solver-state amplification rather than port duplication payload size.
- Independent regression review recommended adding immutability coverage in tiny-hypergraph itself and direct coverage for the empty-section-mask skip path.

## Residual Risks
- [tinyhypergraph-port-bridge-repro.test.ts](/home/ohmx/Documents/tscircuit-autorouter/tests/features/tinyhypergraph-port-bridge-repro.test.ts:1) currently fails as a snapshot test against the linked tiny-hypergraph checkout, but I did not establish a clean pre-change baseline for that fixture in this session.
- The remaining large retained heap now sits in `solveGraph`; the constructor/prepass is no longer the main source.

## 2026-06-11 solveGraph metadata-view pass
- Scope: continue from the duplicate-prepass fix, test ideas in a dedicated worktree, and see whether loader/section-pipeline duplication could reduce the retained `solveGraph` plateau without a major solver rewrite.
- Worktree used: `/tmp/tiny-hypergraph-mem-next` on branch `codex/tiny-mem-next`.
- Real source edited: `/home/ohmx/Documents/tiny-hypergraph`.
- Repo-local dependency copy synced for verification: `/home/ohmx/Documents/tscircuit-autorouter/node_modules/tiny-hypergraph`.

## What Changed
- [loadSerializedHyperGraph.ts](/home/ohmx/Documents/tiny-hypergraph/lib/compat/loadSerializedHyperGraph.ts:1)
- Replaced eager shallow cloning of region and port metadata objects with prototype-backed metadata views using `Object.create(...)`.
- This keeps metadata lookups behaviorally compatible for solver/visualization consumers while avoiding a second full metadata shell allocation per region and port during load.
- [convertToSerializedHyperGraph.ts](/home/ohmx/Documents/tiny-hypergraph/lib/compat/convertToSerializedHyperGraph.ts:1)
- Replaced object-spread cloning in `toObjectRecord()` with explicit enumerable-key copying so inherited metadata fields from the prototype-backed views still serialize back out.
- [TinyHyperGraphSectionPipelineSolver.ts](/home/ohmx/Documents/tiny-hypergraph/lib/section-solver/TinyHyperGraphSectionPipelineSolver.ts:1)
- [index.ts](/home/ohmx/Documents/tiny-hypergraph/lib/section-solver/index.ts:1)
- Exported `createSolvedSolverFromSolution(...)` and used it for candidate replay scoring instead of constructing a full `TinyHyperGraphSectionSolver` just to inspect replayed max-region-cost.
- [layer-label.test.ts](/home/ohmx/Documents/tiny-hypergraph/tests/compat/layer-label.test.ts:1)
- Added regression coverage to prove custom region/port metadata survives the metadata-view path and still appears in serialized output.

## Verification
- `bun test tests/compat/layer-label.test.ts tests/solver/get-output-roundtrip.test.ts tests/solver/section-solver.test.ts`
- `bun test ./tests/repro/tinyhypergraph-portpoint-memory-profile.test.ts ./tests/repro/tinyhypergraph-portpoint-constructor-memory-regression.test.ts`
- `bun scripts/analyze-portpoint-tiny-memory.ts --runs 1 --output-root ./ai-artifacts/memory-analysis/pipeline7-srj18-sample001/deep-portpoint-tiny-postfix9`

## Latest Measured Result
- Artifact root: `./ai-artifacts/memory-analysis/pipeline7-srj18-sample001/deep-portpoint-tiny-postfix9`
- `before-duplicateCongestedPortPrepass`: about `71.1 MiB` heap after GC.
- `after-duplicateCongestedPortPrepass`: about `83.3 MiB` heap after GC.
- Constructor jump on this run: about `+12.2 MiB`.
- Previous comparable run in `deep-portpoint-tiny-postfix8`: about `+16.7 MiB`.
- `solveGraph` retained heap checkpoint moved slightly in the wrong direction: about `306.2 MiB -> 309.2 MiB`.
- Final retained heap after solve stayed effectively flat: about `365.0 MiB -> 364.1 MiB`.

## Interpretation
- The metadata-view change is valid and lower-churn, but it is not the next big lever for retained memory on this path.
- The replay-scoring shortcut removes a whole `TinyHyperGraphSectionSolver` construction from section-candidate evaluation, which is still worth keeping as a transient-cost reduction.
- The main retained-memory issue is now structural stage retention: the section pipeline and section solver keep multiple solved/replayed forms alive at once.

## Recommended Next Pass
- Target stage retention in [TinyHyperGraphSectionPipelineSolver.ts](/home/ohmx/Documents/tiny-hypergraph/lib/section-solver/TinyHyperGraphSectionPipelineSolver.ts:1) and [section-solver/index.ts](/home/ohmx/Documents/tiny-hypergraph/lib/section-solver/index.ts:1), not more loader micro-optimizations.
- Most promising direction:
- Introduce an opt-in release mode that drops `solveGraph` solver/output and `cachedSectionStageParams` once `optimizeSection` has what it needs, while preserving current debug behavior by default.
- Add an explicit post-solve release step in `TinyHyperGraphSectionSolver` / `TinyHyperGraphSectionSearchSolver` to clear large working snapshots once summaries and final output are fixed.
- If you want a lower-risk first slice, start with a dedicated `releaseWorkingState()` path behind a debug-retention option instead of changing default pipeline introspection semantics.

## 2026-06-11 compact hop-slot storage pass (solveGraph plateau eliminated)
- Scope: find and remove the dominant retained `solveGraph` allocation flagged by the previous pass.
- Real source edited: `/home/ohmx/Documents/tiny-hypergraph` (uncommitted working-tree changes, same as prior passes).
- Repo-local dependency copy synced by file copy into `/home/ohmx/Documents/tscircuit-autorouter/node_modules/tiny-hypergraph` (the dep is a pinned git copy, not a symlink — re-running `bun install` will OVERWRITE the synced patches; re-sync `lib/core.ts`, `lib/DuplicateCongestedPortSolver.ts`, `lib/section-solver/*`, `lib/compat/*` if that happens).

## Root Cause Found
- `TinyHyperGraphSolver` allocated `candidateBestCostByHopId` (Float64Array) and `candidateBestCostGenerationByHopId` (Uint32Array) sized `portCount * regionCount` — ~312 MiB for srj18 sample001 (14461 x 1802) — but `getHopId(portId, nextRegionId)` is only ever called with `nextRegionId` in `incidentPortRegion[portId]` (<=2 regions per port). 26M slots allocated, ~29k reachable.

## What Changed
- [core.ts](/home/ohmx/Documents/tiny-hypergraph/lib/core.ts:1)
- `getHopId` now returns `portId * hopSlotStride + slot` where `slot = incidentPortRegion[portId].indexOf(nextRegionId)` and `hopSlotStride` = max incident-region count (computed once in the constructor). Arrays shrink ~312 MiB -> ~0.4 MiB per solver instance.
- Non-incident hops (possible only on exotic bus-solver goal candidates) encode as negative ids handled by a small `hopOverflowBestCost` Map, cleared in `resetCandidateBestCosts()`.
- New `releaseTransientSearchState()`: drops `_problemSetup` (incl. eager ~18.9 MiB `portHCostToEndOfRoute`), the overflow map, `bestSolvedStateSnapshot`, and clears the candidate queue. Safe by construction: `problemSetup` is a lazy getter that rebuilds on demand.
- [DuplicateCongestedPortSolver.ts](/home/ohmx/Documents/tiny-hypergraph/lib/DuplicateCongestedPortSolver.ts:317)
- Removed `USE_SPARSE_CANDIDATE_STORAGE: true` from prepass per-route solve options; compact dense arrays now beat Maps on both memory and speed.
- [TinyHyperGraphSectionPipelineSolver.ts](/home/ohmx/Documents/tiny-hypergraph/lib/section-solver/TinyHyperGraphSectionPipelineSolver.ts:393)
- Added `onSolved` hooks: solveGraph releases its transient search state; optimizeSection calls the section solver's release and clears `cachedSectionStageParams`.
- Empty-section-mask skip path now also clears `cachedSectionStageParams` (it loaded a full topology/problem/solution view just to count the mask).
- [section-solver/index.ts](/home/ohmx/Documents/tiny-hypergraph/lib/section-solver/index.ts:1070)
- New `TinyHyperGraphSectionSolver.releaseTransientSearchState()`: drops `sectionSolver` (search solver incl. `bestSnapshot`/`fixedSnapshot`), nulls `activeSubSolver`, and releases baseline/optimized solvers' transient state. Only runs when solved and not failed; `visualize()`/`getOutput()` still work via `optimizedSolver`/`baselineSolver`.

## Measured Results (postfix16 vs postfix9 baseline, srj18 sample001)
- Final retained heap after getOutput: ~364.1 MiB -> ~113.1-114.8 MiB (-69%).
- Final RSS: ~740 MiB -> ~397-400 MiB (-46%).
- Runtime: ~11.2s -> ~10.5-10.6s (no regression; slightly faster).
- True settled-GC retained heap is ~76.6 MiB per [debug-portpoint-retention.ts](/home/ohmx/Documents/tscircuit-autorouter/scripts/debug-portpoint-retention.ts:1); the harness's single `Bun.gc(true)` under-collects ~35 MiB. Use that script (multi-GC + event-loop yields) for attribution work; the harness numbers are only comparable to other harness numbers.

## Verification
- `bun run typecheck` and `bun test` (91 pass / 0 fail) in `/home/ohmx/Documents/tiny-hypergraph`.
- `bun test ./tests/repro/tinyhypergraph-portpoint-memory-profile.test.ts ./tests/repro/tinyhypergraph-portpoint-constructor-memory-regression.test.ts` (2 pass).
- Adversarial review agent tried to refute the hop encoding on 6 axes (incidence invariants, id collisions, generation-counter semantics, sparse path, stride edge cases, prepass change) — all HOLD.
- `tests/features/tinyhypergraph-port-bridge-repro.test.ts` still fails (pre-existing snapshot failure, documented in the previous pass; no clean baseline exists).

## Dead Ends Worth Remembering
- `USE_LAZY_ROUTE_HEURISTIC: true` as pipeline default saved ~20 MiB retained but cost ~2s (~19%) inside the solveGraph A* hot loop (per-candidate `Math.hypot` vs precomputed lookup). Reverted; eager heuristic + post-solve release gets the memory back with zero runtime cost.

## Remaining Smaller Targets
- Duplicate-port prepass constructor delta is now ~+10-12 MiB (`duplicateCongestedPortReport`, revised serialized graph, `graphForInputNodes` in the wrapper).
- solveGraph-era retained ~+25-32 MiB is mostly the loaded topology/problem (~12.6 MiB, required by `getOutput()`), serialized stage output (~3 MiB), and wrapper-held input nodes/params (~10 MiB) — all needed or small; diminishing returns here.
- The tiny-hypergraph working tree still holds ALL passes uncommitted (metadata-view pass + this pass). To ship: commit there, push, and bump the pinned git hash in this repo's package.json (current pin: 4de0fda).
