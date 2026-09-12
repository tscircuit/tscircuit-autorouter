# Long-board CPU profiles

The wider benchmark was canceled at the user's request. These profiles inspect
latest Rust on SRJ18 boards 2, 12 and 13; they do not compare Rust against main.

## Method and parity

Pipeline 9, effort 1, one fresh Bun process per board, run sequentially locally.
Both WASM modules initialize before sampling. CPU sampling covers constructor
and synchronous solve, excluding input loading, module compilation, final trace
serialization and artifact I/O. No production code changed for profiling.

All three boards solved and their output trace JSON matched the frozen reference
byte for byte. That reference is the existing matched migration reference, not a
new checkout of upstream main. These are single profiled runs, not uninstrumented
benchmark timings or speedup measurements.

## Whole-board breakdown

Seconds. Named phases use the pipeline's phase timers. The remainder includes
other stages and work outside those timers, especially construction/transitions.

| Work | Board 2 | Board 12 | Board 13 |
|---|---:|---:|---:|
| High-density routing | 33.33 | 14.72 | 27.84 |
| Joint DRC repair | 12.52 | 3.66 | 14.61 |
| Trace simplification | 7.55 | 6.13 | 1.78 |
| Force improvement (repair01, TS) | 4.45 | 2.52 | 2.33 |
| Port-point pathing | 3.37 | 9.76 | 6.32 |
| Everything else, including construction/transitions | 3.85 | 9.40 | 3.74 |
| **Total** | **65.07** | **46.18** | **56.61** |

High-density routing is 32–51% of elapsed time. Named WASM frames, including
allocator frames, account for approximately 61–73% of sampled self time. Generated
JS glue alone is a small fraction, but this does not count all boundary costs:
mutation watches and encoding also live in ordinary TS adapter frames.

## Recommended next experiments

1. **Finish moving DRC callers onto Rust (boundary/integration).** Calls under
   `evaluateRelaxedDrc` consume 2.96 / 1.66 / 2.63 seconds on boards 2 / 12 / 13.
   Pipeline9JointDrcRepairSolver still invokes this TS conversion/check path for
   baseline/current results and reference evaluations. Audit whether the existing
   native evaluator can supply exactly the same result shape, error order, IDs,
   centers, continuity behavior and Circuit JSON. Port any missing conversion
   directly. This is a measured budget, not an expected saving; evaluation still
   has to happen. Do not replace exact checks with the conservative indexed checks.

2. **Narrow trace-simplification mutation scans (boundary).** Inclusive
   `sourceChanges` costs 0.76 / 2.10 / 0.46 seconds. Board 12 spends about 34% of
   its simplification phase here. Extend the existing private-object ownership
   and operation-scoped checks so internal calls do not repeatedly rescan the
   same inputs. Caller-owned mutable aliases still need detection at every
   observable boundary, including callback re-entry. The codec already skips
   private normalized obstacles and coalesces connectivity reads; do not redo
   those optimizations or substitute an unsound dirty flag.

3. **Port repair01 force improvement (additional literal Rust port).** The TS
   stage consumes 4.45 / 2.52 / 2.33 seconds. Its main class is 2,170 lines plus
   helper files. Segment/segment clearance projection is a measured hotspot.
   This is the clearest remaining self-contained compute port across all three
   boards. Preserve projection order, floating-point expressions, stepping and
   observation through the adapter. A hypothetical 2x stage improvement would
   save only 1.2–2.2 seconds per board; it would not double whole-board speed.

4. **Target native routing memory/lookup costs for larger gains (implementation,
   no algorithm change).** A01, A03 and the general candidate solvers dominate
   the largest stage. Hot functions include A01 expansion/rip costs, A03 occupancy
   checks, the general candidate heap, neighbor generation and future-connection
   penalties. Inspect allocation/copy callers and repeated occupancy lookups
   while preserving traversal order and arithmetic. Existing code already has
   indexed arenas/heaps, reusable search buffers, occupancy stamps and shared
   future-penalty computation. A new optimization here needs a specific measured
   hypothesis; there is no established easy win from this profile alone. A 25%
   reduction in the whole HD stage would translate to roughly 8–13% overall.

Lower-priority candidates: repair04 `relaxTraceClearance` takes 0.86 / 0 / 1.49
seconds (562-line main file plus helpers). The entire clearance projection call
costs more but includes evaluation work. HighDensitySolver `pushSolverState`
costs 0.65 / 0.15 / 0.49 seconds. Native allocator self time totals 3.51 / 2.57 /
3.22 seconds across many callers; these costs overlap other targets and are not
an independent saving to add. The allocator already uses single-threaded
operation and enlarged growth increments.

## Timing interpretation

Target numbers above are inclusive CPU samples and may overlap phases and each
other. Do not sum them to predict total savings. In particular, native DRC
assessment and allocator work are included in several larger operations.

On board 12, about 5.93 seconds sit outside the recorded phase timers. The CPU
profile attributes most of this to additional Pipeline9 step paths that construct
solvers and prepare transitions. Progress computation accounts for only about
0.014 seconds; it is not the missing bottleneck. Tiny-hypergraph visualization
materialization is about 0.29 seconds on that board, also too small to explain it.

## Artifacts

Raw profiles, per-board phase timings, trace bytes, module hashes, runner and
sample summaries: `/private/tmp/rust-migration/long-board-profiles/`.

Relevant source entry points:

- `lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver.ts` (baseline calls around lines 723/744, reference call around 1189)
- `lib/testing/evaluate-relaxed-drc.ts`
- `lib/testing/getDrcErrors.ts`
- `lib/bindings/trace-simplification/TraceSimplificationGraphCodec.ts` (`sourceChanges`, line 136)
- `node_modules/high-density-repair01/lib/HighDensityForceImproveSolver.ts`
- `rust/high-density-a01/src/high_density_solver_a01.rs`
- `rust/high-density-a01/src/high_density_solver_a03.rs`
- `rust/intra-node-routing/src/single_route_candidate_priority_queue.rs`

No optimization was implemented or committed as part of this analysis.
