# Parallel Pipeline 9 prototype

`AutoroutingPipelineSolver9_Parallel` is an opt-in asynchronous Pipeline 9
implementation. It dispatches independent routing work to a local worker pool
and commits results in the serial solver's order. The existing
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
| Optional path simplification | Geometrically independent interaction components | Original route indexes, via operations, validation, and simplification loop budgets |

The pool is shared between these stages within a board. It queues jobs and
keeps at most `workerCount` jobs active. High-density routing starts likely
expensive nodes first while harvesting results in the original order. Shared
board context is sent once to each worker for that routing context rather
than retransmitted with every node.

Port-point pathing, topology, coordinated via changes, joint DRC work, and
other stages retain their serial execution. High-density routing with fixed
preloaded routes also keeps its existing sequential mutation path. Worker
exceptions propagate through the asynchronous solver and mark it failed.

## Reproducing the Blacksmith evaluation

Repository policy requires benchmark runs on Blacksmith. The custom job is
part of the existing `.github/workflows/benchmark.yml` workflow and runs on
`blacksmith-4vcpu-ubuntu-2404-arm`. Dispatch it against a branch that contains
the prototype and harness:

```sh
gh workflow run benchmark.yml \
  --repo tscircuit/tscircuit-autorouter \
  --ref YOUR_BRANCH \
  -f solver_name=parallel-prototype \
  -f ref=YOUR_BRANCH \
  -f same_machine_compare=false \
  -f benchmark_args_json='["--repetitions","3","--timeout-ms","180000","--parallel-path-simplification","1"]'
```

For a baseline profile run, use
`["--variants","baseline","--repetitions","1"]` as `benchmark_args_json`.
For a partial development check, add `--samples` followed by a comma-separated
list such as `1,4,16`. Baseline-only and partial runs cannot satisfy the full
acceptance gate.

The job finds four CPUs from its allowed CPU list and launches the controller
under `taskset`. Child processes and worker threads inherit that affinity.
The coordinator and all workers therefore share the same four-CPU budget;
`workerCount: 4` does not add a fifth CPU to the benchmark budget.

The immutable serial baseline is commit
`65522c89c370d4b4f9f69e1a79af58de641752bc`. The job checks it out separately and
bundles its repository sources against the same installed dependencies used
by the prototype. `scripts/parallel-benchmark/buildBaseline.ts` externalizes
dependency packages explicitly and rejects remaining external `lib/*`
imports, preventing those imports from resolving to rewritten sources.

SRJ18 is pinned by the dependency specifier to
`100e8957ce789b5b288e14c476dc83f4efc5214b`. The harness asserts exactly
`sample001` through `sample016` and records SHA-256 hashes of their JSON files.
Both variants receive independently cloned inputs from that same dataset.

## Timing, quality, and acceptance

The default evaluation uses three paired repetitions at effort 1. It routes
one board at a time, alternating baseline/prototype order across samples and
repetitions. Each variant runs in a separate child process. In-memory solver
caching is disabled with `cacheProvider: null`.

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
all 16 samples to complete successfully. It also requires matching SHA-256
hashes of the full simplified trace outputs, unchanged trace and via counts,
and no per-sample DRC or per-type trace-lint regression. Both arithmetic mean
and aggregate speedup must be at least 2×. Missing samples, duplicate runs,
failed routes, timeouts, and missing quality evidence cannot pass the gate.

DRC uses the existing benchmark's `evaluateRelaxedDrc` evaluator and rule
preset. Exact trace hashes provide a stronger equivalence check for this
deterministic execution rewrite; they do not independently establish that
the baseline's routes satisfy every manufacturing rule.

The `parallel-prototype-srj18` artifact contains metadata, the installed
dependency list, progressive checkpoints, and final JSON/Markdown reports.
Each run directory contains its result, progress/stage profiles, stderr,
routed SRJ, and full DRC/lint evidence when routing succeeds. Results include
worker-pool and per-stage statistics so the remaining serial bottlenecks can
be distinguished from worker scheduling and serialization costs.

## Current limitations

- A large connected path-simplification component remains sequential. Small
  jobs may cost more to serialize and schedule than they save in parallel work.
- Fixed preloaded-route mutation retains the serial high-density path.
- Serial topology, port-point pathing, joint DRC, and other coordinated stages
  limit the possible whole-board speedup even when node work scales well.
- The benchmark verifies the Bun runtime and its worker implementation.
  Other runtime and deployment combinations need separate validation.
- Persistent-pool throughput is useful for applications routing many boards,
  but it is not the cold-latency acceptance metric used here.

## Evaluation results

Pending the complete paired dataset run. Add its artifact/run reference,
source SHAs, per-sample medians and outcomes, aggregate metrics, and quality
comparison before making a performance claim.
