# Progress

## 2026-06-11T00:00:00.000Z bootstrap
- Started pipeline 7 memory analysis for `srj18` sample `001`.
- No pre-existing `progress.md` was present, so this file is now the append-only log.
- Pending: implement phase-by-phase heap snapshots, solver input/output summaries, repeated runs, saved handoffs, and a scoped regression test.

## 2026-06-11T03:04:42.250Z pipeline7 srj18 sample001 run-start
- Target: `srj18` sample `001` (sample001).
- Planned runs: 1.
- Output root: `./ai-artifacts/memory-analysis/pipeline7-srj18-sample001`.

## 2026-06-11T03:05:16.309Z pipeline7 srj18 sample001 run-start
- Target: `srj18` sample `001` (sample001).
- Planned runs: 1.
- Output root: `./ai-artifacts/memory-analysis/pipeline7-srj18-sample001`.

## 2026-06-11T03:06:47.427Z pipeline7 srj18 sample001 latest-finding
- Completed 1 run(s). Latest run: `run-001`.
- Latest status: solved=true failed=false error=none.
- Latest artifacts: `./ai-artifacts/memory-analysis/pipeline7-srj18-sample001/run-001`.
- Rollup: `./ai-artifacts/memory-analysis/pipeline7-srj18-sample001/rollup.json`.

## 2026-06-11T03:07:40.754Z pipeline7 srj18 sample001 run-start
- Target: `srj18` sample `001` (sample001).
- Planned runs: 1.
- Existing runs before start: 1.
- Output root: `./ai-artifacts/memory-analysis/pipeline7-srj18-sample001`.

## 2026-06-11T03:09:12.522Z pipeline7 srj18 sample001 latest-finding
- Completed 1 run(s). Latest run: `run-002`.
- Latest status: solved=true failed=false error=none.
- Latest artifacts: `./ai-artifacts/memory-analysis/pipeline7-srj18-sample001/run-002`.
- Rollup: `./ai-artifacts/memory-analysis/pipeline7-srj18-sample001/rollup.json`.

## 2026-06-11T03:10:10.106Z pipeline7 srj18 sample001 synthesized-findings
- Completed 2 full runs with 19 phase-level heap snapshots each.
- Largest retained-heap jump is `portPointPathingSolver` at about +560 MiB versus the prior stage in both runs.
- Highest retained heap is `highDensityForceImproveSolver` at about 655 MiB; `highDensityRouteSolver` is next at about 638 MiB.
- `highDensityRepairSolver` drops retained heap by about 55 MiB immediately after stage 14.
- Longest phases are `highDensityRouteSolver`, `portPointPathingSolver`, `traceSimplificationSolver`, and `highDensityForceImproveSolver`.
- Summary: `./ai-artifacts/memory-analysis/pipeline7-srj18-sample001/latest-findings.md`.
- Phase comparison: `./ai-artifacts/memory-analysis/pipeline7-srj18-sample001/phase-comparison.json`.

## 2026-06-11T09:05:00.000Z tiny-hypergraph deep-portpoint harness
- Added constructor-phase memory checkpoints to [TinyHypergraphPortPointPathingSolver.ts](/home/ohmx/Documents/tscircuit-autorouter/lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver.ts:77) behind an injected `__memoryInstrumentation` callback so production behavior stays unchanged.
- Added isolated tiny-hypergraph harness [analyze-portpoint-tiny-memory.ts](/home/ohmx/Documents/tscircuit-autorouter/scripts/analyze-portpoint-tiny-memory.ts:1) and bounded regression test [tinyhypergraph-portpoint-memory-profile.test.ts](/home/ohmx/Documents/tscircuit-autorouter/tests/repro/tinyhypergraph-portpoint-memory-profile.test.ts:1).
- Saved sub-agent handoffs:
- [agent-turing-tiny-benchmark-survey.md](/home/ohmx/Documents/tscircuit-autorouter/ai-artifacts/memory-analysis/pipeline7-srj18-sample001/handoffs/agent-turing-tiny-benchmark-survey.md:1)
- [agent-aquinas-portpoint-boundary.md](/home/ohmx/Documents/tscircuit-autorouter/ai-artifacts/memory-analysis/pipeline7-srj18-sample001/handoffs/agent-aquinas-portpoint-boundary.md:1)
- [agent-huygens-existing-findings.md](/home/ohmx/Documents/tscircuit-autorouter/ai-artifacts/memory-analysis/pipeline7-srj18-sample001/handoffs/agent-huygens-existing-findings.md:1)

## 2026-06-11T09:18:00.000Z tiny-hypergraph deep-portpoint findings
- Corrected the first draft harness after noticing cross-run heap contamination from reusing one process; final 3-run sweep now uses one fresh Bun child process per run.
- New isolated artifacts are in `./ai-artifacts/memory-analysis/pipeline7-srj18-sample001/deep-portpoint-tiny`.
- Stable result: the dominant retained-heap jump is now inside the constructor at `after-duplicateCongestedPortPrepass`, averaging about `+680 MiB` after GC, before the first tiny-hypergraph solve step.
- The first `solveGraph` step releases about `440 MiB` of JS heap, which points to constructor-era graph duplication rather than long-lived solve state as the main source of the spike.
- `optimizeSection` is negligible here: about `0.9ms` and `+59 MiB`; final retained memory after solve stays near `371 MiB` heap and `742 MiB` RSS, and `getOutput()` adds effectively nothing.
- Duplicate-port prepass consistently duplicated about `201` ports across `115` source ports.
- Tiny-hypergraph stock benchmark mismatch: running [port-point-pathing-section-pipeline.ts](/home/ohmx/Documents/tiny-hypergraph/scripts/benchmarking/port-point-pathing-section-pipeline.ts:1) from this repo with the extracted input failed with `TinyHyperGraphSectionPipelineSolver ran out of iterations`, so the stock benchmark path is not equivalent to the wrapped autorouter path.
- References:
- [deep-portpoint latest-findings.md](/home/ohmx/Documents/tscircuit-autorouter/ai-artifacts/memory-analysis/pipeline7-srj18-sample001/deep-portpoint-tiny/latest-findings.md:1)
- [deep-portpoint rollup.json](/home/ohmx/Documents/tscircuit-autorouter/ai-artifacts/memory-analysis/pipeline7-srj18-sample001/deep-portpoint-tiny/rollup.json:1)

## 2026-06-11T12:15:00.000Z tiny-hypergraph memory reduction pass
- Patched the real linked checkout at `/home/ohmx/Documents/tiny-hypergraph` and resynced this repo with `bun install`, so all verification still ran through the repo-local dependency path.
- In [DuplicateCongestedPortSolver.ts](/home/ohmx/Documents/tiny-hypergraph/lib/DuplicateCongestedPortSolver.ts:1), replaced full-graph deep cloning with copy-on-write for `regions` and `ports`; only touched region `pointIds` arrays and duplicate-port payloads are cloned deeply now, and `connections` are no longer recursively cloned.
- In [TinyHyperGraphSectionPipelineSolver.ts](/home/ohmx/Documents/tiny-hypergraph/lib/section-solver/TinyHyperGraphSectionPipelineSolver.ts:321), added an early skip for `optimizeSection` when the computed section mask is empty and cached section-stage params so the skip path does not recompute stage setup.
- Added stable constructor-path regression coverage in [tinyhypergraph-portpoint-constructor-memory-regression.test.ts](/home/ohmx/Documents/tscircuit-autorouter/tests/repro/tinyhypergraph-portpoint-constructor-memory-regression.test.ts:1).
- Verification passed:
- `bun test ./tests/repro/tinyhypergraph-portpoint-memory-profile.test.ts`
- `bun test ./tests/repro/tinyhypergraph-portpoint-constructor-memory-regression.test.ts`
- Latest isolated artifact: `./ai-artifacts/memory-analysis/pipeline7-srj18-sample001/deep-portpoint-tiny-postfix3`.
- Result on that run: constructor retained heap at `after-duplicateCongestedPortPrepass` dropped to about `778.5 MiB` after GC, or about `+706.7 MiB` from the prior checkpoint.
- Result on that run: `optimizeSection` is now explicitly skipped with `sectionOptimizationReason="empty-section-mask"` and `stageStats.optimizeSection.timeSpent=0`, but retained heap after solve is still about `370.6 MiB`.
- Net: the fixes removed unnecessary cloning and dead section work, but they did not eliminate the dominant constructor spike; the remaining large allocation still sits inside the duplicate-port prepass path before `solveGraph`.

## 2026-06-11T15:45:00.000Z tiny-hypergraph duplicate-prepass collapse
- Kept the repo-local tiny-hypergraph path and delegated three side reviews; findings are summarized in [handoff.md](/home/ohmx/Documents/tscircuit-autorouter/handoff.md:1).
- In [DuplicateCongestedPortSolver.ts](/home/ohmx/Documents/tiny-hypergraph/lib/DuplicateCongestedPortSolver.ts:1), kept the copy-on-write duplicate-port rewrite and enabled `USE_LAZY_ROUTE_HEURISTIC` plus `USE_SPARSE_CANDIDATE_STORAGE` only for the prepass's per-route `TinyHyperGraphSolver` runs.
- In [TinyHypergraphPortPointPathingSolver.ts](/home/ohmx/Documents/tscircuit-autorouter/lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver.ts:1), deferred `inputNodeWithPortPoints` materialization until `getOutput()` so the constructor no longer holds that second full port-point view alive.
- Verification passed:
- `bun test ./tests/repro/tinyhypergraph-portpoint-memory-profile.test.ts`
- `bun test ./tests/repro/tinyhypergraph-portpoint-constructor-memory-regression.test.ts`
- `bun scripts/analyze-portpoint-tiny-memory.ts --runs 1 --output-root ./ai-artifacts/memory-analysis/pipeline7-srj18-sample001/deep-portpoint-tiny-postfix8`
- Latest isolated artifact: `./ai-artifacts/memory-analysis/pipeline7-srj18-sample001/deep-portpoint-tiny-postfix8`
- Result on that run: constructor retained heap at `after-duplicateCongestedPortPrepass` is about `88.3 MiB` after GC, or about `+16.7 MiB` from the prior checkpoint.
- Comparison to the prior constructor baseline in `deep-portpoint-tiny-postfix3`: about `+706.7 MiB -> +16.7 MiB`, a reduction of roughly `690 MiB`.
- Result on that run: final retained heap after solve is still about `365.0 MiB`, so the dominant retained allocation has moved from the constructor/prepass into `solveGraph`.
- Additional review signal:
- Raw extracted input is only about `3.8 MiB`, which reinforces that the old spike was solver-state amplification rather than payload size.
- Remaining likely next target is metadata/object duplication in `loadSerializedHyperGraph()` and the main `solveGraph` working state, not the duplicate-port constructor prepass.

## 2026-06-11T12:06:05+05:30 tiny-hypergraph solvegraph metadata-view pass
- Created an isolated git worktree at `/tmp/tiny-hypergraph-mem-next` on branch `codex/tiny-mem-next`, used that worktree for patch iteration, then synced the winning patch back into `/home/ohmx/Documents/tiny-hypergraph` and the repo-local `node_modules/tiny-hypergraph` copy used by this autorouter workspace.
- In [loadSerializedHyperGraph.ts](/home/ohmx/Documents/tiny-hypergraph/lib/compat/loadSerializedHyperGraph.ts:1), replaced eager shallow cloning of `region.d` / `port.d` metadata with lightweight metadata views backed by `Object.create(...)`; these still expose all original fields for visualization and routing but avoid allocating a second full metadata shell per region/port up front.
- In [convertToSerializedHyperGraph.ts](/home/ohmx/Documents/tiny-hypergraph/lib/compat/convertToSerializedHyperGraph.ts:1), switched metadata copying from object spread to explicit enumerable-key copying so prototype-backed metadata still round-trips with all inherited custom fields preserved.
- In [TinyHyperGraphSectionPipelineSolver.ts](/home/ohmx/Documents/tiny-hypergraph/lib/section-solver/TinyHyperGraphSectionPipelineSolver.ts:1) and [index.ts](/home/ohmx/Documents/tiny-hypergraph/lib/section-solver/index.ts:1), replaced replay scoring that built a whole `TinyHyperGraphSectionSolver` just to read `baselineSolver` max-region-cost with direct `createSolvedSolverFromSolution(...)` replay scoring.
- Added regression coverage in [layer-label.test.ts](/home/ohmx/Documents/tiny-hypergraph/tests/compat/layer-label.test.ts:1) to ensure serialized output still preserves custom region/port metadata fields under the prototype-backed metadata path.
- Verification passed:
- `bun test tests/compat/layer-label.test.ts tests/solver/get-output-roundtrip.test.ts tests/solver/section-solver.test.ts` in `/home/ohmx/Documents/tiny-hypergraph`
- `bun test ./tests/repro/tinyhypergraph-portpoint-memory-profile.test.ts ./tests/repro/tinyhypergraph-portpoint-constructor-memory-regression.test.ts`
- `bun scripts/analyze-portpoint-tiny-memory.ts --runs 1 --output-root ./ai-artifacts/memory-analysis/pipeline7-srj18-sample001/deep-portpoint-tiny-postfix9`
- Latest isolated artifact: `./ai-artifacts/memory-analysis/pipeline7-srj18-sample001/deep-portpoint-tiny-postfix9`
- Result on that run: constructor retained heap at `after-duplicateCongestedPortPrepass` improved slightly from about `88.3 MiB` to about `83.3 MiB` after GC, or from about `+16.7 MiB` to about `+12.2 MiB` versus the prior checkpoint.
- Result on that run: `solveGraph` retained heap increased slightly from about `306.2 MiB` to about `309.2 MiB`, and final retained heap after solve stayed effectively flat at about `365.0 MiB -> 364.1 MiB`.
- Net: this pass reduced metadata churn and candidate replay overhead, but it did not materially change the dominant retained `solveGraph` plateau; the next meaningful target is stage/solver state retention rather than more loader micro-optimizations.

## 2026-06-11T12:53:00+05:30 tiny-hypergraph compact hop-slot storage (the big win)
- Found the root cause of the retained `solveGraph` plateau via three parallel explore agents: `TinyHyperGraphSolver` allocated dense A* best-cost arrays sized `portCount * regionCount` (`candidateBestCostByHopId` Float64Array ~199 MiB + `candidateBestCostGenerationByHopId` Uint32Array ~99 MiB for 14461 ports x 1802 regions), but a hop's `nextRegionId` is always one of the port's <=2 incident regions, so only ~29k of the 26M slots were reachable.
- In [core.ts](/home/ohmx/Documents/tiny-hypergraph/lib/core.ts:1), re-keyed `getHopId` to `portId * hopSlotStride + incidentRegionSlot` (stride = max incident regions per port, typically 2), shrinking both arrays from ~312 MiB to ~0.4 MiB per solver instance; non-incident hops (defensive case) encode as negative ids routed to a tiny `hopOverflowBestCost` Map cleared on every `resetCandidateBestCosts()`.
- An adversarial review agent attempted to refute the encoding on 6 axes (call-site incidence, collisions, generation semantics, sparse path, stride edge cases, prepass change) and confirmed it HOLDS on all; the per-route bus-solver goal candidates can theoretically be non-incident, which the overflow map handles exactly.
- In [DuplicateCongestedPortSolver.ts](/home/ohmx/Documents/tiny-hypergraph/lib/DuplicateCongestedPortSolver.ts:317), dropped `USE_SPARSE_CANDIDATE_STORAGE: true` for prepass per-route solvers since the compact dense arrays are now strictly better than Maps; prepass constructor delta improved from ~+16.7 to ~+10-12 MiB.
- Added `releaseTransientSearchState()` to [core.ts](/home/ohmx/Documents/tiny-hypergraph/lib/core.ts:683) (drops `_problemSetup` incl. the eager ~18.9 MiB `portHCostToEndOfRoute`, the hop overflow map, `bestSolvedStateSnapshot`, and clears the candidate queue; everything is lazily rebuilt on demand) and wired it into pipeline `onSolved` hooks for both stages in [TinyHyperGraphSectionPipelineSolver.ts](/home/ohmx/Documents/tiny-hypergraph/lib/section-solver/TinyHyperGraphSectionPipelineSolver.ts:393), plus a section-solver-level release in [section-solver/index.ts](/home/ohmx/Documents/tiny-hypergraph/lib/section-solver/index.ts:1070) that drops the section search solver and its snapshots once an optimized solver exists.
- Cleared `cachedSectionStageParams` on the empty-section-mask skip path so the topology/problem/solution view loaded just for the mask check is not retained.
- Tried `USE_LAZY_ROUTE_HEURISTIC: true` as pipeline default (postfix12/13): saved ~20 MiB retained but cost ~2s runtime inside the 9.6s `solveGraph` A* search, so it was reverted in favor of eager-heuristic + post-solve release (no runtime cost).
- Verification passed:
- `bun run typecheck` and `bun test` (91/91) in `/home/ohmx/Documents/tiny-hypergraph`
- `bun test ./tests/repro/tinyhypergraph-portpoint-memory-profile.test.ts ./tests/repro/tinyhypergraph-portpoint-constructor-memory-regression.test.ts`
- `bun scripts/analyze-portpoint-tiny-memory.ts --runs 3 --output-root ./ai-artifacts/memory-analysis/pipeline7-srj18-sample001/deep-portpoint-tiny-postfix16`
- Results (postfix16, 3 runs, vs postfix9 baseline):
- Final retained heap after getOutput: ~364.1 MiB -> ~113.1-114.8 MiB (-69%).
- `solveGraph`-era retained delta: ~+226 MiB -> ~+25-32 MiB.
- Final RSS: ~740 MiB -> ~397-400 MiB (-46%).
- Runtime: ~11.2s -> ~10.5-10.6s (slightly faster; smaller arrays improve locality).
- New attribution diagnostic [debug-portpoint-retention.ts](/home/ohmx/Documents/tscircuit-autorouter/scripts/debug-portpoint-retention.ts:1) shows true settled-GC retained heap is ~76.6 MiB; the harness's single synchronous `Bun.gc(true)` under-collects by ~35 MiB, which also explains run-to-run noise like the 85-92 MiB readings in postfix12. Remaining retained state is legitimately needed: solveGraph topology/problem ~12.6 MiB (read by `getOutput()`), serialized output ~3 MiB, wrapper input nodes/params ~10 MiB.
- Known pre-existing failure unchanged: `tests/features/tinyhypergraph-port-bridge-repro.test.ts` (snapshot, already failing before this pass per handoff residual risks).
## 2026-06-11T07:56:44.366Z pipeline7 srj18 sample001 run-start
- Target: `srj18` sample `001` (sample001).
- Planned runs: 1.
- Existing runs before start: 2.
- Output root: `./ai-artifacts/memory-analysis/pipeline7-srj18-sample001`.

## 2026-06-11T07:58:13.565Z pipeline7 srj18 sample001 latest-finding
- Completed 1 run(s). Latest run: `run-003`.
- Latest status: solved=true failed=false error=none.
- Latest artifacts: `./ai-artifacts/memory-analysis/pipeline7-srj18-sample001/run-003`.
- Rollup: `./ai-artifacts/memory-analysis/pipeline7-srj18-sample001/rollup.json`.

