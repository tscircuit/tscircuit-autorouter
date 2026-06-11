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
