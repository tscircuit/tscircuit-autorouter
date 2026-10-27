# Parallel port-point pathing

Pipeline9 uses the accelerated tiny-hypergraph backend with verified four-worker
runtimes. Set `parallelPortPointPathing: false` to select the existing JavaScript
implementation. Synchronous solving and runtimes without the verified worker
count retain their existing behavior.

```ts
const runtime = createAutorouterSolverRuntime({
  workerCount: 4,
  requireWorker: true,
})
const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
  effort: 1,
  cacheProvider: null,
})
try {
  await solver.solveAsync(runtime)
} finally {
  await runtime.dispose()
}
```

The implementation depends on [tiny-hypergraph PR #295](https://github.com/tscircuit/tiny-hypergraph/pull/295). The dependency pins commit `fd1b884fcdf4a569bc08305a3b0dcb6d31368e07`, which includes the worker task classes and embedded kernels. Normal installation fetches that commit; no local checkout link is required.

## Work distribution

Four active execution threads comprise the caller and three persistent helpers.
`parallelRouteWorkers: 3` in the benchmark metrics confirms that all three helpers acknowledged startup before a route search began.
They use the host's existing worker runtime, with no nested pools. Helpers sleep
between jobs and return their worker slots before subsequent pipeline stages.
Port-point phases sharing a runtime acquire a lease to avoid reserving overlapping
sets of persistent workers. Native pool startup overlaps the caller's graph
preparation; startup remains inside the measured phase.

The workers compute five independent kinds of work:

- Hard connectivity: after 2,048 A* expansions, one helper searches backward
  toward the caller's settled frontier. A meeting proves reachability and ends
  the check. If disconnected, a forward flood counts every reachable hop and
  lets the caller skip the remaining heap work while preserving the serial
  expansion budget exactly. Multilayer regions need at most two incoming ports;
  single-layer crossings retain each incoming state. The caller checks results
  between native expansion batches, keeping coordination out of the inner
  priority-queue loop. Cost-bound certification
  also runs on the helper. All checks are drained before commits. One initial
  probe is followed by a window of 64 long-search checks after an observed
  unreachable route, avoiding repeated checks on continuously reachable boards.
- Immutable geometry: each unordered port pair within a region is evaluated once
  with `Math.hypot`. Triangular distance tables are shared across searches and
  are built only when a blocker search first needs them.
- Region costs: helpers prepare exact cost lookup tables for changed region-cache
  versions while the caller searches. A barrier completes those writes before
  the caller changes the snapshot.
- Crossing masks: helpers prepare per-port crossing-prefix bitsets for changed
  region caches while the caller searches. Per-port claims prevent duplicate
  writes, and version publication makes completed masks available to the caller.
- Blocker graphs: workers construct outgoing owner/resource rows from committed
  segments, port assignments, endpoint reservations, layer restrictions, and
  forbidden owners. Multilayer rows share destination metadata; single-layer
  rows retain source-dependent crossing ownership. Each row is published in one
  contiguous allocation, avoiding contention on every edge's owner list. Direct
  and alternate blocker queries share those rows within a single frozen
  selection; each query filters its forbidden owners when traversing the graph.

Forward route searches and distinct-owner label queues run in compiled
WebAssembly on the caller. The parallel connectivity check can finish an
unreachable route before its remaining priority-queue expansions. They preserve the existing priority, tie, dominance,
route-commit, and rerip rules. Partial-span outside-in searches keep their native
implementation. Nested cost-aware completion reuses the worker service and the
existing completion acceptance policy and iteration budget.

For an unreachable goal under the certified finite-cost bounds, exhaustive A*
settles each hard-reachable hop once. Counting those hops without the weighted
heap therefore gives the same logical expansion count, including the exhaustion
step and remaining-budget limit. A positive connectivity result never chooses
or replaces a route.

The reference JavaScript owner search remains unchanged. The native connectivity
check consumes the prepared rows, avoiding a duplicate JavaScript graph traversal.
It compresses equivalent multilayer states while retaining two incoming ports,
which is necessary when a loop unlocks an exit through the original port.

Counters in the raw results identify actual helper work:
`parallelGeometryPairs`, `parallelRegionCostTables`, `parallelPortMasks`,
`parallelOwnerGraphRows`, `parallelConnectivityChecks`, and
`parallelConnectivitySavedExpansions`. The last counter records physical A*
expansions avoided within the available budget; `wasmRouteExpansions` retains
serial logical iteration accounting. The speed comparison also includes the compiled search
optimizations; it must not be described as thread scaling alone. A separate
compiled-one-thread comparison measures the additional effect of workers.

## Runtime and build

The backend supports one or four verified native execution threads and PCB ports
with at most two incident regions. A one-thread runtime can explicitly select it
with `parallelPortPointPathing: true`.

The checked-in kernel byte arrays make runtime compilation tools unnecessary.
To regenerate them with Zig 0.14.1:

```sh
ZIG=/path/to/zig bun scripts/build-route-kernel.ts
```

Run this from tiny-hypergraph. It checks the C++/TypeScript field layout and
compiles the route kernel and both owner-kernel memory variants. Rebuild embedded
autorouter workers afterward:

```sh
bun scripts/build-solver-workers.ts
```

Owner graphs and scratch arenas share a 1 GiB virtual reservation; pages are used
as geometry, graph rows, and labels are written. The graph occupies up to 256 MiB,
with a separate 192 MiB arena per execution thread. Capacity violations and
worker failures propagate as errors. Concurrent graph writes finish before a
search or snapshot replacement. Mutable route snapshots occupy the kernel's
shared memory directly, avoiding a second copy before each route.

## Measurement

The benchmark uses all 16 dataset18 (`srj18`) boards, Pipeline9, effort 1, and
caching disabled. Each pair has separately prepared pipeline states. Timing
includes phase construction, runtime construction, solving, worker startup,
synchronization, and disposal. Earlier pipeline phases are excluded. Boards and
comparisons run sequentially without concurrent tests or builds. `--isolate`
runs each timed solve in a fresh Bun process, preventing one mode's retained
memory or GC state from affecting the other.

Each pair must match solved/failed status, complete phase output hash, and phase
iteration count. Repetitions alternate execution order. Aggregate speedup is
summed reference wall time divided by summed accelerated wall time; it is not an
average of per-board ratios. The 2x target requires accelerated time no greater
than half the reference total.

```sh
bun scripts/benchmark/port-point-threading.ts \
  --threads 4 --repeat 3 --out port-point-4t.json

bun scripts/benchmark/port-point-threading.ts \
  --threads 4 --reference-threads 1 --repeat 1 --out port-point-scaling.json

bun scripts/benchmark/port-point-threading.ts \
  --isolate --threads 4 --repeat 1 --out port-point-isolated.json
```

Local confirmation was requested after Blacksmith access was unavailable. The
measurement environment uses Bun 1.4.4 with a four-CPU quota. Repository policy
otherwise directs benchmark runs to Blacksmith.

## Results

The overall target is met against the existing JavaScript phase: **2.072x** over all 16 boards and three repetitions. All 48 outcomes, output hashes, and logical iteration counts match.

| Comparison | Reference total | 4T total | Speedup | Exact outputs |
| --- | ---: | ---: | ---: | ---: |
| JavaScript, 3 passes | 337.826s | 163.067s | 2.072x | 48/48 |
| JavaScript, fresh process per solve, 1 pass | 106.889s | 53.188s | 2.010x | 16/16 |
| Compiled 1T, separate 1-pass control | 50.243s | 49.611s | 1.013x | 16/16 |

The repeated 4T total is 5.846s below the 2x threshold of 168.913s. The fresh-process check also meets the threshold, with a narrow margin. These are phase measurements, including native worker startup and disposal. Host process startup and preceding pipeline phases are excluded.

**The approximately 2x overall result is not 2x thread scaling.** Most of the gain comes from compiled searches and their data layout. The compiled control is only 1.26% faster at 4T in one pass; substantial scaling beyond compiled 1T is not established.

| Repetition | JavaScript | 4T | Speedup |
| --- | ---: | ---: | ---: |
| 1 | 106.538s | 53.488s | 1.992x |
| 2 | 114.890s | 53.908s | 2.131x |
| 3 | 116.399s | 55.671s | 2.091x |

The repeated run records 3,257,893 A* heap expansions avoided by parallel connectivity checks, across 1,146 checks. Helpers also built 2,716,712 blocker rows and 576,009 crossing masks. Logical budgets remain unchanged.

Across the 48 paired observations, phase p95 falls from 26.620s to 8.699s; p50 falls from 3.487s to 2.650s. Speedups vary by board.

| Board | Mean JavaScript | Mean 4T | Aggregate speedup |
| --- | ---: | ---: | ---: |
| sample001 | 1.286s | 1.343s | 0.958x |
| sample002 | 3.411s | 2.277s | 1.498x |
| sample003 | 1.128s | 1.334s | 0.846x |
| sample004 | 1.291s | 1.080s | 1.196x |
| sample005 | 0.838s | 0.910s | 0.920x |
| sample006 | 28.396s | 9.975s | 2.847x |
| sample007 | 3.487s | 2.693s | 1.295x |
| sample008 | 7.828s | 3.918s | 1.998x |
| sample009 | 1.905s | 2.009s | 0.948x |
| sample010 | 2.685s | 2.532s | 1.060x |
| sample011 | 4.445s | 2.785s | 1.596x |
| sample012 | 11.948s | 5.764s | 2.073x |
| sample013 | 7.184s | 3.913s | 1.836x |
| sample014 | 20.519s | 5.952s | 3.447x |
| sample015 | 13.945s | 5.993s | 2.327x |
| sample016 | 2.315s | 1.880s | 1.231x |

Raw reports: [paired JavaScript comparison](benchmarks/parallel-port-point-pathing-srj18.json), [fresh-process comparison](benchmarks/parallel-port-point-pathing-isolated.json), and [compiled 1T control](benchmarks/parallel-port-point-pathing-compiled-scaling.json).

Measured working trees are based on autorouter `72d3d4ce` and tiny-hypergraph `b20a36f`, using autorouter's pinned dataset18 revision `100e8957ce789b5b288e14c476dc83f4efc5214b`.

## Validation

Validation covers weighted route parity, exact owner/resource paths and insertion
order, single-layer crossings, section masks, endpoint and region reservations,
cache versions, completion budgets, shared-runtime leases, and error propagation.
All 170 tiny-hypergraph tests pass; subprocess tests require Bun on `PATH`.
Bun and Node worker bundles and autorouter declarations build successfully.
Integration tests compare complete Pipeline9 outputs with both transports, and
actual Node 24 full-pipeline and parallel-connectivity smoke tests also pass. Full-dataset validation compares
the port-point phase outputs; the small integration fixture covers later stages.
