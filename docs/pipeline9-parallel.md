# Pipeline9 parallel proof

```ts
import { Pipeline9_Parallel, NodeSolverRuntime } from "@tscircuit/capacity-autorouter"

const runtime = new NodeSolverRuntime({ threads: 4 })
try {
  const solver = new Pipeline9_Parallel(problem, { runtime })
  solver.solve() // step() also stays synchronous
  if (solver.failed) throw new Error(solver.error ?? "Routing failed")
  const output = solver.getOutputSimpleRouteJson()
} finally {
  runtime.dispose()
}
```

Without an explicit runtime, this pipeline captures `SolverRuntime.defaultRuntime`, initially a `SingleThreadSolverRuntime`. Browser callers use that default. Constructing the Node runtime requires a Node-compatible host exposing `process.getBuiltinModule` (Node 22.3+); ordinary solver modules have no Node imports. The caller owns the worker pool and can reuse it across solves.

Only the high-density phase changes. It groups eight consecutive nodes into each job and commits up to 256 nodes per synchronous step. Both boundaries are fixed and independent of thread count. Jobs use the original high-density solver, including its existing recovery behavior. Results are validated and committed in the original reverse-pop node order after every job in the batch finishes. A failed batch commits nothing and reports the lowest indexed task error, regardless of completion order. Algorithm iteration budgets count logical work rather than worker time.

Preloaded fixed routes can be mutated by regional repairs. Such inputs retain the original sequential high-density state machine; they are not independent jobs. Other phases always retain Pipeline9's original implementations.

The runtime loads an explicit module/export descriptor rather than serializing functions or closures. `Atomics.wait` and synchronous message-port reads implement the barrier; the main thread blocks during each batch. This is intended for CLI execution. No asynchronous thread management is exposed to solvers. Each job receives private ordinary objects; `SharedArrayBuffer` values retain their shared backing storage and must be treated as read-only algorithm input. Workers share only synchronization storage in this proof; packing geometry into shared memory is future work.

The local `ParallelSolver` / `SolverRuntime` types follow the synchronous pattern proposed in [solver-utils #49](https://github.com/tscircuit/solver-utils/pull/49), with a worker module descriptor added. They are colocated for this executable proof while that API is unreleased.

## Validation

```sh
bun test --timeout 9999999 tests/features/pipeline9-parallel-srj18-sample01.test.ts tests/features/pipeline9-parallel-fixed-routes.test.ts tests/solver-runtime/node-runtime.test.ts tests/solver-runtime/parallel-failure.test.ts tests/solver-runtime/worker-module-error.test.ts
```

These check exact full output equality against Pipeline9, identical batch debug states under serial and 1/2/4 workers, fixed-route sequencing, input isolation, shared buffer transport, worker reuse/disposal, and deterministic failure selection.

For repeated source benchmarks under Bun:

```sh
bun scripts/benchmark/compare-pipeline9-parallel.ts
```

For Node, build the worker and benchmark runner, then compare three independent processes for each configuration:

```sh
bun run build
bun x tsup scripts/benchmark/pipeline9-parallel-proof.ts --format esm --out-dir dist
bun scripts/benchmark/compare-pipeline9-parallel.ts node dist/pipeline9-parallel-proof.js 3
```

Every run disables the pipeline cache, uses effort 1, and compares the entire serialized output byte for byte. Timings include cold worker startup and task-module loading. The phase runner records full phase timings and output hashes; the comparison runner fails if any output changes. Compare within one JavaScript host/version: Bun and Node are not assumed to produce byte-identical outputs to each other.

## Local benchmark

Dataset18 sample01, 583 high-density nodes, no preloaded fixed routes. Node v26.4.0, Apple M3 Pro (12 logical CPUs), three final verification trials per configuration. Blacksmith could not be reached because its backend hostname did not resolve in this session; these are local-machine results, not Blacksmith measurements. Cached dependencies were restored for the run; notably the available `@tscircuit/checks` is 0.0.253, below the manifest's requested ^0.0.255. Every compared configuration used the same dependencies.

| Configuration | Median high density | Median total |
| --- | ---: | ---: |
| Pipeline9 | 2.57 s | 8.55 s |
| Pipeline9_Parallel, 4 workers | 1.33 s | 7.34 s |

High density is **1.93× faster**; the full pipeline is **1.16× faster** (14.1% less time) in this final verification. Every full output matches exactly: SHA-256 `7390773a5fa503dbf9f4d574e7ebcde81d84c44b17dbf0c3a49ac61983818a4d`.

Local timings are noisy. An earlier 1/2/4-worker sweep showed a 1.6× high-density gain but effectively flat total medians (8.15 s versus 8.36 s) because other phase timings varied. The raw report retains both runs; confirm end-to-end gains on an isolated benchmark host before treating these totals as a stable performance claim. In the final reference run, high density represented about 30% of total time, below the previously observed 43%. Other phases therefore limit the total gain.

[Raw timings and environment](benchmarks/pipeline9-parallel-node-m3-pro.json). The ESM main and worker bundles build and load under Node. The five focused tests pass. A full workspace TypeScript check remains blocked by cached dependency API mismatches and an unavailable existing benchmark source file; it reported no diagnostics in the added implementation or tests.
