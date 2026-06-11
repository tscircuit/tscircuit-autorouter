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
