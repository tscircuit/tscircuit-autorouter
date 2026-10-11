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

An owned Bun pool serializes eligible immutable board contexts once into
shared bytes. Each worker deserializes its own object graph; cross-message
aliases and unsupported context shapes retain native message transport.
Caller-supplied pools keep their configured transport. The four-worker clone
tests cover object and buffer aliases, cycles, sparse arrays, numeric values,
mutable snapshots and protocol failures.

Native pathing caches four exact numeric region-cost tuples per region, with
live geometry and policy validation. Complete sample001/006/016 routing states,
route attempts, statistics and iteration limits match native controls. The
triangular distance cache is disabled by default after its measured regression;
it remains available through an explicit solver diagnostic option.

An eligible closed native search batches neighbor enumeration and region
intersection counts in a strict floating-point WebAssembly kernel. JavaScript
still performs the original live search checks, four-row memo accesses, scratch
updates, and cost arithmetic in their original visitor order. Direct stepping,
observable hooks, and unsupported cache shapes retain the original scoring path.

Reference DRC retains the complete native checks and rebuilds the full physical
connectivity graph on every call. Exact snapshots reuse only successful pure
geometry predicates and endpoint contact lists. An actual sample015 oracle
covers 17 full reference evaluations, ordered errors, mutations and restores.
The native serial pipeline continues to use the original checker by default.

Worker grid searches use typed priority queues and reuse rejected candidate
storage while retaining accepted nodes, parent identity, native tie order,
costs, and expansion limits. Indexed Tiny searches and blocker completion
also use packed queues and label storage. These changes preserve the original
search work; they do not reduce routing budgets. Worker force improvement
omits unused visualization snapshots, and small force/repair jobs are batched
to reduce messages while retaining their original commits. Their performance
is being evaluated in the next frozen all-sample run.

Snapshot `9f87cb73b` evaluated a strict 64-bit floating-point heap arena in
authentic worker-owned A01 searches during the original 100-step quantum. Every quantum rehydrates the
complete active and stale native rows, then flushes dirty rows before any
observer or await. The native heap, arrays, identities, tie order, and iteration
limits remain intact. The arena proof records 957,175 native A01 steps and 9,572
complete private-state checkpoints; it is functional evidence, not a timing
claim. After the measured high-density regression, revision `4f092b4ef` keeps
the arena experimental and restores the JavaScript fused heap by default. Both
modes match 1,032,799 native A01/A03 steps and all 10,329 full private-state
checkpoints. Default admission checks all 422 relevant descriptors using 185
reflection operations; the optional arena extends this to 479 descriptors and
230 operations. Reproducible functional evidence is in
[parallel-native-grid-default-and-experimental-state-proof.json](benchmarks/parallel-native-grid-default-and-experimental-state-proof.json).

Authentic default-worker A13 candidates use the pinned strict-f64 C search
kernel after their original native setup. Public and custom A13 construction
keeps its existing JavaScript backend. Private worker admission verifies the
original input, owner, supervisor, validation, builtin, and WASM contracts;
unsupported caps stay native before setup. An active ownership violation fails
explicitly rather than switching to a stale search. The functional oracle
checks 69 selected candidates, 12,900 original calls, 3,809,059 positive C
expansions, and 242,338,816 complete active/stale heap rows. Original routing
caps, tie ordering, fitness, setup errors, and output remain unchanged. This
proves execution and parity; speed is measured only by the frozen Blacksmith
comparison. Source, compiler, and functional counts are documented in
[parallel-native-a13-kernel-proof.json](benchmarks/parallel-native-a13-kernel-proof.json).

The reviewed A13 upload change reuses immutable inputs only inside a privately
owned original 100-call quantum. Markers reset at every quantum; mutable
connection inputs still upload at every native search start, and unbranded
kernels retain full uploads. The same native oracle records 2,013 search starts
and reduces uploads from 332,890,026 to 201,669,154 bytes and from 16,104 to
11,180 calls. C code, search resets and all checked private states are unchanged.

Private reference continuity checks expand each original physical component
once during their local traversal. Every trace still processes its original
touched-pad adjacency, and final membership, native source aliases, error
order, and cache state are unchanged. All 17 saved checks and 22 edge cases
match native results; returned component-member visits fall from 2,782,044 to
7,376 in the operation census. This is work evidence, not a wall-time claim.
The guarded scope and complete parity proof are in
[reference-drc-component-once-proof.json](benchmarks/reference-drc-component-once-proof.json).

Default worker path simplification also prepares a bounded window of four
future routes. Publication stays in the original route order and uses the
actual native parent and child owners. A candidate is accepted only when
replaying its recorded native geometry queries against the committed prefix
returns the same answers; rejected candidates execute at their original native
position. The first exposed native child remains the actual child, and source
point/metadata aliases are restored before publication. Input, control, buffer,
and callback changes during an await withdraw the optimization and resume the
original owner. Captured lifecycle operations settle pending effects without
calling newly installed Promise callbacks or diagnostic accessors.

Six captured phases preserve all 1,503 routes, 27,198 original logical steps,
caps, and geometry hashes. The proof separately counts 27,273 speculative
native steps, 6,771 actual owner steps, all native certificate queries, and
complete guard work; speculative execution is not hidden from the accounting.
Input-covered objects are checked once and excluded from the separate control
snapshot. Functional results and source/fixture hashes are in
[parallel-path-lookahead-functional-proof.json](benchmarks/parallel-path-lookahead-functional-proof.json).

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

Twenty-two frozen exploratory snapshots have complete paired results for all 16
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
| `64ca4e9a0` | ordered / indexed, force trials on coordinator | 1.386× | 1.510× | All solved, exact geometry and original-CAD quality parity; target remains unmet |
| `f573c8deb` | ordered / indexed, force trials on coordinator | 1.329× | 1.426× | All solved, exact geometry and original-CAD quality parity; distance-cache pathing regressed |
| `9470be55a` | ordered / indexed, force trials on coordinator | 1.360× | 1.484× | All solved, exact geometry and original-CAD quality parity; target remains unmet |
| `5955cddcd` | ordered / indexed, force trials on coordinator | 1.372× | 1.495× | All solved, exact geometry and original-CAD quality parity; target remains unmet |
| `d76229d4a` | ordered / indexed, force trials on coordinator | 1.346× | 1.447× | All solved, exact geometry and original-CAD quality parity; target remains unmet |
| `2be345c05` | ordered / indexed, force trials on coordinator | 1.350× | 1.460× | All solved, exact geometry and original-CAD quality parity; target remains unmet |
| `ff70052f0` | ordered / indexed, force trials on coordinator | 1.344× | 1.465× | All solved, exact geometry and original-CAD quality parity; target remains unmet |
| `7bb1b82e2` | ordered / indexed, force trials on coordinator | 1.369× | 1.523× | All solved, exact geometry and original-CAD quality parity; target remains unmet |
| `9f87cb73b` | ordered / indexed, force trials on coordinator | 1.287× | 1.451× | All solved, exact geometry and original-CAD quality parity; high-density regression, target remains unmet |
| `afae314d5` | ordered / indexed, force trials on coordinator | 1.239× | 1.391× | All solved, exact geometry and original-CAD quality parity; lookahead guard overhead, target remains unmet |
| `24f2c48dd` | ordered / indexed, force trials on coordinator | 1.271× | 1.422× | All solved, exact geometry and original-CAD quality parity; target remains unmet |
| `05c72d631` | ordered / indexed, selected A01 bulk, sixteen-target lookahead | 0.795× | 0.735× | All solved and exact Native quality; A01 bulk regresses all16 high-density stages; target unmet |
| `752f8c03f` | ordered / indexed, Native trace fact lanes, selected A01 bulk off | 1.259× | 1.398× | All solved, exact Native geometry and original-CAD quality parity; target unmet |
| `da7e84745` | ordered / indexed, Native trace and polygon fact lanes, sixty-four-target lookahead | 1.268× | 1.412× | All solved, exact Native geometry and original-CAD quality parity; target unmet |
| `d3f96eca5` | ordered / indexed, Native trace and polygon fact lanes, fixed64 lookahead cohorts | 1.286× | 1.427× | All solved, exact Native geometry and original-CAD quality parity; target unmet |
| `1169e1bb0` | ordered / indexed, Native fixed64 cohorts, depth validation and capture dedup | 1.279× | 1.434× | All solved, exact Native geometry and original-CAD quality parity; target unmet |

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
1.386× on average and 1.510× in aggregate, with every output and quality check
matching the baseline. The exact dispatch arguments and immutable run URLs are recorded in
[parallel-srj18-64ca4e9a0-dispatch.json](benchmarks/parallel-srj18-64ca4e9a0-dispatch.json).
All 32 results are retained in
[parallel-srj18-64ca4e9a0.json](benchmarks/parallel-srj18-64ca4e9a0.json).

Snapshot `f573c8deb` shares a bounded triangular distance cache between native
parent and completion searches, memoizes scalar high-density cost math while
retaining native closest-point cache calls, and batches up to 16 simple ordered
high-density nodes per worker request. The complete sample006 search preserves
parent/completion states and the 2,000,000/3,683,422 iteration counts. All 583
sample001 high-density node outputs, statistics and limits match native solves
with four real workers; batching reduces its dispatch count to 317. These are
functional and work-count checks. Its complete paired four-core evaluation is
1.329× on average and 1.426× in aggregate, preserving every output and quality
check. Pathing latency increased on every sample versus `64ca4e9a0`; the
triangular cache is being removed from the default path before the next
evaluation. All 32 outcomes and immutable workflow records are in
[parallel-srj18-f573c8deb.json](benchmarks/parallel-srj18-f573c8deb.json).

Snapshot `9470be55a` disables the triangular distance cache, reuses four exact
region-cost tuples per region, and shares immutable Bun worker contexts. All 32
outcomes preserve native geometry, coverage, DRC and lint. Its average is 1.360×
and aggregate is 1.484×; work reductions have not established the speed target.
Complete evidence is in
[parallel-srj18-9470be55a.json](benchmarks/parallel-srj18-9470be55a.json).

Snapshot `5955cddcd` adds exact reference DRC predicates and retains complete
native graphs and check ordering. Its 32 outcomes preserve native geometry and
original-CAD quality; average speedup is 1.372× and aggregate is 1.495×.
Evidence is in
[parallel-srj18-5955cddcd.json](benchmarks/parallel-srj18-5955cddcd.json).

Snapshot `d76229d4a` adds bounded ready-route batches, work-gated scalar
memo allocation, and A01/A03 quantum histories on idle cores. Its complete
32-outcome paired evaluation averages 1.346× with 1.447× aggregate speedup.
Every native output and original-CAD quality check matches, but the target
remains unmet. Complete results and immutable workflow records are in
[parallel-srj18-d76229d4a-complete.json](benchmarks/parallel-srj18-d76229d4a-complete.json).

Snapshot `2be345c05` replaces native reference-map membership scans with the
ordered indexed builder and adds bounded worker-only A03 geometry and
distance memoization. The original live occupancy filters, native ordering,
search state and iteration caps remain unchanged. Its complete paired evaluation
averages 1.350× with 1.460× aggregate speedup; native geometry and original-CAD
quality match in all 32 outcomes. The target remains unmet. Evidence is in
[parallel-srj18-2be345c05-complete.json](benchmarks/parallel-srj18-2be345c05-complete.json).

The next frozen revision also indexes complete fresh physical and logical
reference graphs and fuses A01 worker heap sifting. The projection sweep uses
an embedded strict scalar WebAssembly kernel for eligible native inputs.
Seven captured sample015 passes preserve 20,224 native sweep batches and
98,258,176 vertex records, with unchanged caps, statistics and output hashes.
Custom hooks, altered math and unsupported inputs retain native execution.
These functional results do not establish a measured speedup.

A successful result must be repeated with three paired runs per variant
under the board-inclusive quality policy before claiming the target.

Snapshot `ff70052f0` adds the guarded embedded WebAssembly projection kernel,
ordered reference-graph construction, and worker-only fused A01 heaps. All 32
paired outcomes retain native geometry and original-CAD quality parity. The
arithmetic mean is 1.344× and aggregate speedup is 1.465×; the target remains
unmet. Complete evidence is in
[parallel-srj18-ff70052f0-complete.json](benchmarks/parallel-srj18-ff70052f0-complete.json).

Snapshot `7bb1b82e2` combines strict ordered CSR neighbor scans, synchronous
native pathing admission, worker-owned grid kernels at the original 100-step
boundaries, endpoint-union work elimination, and private reference-check
geometry/connectivity/source-port reuse. Its complete 32-outcome comparison
averages 1.369× with 1.523× aggregate speedup. Every sample solves with exact
native geometry and original-CAD coverage, DRC, and lint parity; the 2× target
remains unmet. Full timing, quality, worker ownership, pathing, and stage
statistics are preserved in
[parallel-srj18-7bb1b82e2-complete.json](benchmarks/parallel-srj18-7bb1b82e2-complete.json),
with immutable workflow records and packaged preflight checks in
[parallel-srj18-7bb1b82e2-dispatch.json](benchmarks/parallel-srj18-7bb1b82e2-dispatch.json).

Snapshot `9f87cb73b` adds strict C intersection tuples to the original CSR
pathing scan, private conductor geometry reuse, and the A01 heap arena. All 32
outcomes solve with exact native geometry and original-CAD quality parity, but
average speedup is 1.287× and aggregate speedup is 1.451×. High-density stage
times regress across the measured samples: sample015 rises from 32.0 to 40.8
seconds and sample005 from 4.2 to 6.2 seconds relative to `7bb1b82e2`. The next revision disables the arena by
default while preserving its experimental state-parity proof. The 2× target
remains unmet. Full outcomes and worker pool statistics are preserved in
[parallel-srj18-9f87cb73b-complete.json](benchmarks/parallel-srj18-9f87cb73b-complete.json),
with immutable workflow records and packaged preflight checks in
[parallel-srj18-9f87cb73b-dispatch.json](benchmarks/parallel-srj18-9f87cb73b-dispatch.json).

Snapshot `afae314d5` completed the sixteenth full comparison. It combines
the reviewed strict-f64 native A13 search, original-owner four-route lookahead,
component-once continuity, and narrower batched guards, with the experimental
A01 heap arena disabled by default. Its build, declarations, type checks and
source/built browser imports without SharedArrayBuffer pass. Packaged sample001
and sample015 retain exact native geometry and use at most four active workers.
All 32 paired outcomes are complete: all 16 samples solve with exact native
geometry, original-CAD quality and connection coverage parity, at most four
active workers, 1.239× arithmetic mean speedup and 1.391× aggregate speedup.
The target remains unmet. The new lookahead adds substantial full-graph guard
work: sample015 records 23.15 million descriptor reads for 6,328 speculative
native steps, and simplification takes 12.33 seconds versus 5.97 seconds for
the paired native baseline. The next revision removes repeated descriptor
metadata allocations and checks the exact per-window read set.
Complete outcomes, stage counters and every worker pool statistic are in
[parallel-srj18-afae314d5-complete.json](benchmarks/parallel-srj18-afae314d5-complete.json).
The frozen revision, preflight hashes, exact arguments and workflow IDs are in
[parallel-srj18-afae314d5-dispatch.json](benchmarks/parallel-srj18-afae314d5-dispatch.json).

Reviewed changes after that snapshot retain admitted native via-layer arrays
without recreating them for each segment. The same 23,731,201 original layer
checks remain, while their repeated native getLayers calls and type checks
are removed. Diagnostic observers retain the original execution. All 17 saved
reference checks and layer mutation/error probes preserve native output; see
[reference-drc-retained-via-layers-proof.json](benchmarks/reference-drc-retained-via-layers-proof.json).

Lookahead descriptor comparison now reads each canonical descriptor once,
with the same full contracts, keys, flags, accessors and buffer checks. In four
paired operation censuses, descriptor work is unchanged and ownership probes
fall from four to one per descriptor. These operation counts do not establish
a timing improvement; see
[parallel-lookahead-native-descriptor-work-proof.json](benchmarks/parallel-lookahead-native-descriptor-work-proof.json).

The reviewed scoped lookahead keeps initial full admission and one private
input clone before any await. Each pending window then checks its original
route and native index-selected peers, all shallow containers, index structure,
controls, options and intrinsics. Deferred unrelated geometry retains its
original observation position. Six phases preserve 1,503 routes and 27,198
logical steps; descriptor reads fall from 58,878,999 to 33,899,534 in the paired
operation census. Exact counters, source hashes, observer regressions and
full native-phase results are in
[parallel-path-lookahead-scoped-input-proof.json](benchmarks/parallel-path-lookahead-scoped-input-proof.json).

Snapshot `24f2c48dd` is frozen for the seventeenth full comparison of all
16 samples at the same baseline, dataset and four-core budget. It includes
these reviewed scoped lookahead, A13 upload and native via-layer changes. The
A01 bulk kernel in this revision remains isolated and inactive. ESM/DTS build,
TypeScript and source/built browser checks pass. Packaged sample001 and
sample015 both retain exact original geometry with at most four active workers.
All 32 paired outcomes are complete: every sample solves with exact native
geometry, original-CAD quality and coverage parity, at most four active workers,
1.271× arithmetic mean speedup and 1.422× aggregate speedup. The target remains
unmet. Complete metadata, counters and worker statistics are in
[parallel-srj18-24f2c48dd-complete.json](benchmarks/parallel-srj18-24f2c48dd-complete.json).
The exact SHA, checks, arguments and workflow IDs are in
[parallel-srj18-24f2c48dd-dispatch.json](benchmarks/parallel-srj18-24f2c48dd-dispatch.json).

The next reviewed revision executes the selected original A01 search inside
its existing worker-owned 100-call loop, with full native checkpoints and
callback behavior preserved; see
[native-a01-bulk-search-selected-owner-proof.json](benchmarks/native-a01-bulk-search-selected-owner-proof.json).
Its native lookahead queues sixteen targets on the same four workers. Only
the privately bound original owner, helper, pool and minted worker callback
can widen the window; custom callbacks retain four pending targets. All six
phases preserve 1,503 routes and 27,198 logical native steps. Descriptor reads
fall from 33,899,534 to 14,261,172 while native reruns rise from 98 to 167.
This is a measured work tradeoff, with elapsed time still to be established
by the next full-dataset comparison. Exact counters, source hashes and
mutation/cap cancellation checks are in
[parallel-path-lookahead-sixteen-window-proof.json](benchmarks/parallel-path-lookahead-sixteen-window-proof.json).

Snapshot `05c72d631` completed the eighteenth full comparison. Every sample
solves with exact native geometry and original-CAD quality and coverage
parity, using at most four workers. Arithmetic mean speedup is 0.795× and
aggregate speedup is 0.735×. The selected A01 bulk driver regresses every
high-density stage: sample015 takes 162.7 seconds and sample014 309.1 seconds
in that stage. The larger lookahead window reduces sample015 simplification
to 7.14 seconds. The next revision disables the selected bulk driver by
default while retaining its isolated state-parity proofs; guarded parallel
reference DRC integration continues. The 2× target remains unmet. All32
outcomes, original metadata and every worker statistic are preserved in
[parallel-srj18-05c72d631-complete.json](benchmarks/parallel-srj18-05c72d631-complete.json).
Exact checks, arguments and completed workflow IDs are in
[parallel-srj18-05c72d631-dispatch.json](benchmarks/parallel-srj18-05c72d631-dispatch.json).

The reviewed Native reference DRC path now reserves at most three idle
default-pool workers and computes the fourth lane on the main thread. The
original checker retains constructor order, mutable graph state, exact
cache identities/FIFO, original miss sites and ordered errors. All facts,
including unused rows, are validated before consumption. Actual worker
provenance and private ports/signals prevent custom or ordinary queued
tasks from entering the synchronous reservation; deadline and protocol
failures remain fatal. Root and joint evaluators retain their warm private
memos across setup, and all three async root entry points initialize only
the genuine owned pool. Actual sample001 preserves Native geometry while
exercising worker and main fact lanes. These checks establish functional
parity; full-dataset elapsed-time acceptance is still pending. See
[reference-drc-native-pipeline-integration-proof.json](benchmarks/reference-drc-native-pipeline-integration-proof.json).

Snapshot `752f8c03f` is frozen for the nineteenth comparison of all16
samples with the same baseline, dataset, four-core budget and ordered/indexed
policy. The regressing selected A01 bulk driver is off. Exact Native trace
facts use at most three idle default-pool workers plus main; sixteen-target
lookahead remains enabled. ESM/DTS, TypeScript and source/built browser imports
pass, and packaged sample001/sample015 retain exact Native geometry with four
workers. All five Blacksmith groups completed all 32 paired outcomes. Every sample solves
with exact Native geometry, original-CAD quality and coverage parity, at most
four active workers, 1.259× arithmetic mean speedup and 1.398× aggregate speedup.
The target remains unmet. Every outcome, metadata field and worker statistic is
preserved in
[parallel-srj18-752f8c03f-complete.json](benchmarks/parallel-srj18-752f8c03f-complete.json).
Checks, hashes, arguments and workflow IDs are in
[parallel-srj18-752f8c03f-dispatch.json](benchmarks/parallel-srj18-752f8c03f-dispatch.json).

The next reviewed lookahead revision queues sixty-four targets on the same four
physical workers. Genuine private owner/helper/default-pool/minted-run identity
is still required; custom callbacks keep four pending targets. All six captured
phases retain exact Native state and geometry for 1,503 routes and 27,198 logical
steps. Compared with sixteen targets, descriptor reads fall from 14,261,172 to
7,317,033 and descriptor builtin calls from 2,301,498 to 1,131,409. Ordered
reruns increase from 167 to 306 and rerun steps from 6,840 to 11,702. This is an
operation-count tradeoff, with elapsed-time acceptance still pending. Twenty
functional files pass 2,439 assertions; independent review adds 88 assertions,
including the last pending target, unsupported callbacks, caps, and cancellation
of all sixty-four jobs. Exact source hashes and phase counters are in
[parallel-path-lookahead-sixty-four-window-proof.json](benchmarks/parallel-path-lookahead-sixty-four-window-proof.json);
the isolated 8/16/32/64 comparison and replay preload are in
[parallel-path-window-capacity-census.json](benchmarks/parallel-path-window-capacity-census.json).

The twentieth frozen revision `da7e84745` combines sixty-four pending Native
lookahead targets, synchronous trace and polygon reference facts on three idle
workers plus main, and a pinned-default Flatten tolerance gate. Nondefault
tolerances retain Native execution without worker facts. The fact ledger is
collected from the actual built pool after disposal, outside measured solve
time. Selected A01 bulk remains disabled. Build/declarations, TypeScript,
source and built browser imports without SharedArrayBuffer, and packaged
sample001/sample015 Native geometry checks pass. The packaged checks show
three fact worker lanes plus main, zero protocol faults and all leases retired.
All five Blacksmith groups completed all32 paired outcomes. Every sample solves
with exact Native geometry and original-CAD quality/coverage parity; mean
speedup is 1.268× and aggregate speedup 1.412×. The target remains unmet.
The after-disposal private ledger records 81,735 fact rows, 128 completed
batches, 382 worker reservations and retirements, zero faults, at most three
fact workers plus main, and at most four ordinary workers. Every original
outcome, worker statistic, metadata and source report hash is preserved in
[parallel-srj18-da7e84745-complete.json](benchmarks/parallel-srj18-da7e84745-complete.json).
Frozen hashes, arguments, preflight and workflow IDs are in
[parallel-srj18-da7e84745-dispatch.json](benchmarks/parallel-srj18-da7e84745-dispatch.json).

The reviewed fixed-cohort follow-up refills the same sixty-four-target Native
window after its pending routes have been consumed in order. Only the private
minted run/owner/helper/default-pool binding enables it; custom callbacks keep
rolling windows. The existing full-prefix clone preserves cross-route aliases
within each cohort. Six complete Native phase controls retain 1,503 routes and
27,198 logical steps; prefix clones fall from 1,503 to 26, cloned prefix rows
from 216,940 to 3,328, ordered reruns from 306 to 225, and rerun steps from
11,702 to 8,921. This is operation-count evidence, with elapsed-time acceptance
pending. Actual four-worker tests also cover shared endpoint and nested metadata
aliases, a final two-route cohort, and cap/source/index mutation while the second
cohort is pending. Frozen main-thread CPU attribution and exact source/control
hashes are in
[parallel-path-lookahead-fixed-cohort-proof.json](benchmarks/parallel-path-lookahead-fixed-cohort-proof.json).

The twenty-first frozen revision `d3f96eca5` evaluates this fixed-cohort change
against the same immutable baseline and all sixteen samples. Immutable build,
TypeScript, source and built browser imports, and packaged sample001/sample015
Native geometry checks pass. The packaged fact ledgers retain three worker
lanes plus main, zero faults and all reservations retired after disposal. All
five Blacksmith groups completed all32 paired outcomes. Every sample solves
with exact Native geometry and original-CAD quality/coverage parity. Arithmetic
mean speedup is 1.286× and aggregate speedup 1.427×; the target remains unmet.
Every original outcome, metadata field, worker statistic and source hash is
preserved in
[parallel-srj18-d3f96eca5-complete.json](benchmarks/parallel-srj18-d3f96eca5-complete.json).
The exact candidate also has its own benchmark branch so later implementation
commits cannot alter the workflow revision. Arguments, preflight and workflow
IDs are in
[parallel-srj18-d3f96eca5-dispatch.json](benchmarks/parallel-srj18-d3f96eca5-dispatch.json).

A reviewed within-capture lookahead simplification reuses an input target check
only after its original contract matches within that same synchronous capture.
The guarded Native index queries do not mutate source pointers. The final
scope still retains every original contract and rechecks all targets after an
await; fresh output targets and later captures receive their original checks.
Six full phases preserve all Native states,1,503 routes and27,198 logical steps.
Descriptor reads fall from7,317,033 to7,032,371 and descriptor builtin calls
from1,131,409 to1,058,359. These are operation counts; elapsed-time acceptance
remains pending. Shared metadata getters, aliasing and post-await point changes
pass independent review. Exact controls and hashes are in
[parallel-path-lookahead-within-capture-dedup-proof.json](benchmarks/parallel-path-lookahead-within-capture-dedup-proof.json).

The twenty-second candidate `1169e1bb0` combines the reviewed fixed64 cohorts,
within-capture dedup and Native reference validation without unused path records.
Dormant Generic and indexed-memo experiments remain unactivated. Immutable
build/declarations, TypeScript, source/built browser imports and packaged
sample001/sample015 Native geometry and after-disposal fact-budget checks pass.
All five Blacksmith groups cover the full sixteen samples against the same
baseline and four-core budget. All32 paired outcomes complete and all16 solve
with exact Native geometry and original-CAD quality/coverage parity. Arithmetic
mean speedup is1.279× and aggregate speedup1.434×; the target remains unmet.
All original outcomes, metadata, source hashes and after-disposal worker stats
are preserved in
[parallel-srj18-1169e1bb0-complete.json](benchmarks/parallel-srj18-1169e1bb0-complete.json).
The immutable workflow branch, hashes, preflight and arguments are in
[parallel-srj18-1169e1bb0-dispatch.json](benchmarks/parallel-srj18-1169e1bb0-dispatch.json).

CPU attribution of the actual unmodified frozen Joint stage now includes its
constructor, candidate preparation and complete original ordered solve. The
earlier parent stages and same-source control are outside one async profiling
span per process. Sample001 has658 samples and sample0158,757; recorded geometry,
iterations, caps, progress and evaluator counters match their controls. In
sample015, reference DRC accounts for35.98% inclusive samples, indexed candidate
evaluation12.52%, and indexed PCB connectivity construction14.49%. These shares
overlap and are main-thread CPU attribution, including native waits; worker CPU
and dataset elapsed acceptance are separate. The narrower indexed-engine replay
therefore does not represent the complete Joint stage. Exact source/raw hashes,
limitations and reproducible driver are in
[parallel-native-joint-stage-cpu-proof.json](benchmarks/parallel-native-joint-stage-cpu-proof.json).

A guarded private certificate optimization prepares just the Native segment and
via filters consumed by a temporary certificate view. Actual Original routing
child construction, logical budgets, terminal getters and publication sites
still run unchanged. Direct base certifiers and custom callbacks retain their
Original temporary constructors; the optimized class is unexported and its
instance uses an ECMAScript private field. Six complete phases preserve1,503
routes,27,198 Native logical steps, every certificate decision and every rerun.
Temporary constructors fall from2,954 to zero, replaced by2,954 filter-only
views. This is operation-count evidence; dataset elapsed acceptance is pending.
The updated frozen22 main-thread CPU profile separates temporary certificate
construction from actual owner construction. Exact rows, aliases, source/raw
hashes, fallback checks and attribution are in
[parallel-path-filter-only-certificate-proof.json](benchmarks/parallel-path-filter-only-certificate-proof.json).
