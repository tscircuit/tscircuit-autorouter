# Parallel node repair

Pipeline9 (including the networked pipeline) accepts an optional `parallelRepair`
configuration. Use a worker pool or remote executor to run each node's repair on a
separate CPU. The library does not create workers; the caller owns their lifecycle.

```ts
import { AutoroutingPipelineSolver } from "@tscircuit/capacity-autorouter"

const solver = new AutoroutingPipelineSolver(srj, {
  parallelRepair: {
    concurrency: 4,
    executor: (input) => repairWorkerPool.execute(input),
  },
})
await solver.solveAsync()
```

Inside the workers, pass each input to the exported `solveHighDensityRepairSample`
helper and return its result. The input and result are structured-clone compatible.
The helper uses exactly the existing node repair policy, including boundary settings,
margin, and clearance statistics. Merely wrapping the helper in a promise on the
main thread does not parallelize CPU work.

`concurrency` defaults to 4 and must be a positive integer. It bounds dispatched,
unconsumed samples, including completed results awaiting an earlier node. Each
executor receives an isolated copy of the original sample. Results and statistics
are consumed in the original node order, and routes retain their original output
order and metadata. Worker completion order does not affect the output.

Use `solveAsync()`, `stepAsync()`, or `solveUntilPhaseAsync()` when parallel repair
is enabled. The synchronous solve methods reject this configuration. Applications
with their own stepping loop can await the pending effects on the active solver.
Executor failures fail the repair stage at that node; they are not retried locally.

The `Pipeline4HighDensityRepairSolver` stage also accepts `parallelRepair` directly
and provides `solveAsync()`. The board-wide repair stages retain their existing
execution order. Omitting `parallelRepair` uses the existing synchronous node
repair path.

## Benchmarking on multiple cores

Dispatch `benchmark.yml` on the PR branch with `parallel_repair_compare=true`.
The dedicated job uses a 16-vCPU Blacksmith runner and benchmarks one board at a
time with a persistent pool, comparing sequential repair with 2, 4, and 8 workers.
For example, set `benchmark_args_json` to:

```json
["--dataset", "dataset01", "--limit", "10", "--repeats", "3", "--worker-counts", "2,4,8"]
```

The harness verifies Linux CPU affinity, effective cgroup quota, and each worker's
inherited CPU access. It requires capacity for the repair workers plus the
coordinator, so a many-core host with a restrictive process quota fails the run.
It reports pool startup separately, sums per-sample median stage and total routing
times, rotates run order, and compares final SRJ hashes and repair statistics for
every run. Raw results and CPU metadata are uploaded as an artifact and the
summary is posted to the specified `pr_number`. Failed boards are reported and
excluded from timing aggregates.
