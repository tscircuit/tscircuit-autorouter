# Parallel Pipeline 9 prototype

`AutoroutingPipelineSolver9_Parallel` is an opt-in asynchronous Pipeline 9
implementation. It dispatches independent routing work to a local worker pool
and, by default, commits results in the serial solver's order. The existing
`AutoroutingPipelineSolver` export continues to use the serial Pipeline 9.

The full paired SRJ18 evaluation is in progress. This document does not claim
that the prototype has reached the 2× target. Final measured evidence belongs
in the evaluation results below.

## Execution and ownership

The prototype requires `solveAsync()`, `stepAsync()`, or
`solveUntilPhaseAsync()`. Calling its synchronous `solve()` or
`solveUntilPhase()` throws. The following example runs one board and releases
the pool owned by that solver:

```ts
import {
  AutoroutingPipelineSolver9_Parallel,
  type SimpleRouteJson,
} from "@tscircuit/capacity-autorouter"

async function routeBoard(srj: SimpleRouteJson): Promise<SimpleRouteJson> {
  const solver = new AutoroutingPipelineSolver9_Parallel(srj, {
    effort: 1,
    cacheProvider: null,
    workerCount: 4,
    enableParallelPathSimplification: true,
    enableParallelDrcTrials: false,
  })
  try {
    await solver.solveAsync()
    if (!solver.solved || solver.failed) {
      throw new Error(solver.error ?? "Parallel autorouting did not complete")
    }
    return solver.getOutputSimpleRouteJson()
  } finally {
    solver.dispose()
  }
}
```

`workerCount` defaults to 4 and must be an integer from 1 through 4.
`enableParallelPathSimplification` defaults to false in the public solver.
The benchmark candidate enables it by default; use
`--parallel-path-simplification 0` to evaluate the routing and repair changes
without that stage.

`enableParallelDrcTrials` defaults to true. Set it to false, or use
`--parallel-drc-trials 0` in the benchmark, to run force-trial evaluation on
the coordinator while retaining the other parallel stages and repair kernels.
Reports record this scheduling flag and cannot merge mixed settings.

`highDensityPolicy` defaults to `"ordered"`. The opt-in `"first-valid"`
policy accepts a completed, locally valid high-density candidate before
earlier candidates finish. It may produce different routes; geometry hashes
and trace/via counts remain available as diagnostics. Select the corresponding
benchmark mode with `--high-density-policy first-valid`.

`pathingStrategy` defaults to `"indexed"`. The benchmark also accepts
`"adaptive-bitset"`, `"cached-cost"`, and the opt-in `"landmark"`,
`"negotiated"`, and `"goal-balls"` strategies.
Landmark pathing computes relaxed-graph distance tables in the shared pool
and uses them to guide routing. It can change route choices even with ordered
high-density routing. Use `--pathing-strategy landmark` to evaluate it with
the same explicit coverage and quality checks as other alternative routes.
Negotiated pathing dispatches candidate searches through the shared pool
while retaining coordinator quality checks and rip policies; select it with
`--pathing-strategy negotiated`.
Goal-balls pathing precomputes capped, net-aware distance bounds in the same
pool; select it with `--pathing-strategy goal-balls`. Its route choices may
change, so explicit physical coverage, DRC, and lint checks remain required.

Alternative policies use a layer-aware point-pair tree and same-layer terminal
snapping. This retains distinct opposite-layer pads at identical coordinates,
which the original XY-only tree can omit. The output must physically connect
every original net terminal; metadata alone does not establish connectivity.
Set `physicalRouting: true` (or `--physical-routing 1` in the benchmark) to
use these physical-terminal checks with ordered, indexed routing as well.
The default remains false, preserving the native route geometry and its
existing terminal behavior for the exact-output comparison.

A caller can reuse worker imports across boards by providing a pool. The
caller owns a supplied pool, so `solver.dispose()` leaves that pool alive.
Dispose it when the final board completes:

```ts
import {
  AutoroutingPipelineSolver9_Parallel,
  Pipeline9LocalWorkerPool,
  type SimpleRouteJson,
} from "@tscircuit/capacity-autorouter"

async function routeBoards(inputs: SimpleRouteJson[]): Promise<SimpleRouteJson[]> {
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 4 })
  const outputs: SimpleRouteJson[] = []
  try {
    await pool.warmup()
    for (const input of inputs) {
      const solver = new AutoroutingPipelineSolver9_Parallel(input, {
        effort: 1,
        cacheProvider: null,
        workerPool: pool,
        enableParallelPathSimplification: true,
        enableParallelDrcTrials: false,
      })
      await solver.solveAsync()
      if (!solver.solved || solver.failed) {
        throw new Error(solver.error ?? "Parallel autorouting did not complete")
      }
      outputs.push(solver.getOutputSimpleRouteJson())
    }
    return outputs
  } finally {
    pool.dispose()
  }
}
```

This persistent-pool API is separate from the cold benchmark. The benchmark
creates and disposes a fresh owned pool for every prototype invocation.

## Parallel work and deterministic commits

| Stage | Parallel unit | Coordination retained |
| --- | --- | --- |
| High-density routing | Capacity-mesh node | Original node result order, route ownership, and parent statistics |
| High-density force improvement | Node's assigned routes | Original sample order and route indexes |
| High-density repair | Node repair sample | Original fixed-neighbor snapshots and route metadata |
| Optional path simplification | Ready routes in the ordered geometry dependency graph | Original interacting predecessors, later original copper, route indexes, via operations, validation, and simplification loop budgets |
| Joint DRC force trials | Candidates sharing one immutable force frontier | Original trial order, candidate caches, error accounting, acceptance, and iteration budgets |
| Opt-in negotiated pathing | Up to four route searches against immutable occupancy | Stable commits, live conflict checks, rescheduling, and shared original expansion budgets |
| Opt-in landmark preparation | Relaxed-graph distance table | Original graph reservations and routing quality checks |

The pool is shared between these stages within a board. It queues jobs and
keeps at most `workerCount` jobs active. High-density routing starts likely
expensive nodes first while harvesting results in the original order. Shared
board context is sent once to each worker for that routing context rather
than retransmitted with every node.

Worker grid searches use typed priority queues and reuse rejected candidate
storage while retaining accepted nodes, parent identity, native tie order,
costs, and expansion limits. Indexed Tiny searches and blocker completion
also use packed queues and label storage. These changes preserve the original
search work; they do not reduce routing budgets. Worker force improvement
omits unused visualization snapshots, and small force/repair jobs are batched
to reduce messages while retaining their original commits. Their performance
is being evaluated in the next frozen all-sample run.

Topology, coordinated via changes, and joint DRC commits retain their serial
execution. Ordered port-point pathing also retains its original coordinator;
negotiated search is opt-in. High-density routing with fixed
preloaded routes also keeps its existing sequential mutation path. Worker
exceptions propagate through the asynchronous solver and mark it failed.

## Reproducing the Blacksmith evaluation

Repository policy reserves Blacksmith for benchmark runs. This evaluation's
custom job is part of the existing `.github/workflows/benchmark.yml` workflow and runs on
`blacksmith-4vcpu-ubuntu-2404-arm`. Dispatch it against a branch that contains
the prototype and harness:

```sh
gh workflow run benchmark.yml \
  --repo tscircuit/tscircuit-autorouter \
  --ref YOUR_BRANCH \
  -f solver_name=parallel-prototype \
  -f ref=YOUR_BRANCH \
  -f same_machine_compare=false \
  -f benchmark_args_json='["--repetitions","3","--timeout-ms","1200000","--parallel-path-simplification","1","--parallel-drc-trials","0"]'
```

For a baseline profile run, use
`["--variants","baseline","--repetitions","1"]` as `benchmark_args_json`.
For a partial development check, add `--samples` followed by a comma-separated
list such as `1,4,16`. Baseline-only and partial runs cannot satisfy the full
acceptance gate.

Independent sample subsets can run on separate four-core ARM Blacksmith
runners to reduce evaluation turnaround. Each sample's baseline and prototype
runs, including all repetitions, must remain together in one source job.
Dispatch every subset at the same prototype SHA and with identical settings,
then merge the downloaded reports:

```sh
bun scripts/parallel-benchmark/mergeReports.ts \
  --out-dir parallel-benchmark-merged \
  group1/report.json group2/report.json group3/report.json \
  group4/report.json group5/report.json
```

The merger rejects duplicate runs and incompatible revisions, dataset hashes,
settings, runtimes, runner models, or CPU budgets. When an installed dependency
hash is available for any source, it must be available and identical for every
source. The merged report retains source metadata and recalculates the same
all-16 acceptance gate; it does not exclude missing or failed samples.

The job finds four CPUs from its allowed CPU list and launches the controller
under `taskset`. Child processes and worker threads inherit that affinity.
The coordinator and all workers therefore share the same four-CPU budget;
`workerCount: 4` does not add a fifth CPU to the benchmark budget.

The immutable serial baseline is commit
`65522c89c370d4b4f9f69e1a79af58de641752bc`. The job checks it out separately and
builds it with its original `bun run build` command and tsup/Terser settings,
against the same installed dependencies used by the prototype. Both variants
execute their packaged output so packaging differences do not distort the
comparison.

SRJ18 is pinned by the dependency specifier to
`100e8957ce789b5b288e14c476dc83f4efc5214b`. The harness asserts exactly
`sample001` through `sample016` and records SHA-256 hashes of their JSON files.
Both variants receive independently cloned inputs from that same dataset.

## Timing, quality, and acceptance

The default evaluation uses three paired repetitions at effort 1. It routes
one board at a time, alternating baseline/prototype order across samples and
repetitions. Each variant runs in a fresh child process with pipeline-level
caching disabled by `cacheProvider: null`. The original intra-node caches
remain available within each board. Worker caches reset when a new board
context arrives, so persistent pools do not replay previously routed boards.

Cold wall time includes solver construction, routing, internal worker
creation/imports, and owned-pool disposal. It excludes the child process's
initial module imports, input cloning, output hashing, DRC, lint, and artifact
writing. The serial baseline calls its public `solve()` directly, without
per-step profiling clocks in its hot path. Prototype progress uses a
one-second timer.

The default routing child deadline is 180 seconds. Upon routing completion,
quality validation receives a separate deadline of at least 180 seconds.
These deadlines bound execution; quality-validation time does not enter the
recorded routing time. Failures and timeouts remain in the dataset report and
are scored at the configured routing timeout for summary calculations.

For each sample, the summary takes the median baseline time and median
prototype time across repetitions. It reports three different metrics:

- Arithmetic mean speedup: the mean of the 16 baseline/prototype median ratios.
- Aggregate speedup: the sum of baseline medians divided by the sum of
  prototype medians.
- Geometric mean speedup: the geometric mean of the 16 per-sample ratios.

The `targetReached` flag requires every baseline and prototype repetition for
all 16 samples to complete successfully, with no per-sample DRC or per-type
trace-lint regression. Both arithmetic mean and aggregate speedup must be at
least 2×. Missing samples, duplicate runs, failed routes, timeouts, and missing
quality evidence cannot pass the gate.

With ordered high-density routing and indexed, adaptive-bitset, or cached-cost
pathing and `physicalRouting: false`, the
gate also requires matching SHA-256 hashes of the full simplified trace
outputs, unchanged trace/via counts, and identical recorded physical coverage.
This comparison preserves the baseline's behavior, including any incomplete
baseline nets, which remain visible in the quality evidence.
In physical routing, first-valid, landmark, negotiated,
or goal-balls mode,
geometry and counts are diagnostic; legitimate alternative routes can pass
when physical connection coverage and the quality comparisons pass. Reports
record the policy, strategy, and whether exact geometry was required. Subset
reports with different policies or strategies cannot merge.

New reports validate original logical root-net requirements explicitly,
including preloaded copper. The coverage evaluator groups original endpoint
aliases and builds physical components from individual wire strokes, vias,
and pad geometry using the existing geometry helpers and a spatial index.
Ordinary wire strokes use their starting width; rotated pads use their actual
polygons. Conductors join only through actual contact on a shared layer;
vias and plated-hole barrels supply their declared layer span. Trace or port
metadata does not join disconnected copper. In changed-geometry or physical
routing modes, every required net must have a
physical component contacted by all its original terminals, with no uncovered
nets or missing port identities. Multiple allowed layers remain alternative
contacts and do not create a barrel. Pad-less terminals can contact wire
interiors at their original coordinates. Shared-pad aliases retain those
coordinates and layers, so a net alias cannot substitute a distant pad.
Singleton nets without a second endpoint are reported separately. Trace lint currently checks odd
angles; it is not the connection coverage check. Legacy ordered reports lack
coverage fields and retain their original exact-geometry comparison; they
cannot provide coverage evidence for alternative-route modes.

A validation-only audit of the earlier `dd922d3` outputs exposed a missing
bottom connection in sample011: `pcb_port_395` shares coordinates with top
`pcb_port_75`, but the two SMT pads occupy different layers. The original
relaxed DRC conversion selected the top pad's port alias and omitted the
bottom requirement. Both earlier variants have that omission; the new
coverage evaluator retains the bottom port. Physical routing requires the
candidate to connect it; native geometry parity records the unchanged omission.

The same audit found disconnected terminals in sample009 where a layer
transition used a circular plated hole's bounding-box corner. Alternative
preprocessing retains original copper shapes alongside routing rectangles.
Physical routing and simplification adapters require transitions to touch
that copper and preserve mandatory vias outside it. The sample009 functional
regression checks all 72 required nets and rejects invalid plated-hole markers.
These functional checks establish connectivity and DRC behavior; the paired
benchmark still evaluates trace lint and performance independently.

DRC uses the existing benchmark's `evaluateRelaxedDrc` evaluator and rule
preset. Harness version 2 explicitly includes the original board outline and
board-edge clearance. Earlier version 1 reports omitted the board element;
their DRC counts alone do not establish board-boundary compliance. The merger
rejects incompatible quality policies. Harness version 3 records the coverage
policy explicitly: native output comparisons require baseline coverage parity,
while changed geometry requires full physical completion. Harness version 4 uses
the original CAD pad, plated-hole, and non-plated-hole shapes for both DRC and
coverage, with their inventory hashes recorded in each report. Original CAD
traces and vias are excluded from this geometry inventory. The merger rejects
mixed quality versions or pad inventories. Exact trace hashes provide a stronger equivalence check for this
deterministic execution rewrite; they do not independently establish that
the baseline's routes satisfy every manufacturing rule.

The `parallel-prototype-srj18` artifact contains metadata, the installed
dependency list, progressive checkpoints, and final JSON/Markdown reports.
Each run directory contains its result, progress/stage profiles, stderr,
routed SRJ, and full DRC/lint evidence when routing succeeds. Results include
worker-pool and per-stage statistics so the remaining serial bottlenecks can
be distinguished from worker scheduling and serialization costs.

## Current limitations

- Interacting path-simplification predecessors remain ordered. Independent
  routes within a connected component can run concurrently, but small jobs may
  cost more to serialize and schedule than they save in parallel work.
- Fixed preloaded-route mutation retains the serial high-density path.
- Serial topology, port-point pathing, joint DRC, and other coordinated stages
  limit the possible whole-board speedup even when node work scales well.
- The benchmark verifies the Bun runtime and its worker implementation.
  Other runtime and deployment combinations need separate validation.
- Persistent-pool throughput is useful for applications routing many boards,
  but it is not the cold-latency acceptance metric used here.

## Evaluation results

Six frozen exploratory snapshots have complete paired results for all 16
samples, with one repetition per variant. None meets the target. All use
baseline `65522c89c370d4b4f9f69e1a79af58de641752bc`, the pinned dataset and
matched dependencies on four-core ARM Blacksmith runners.

| Prototype | Policy / pathing | Arithmetic mean | Aggregate | Outcome |
| --- | --- | ---: | ---: | --- |
| `7a3111114` | ordered / indexed | 1.274× | 1.336× | All solved, identical geometry; legacy report lacks physical coverage evidence |
| `489368291` | first-valid / negotiated | 1.113× | 0.761× | All solved; physical coverage and trace-lint regressions fail acceptance |
| `dc387aa1f` | first-valid / goal-balls | 0.897× | 0.307× | Samples 013–015 failed; sample002 trace lint regressed |
| `da83da029` | ordered / indexed | 1.345× | 1.439× | All solved, exact geometry, identical connection coverage, DRC and lint |
| `37746ebc4` | ordered / adaptive-bitset | 1.226× | 1.324× | All solved, exact geometry and original-CAD quality parity; force speculation regressed latency |
| `414e04749` | ordered / indexed, force trials on coordinator | 1.367× | 1.485× | All solved, exact geometry and original-CAD quality parity; target remains unmet |

The `da83da029` evaluation includes all 32 paired outcomes, with cold worker
startup and disposal included. Every sample preserves its native output and
recorded physical coverage, including native omissions; its acceptance mode is
explicitly `baseline-parity`. This does not establish full original terminal
coverage or manufacturing compliance. Sample speedups range from 1.114× to
1.750×. Evidence is in [parallel-srj18-da83da029.json](benchmarks/parallel-srj18-da83da029.json)
and the linked immutable workflow artifacts.

The `489368291` result includes every sample, including the 852.229-second
prototype run for sample006; no slow case is excluded. Raw artifacts are
available from workflow runs
[38113191891](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/38113191891),
[38113193902](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/38113193902),
[38113195288](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/38113195288),
[38113196970](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/38113196970), and
[38113199046](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/38113199046).

The `dc387aa1f` report includes all 32 paired outcomes and scores the three
failed prototype runs at the configured 1,200-second deadline. Its 13 solved
prototype outputs meet full physical terminal coverage; sample002 has 1,005
odd-angle issues against the baseline's 931. Its observed high-density routing
work increased, so the additional competition is not an accepted speedup.
Raw artifacts are available from workflow runs
[38115780405](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/38115780405),
[38115781916](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/38115781916),
[38115783406](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/38115783406),
[38115785004](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/38115785004), and
[38115786618](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/38115786618).

The `37746ebc4` evaluation includes all 32 outcomes under quality policy version
4, using original CAD pad and hole geometry. It retains exact geometry, coverage,
DRC and lint parity, but does not meet the speed target. Force-trial speculation
increased joint-repair latency on several boards. The finer simplification
schedule and typed-prefix scorer did not produce a dataset-wide improvement.
Evidence is in [parallel-srj18-37746ebc4.json](benchmarks/parallel-srj18-37746ebc4.json).

The `414e04749` evaluation includes all 32 outcomes with parallel force trials
disabled, indexed pathing, the repair obstacle filter, and duplicate-discovery
cost reuse. Its average is 1.367× and aggregate is 1.485×. All original-CAD
coverage, DRC, lint, trace and via comparisons match the baseline. Sample002
improves to 1.731×, but most smaller boards remain below 1.5×. Evidence is in
[parallel-srj18-414e04749.json](benchmarks/parallel-srj18-414e04749.json).
Separate diagnostics retain the corrected force-speculation and adaptive
pathing configurations; they are not merged with this full-dataset result.

Snapshot `64ca4e9a0` removes closed graph incidences from ordered neighbor scans,
reuses exact force-projection geometry, and avoids repeated same-net obstacle
classification during native simplification. Its complete paired evaluation is
running with the same ordered/indexed configuration and force trials disabled.
The exact dispatch arguments and immutable run URLs are recorded in
[parallel-srj18-64ca4e9a0-dispatch.json](benchmarks/parallel-srj18-64ca4e9a0-dispatch.json).

The next snapshot shares a bounded triangular distance cache between native
parent and completion searches, memoizes scalar high-density cost math while
retaining native closest-point cache calls, and batches up to 16 simple ordered
high-density nodes per worker request. The complete sample006 search preserves
parent/completion states and the 2,000,000/3,683,422 iteration counts. All 583
sample001 high-density node outputs, statistics and limits match native solves
with four real workers; batching reduces its dispatch count to 317. These are
functional and work-count checks, not measured speedups.
A successful result must be repeated with three paired runs per variant
under the board-inclusive quality policy before claiming the target.
