# Pipeline9 solver runtime

Pipeline9 and its high-density phase accept a host-owned solver runtime:

```ts
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "@tscircuit/capacity-autorouter"
import { createAutorouterSolverRuntime } from "@tscircuit/capacity-autorouter/runtime/bun"
// On Node, use /runtime/node instead.

const runtime = createAutorouterSolverRuntime({
  workerCount: 4,
  requireWorker: true,
})
try {
  const solver = new Pipeline9(input, { cacheProvider: null })
  await solver.solveAsync(runtime)
  const output = solver.getOutputSimpleRouteJson()
} finally {
  await runtime.dispose()
}
```

A direct `Pipeline9HighDensitySolver` caller can likewise call
`await phase.solveAsync(runtime)` and read `phase.routes`. Keep the pipeline/phase
on the host so its child tasks can use the pool. Reuse the runtime across solves;
only its owner disposes it. Threaded Bun execution requires Bun 1.4.2+.

## Execution and parity

- `.step()` and `.solve()` retain their synchronous implementation.
- `.solveAsync()` without a supplied runtime calls `.solve()` directly, including
  in browsers and eval's existing worker. This avoids batch creation and runtime
  input/output copying when no pool is requested. The high-density phase retains
  bounded synchronous stepping when an explicit iteration limit is supplied.
  The default package entry imports no Node worker adapter or embedded worker payload.
- Independent nodes run through the registered `Pipeline9HighDensityBatchSolver`,
  four nodes per task. Its explicit static `solverName` supplies the registration
  key. Connectivity data crosses as a net map and is reconstructed in each task;
  callbacks and domain instances are not sent to workers.
- Consume outcomes in the original serial node-pop order. Preserve terminal port
  IDs, route ordering, statistics, and logical iteration counts. When a task
  crosses a phase or outer-pipeline iteration budget, execute the remaining
  serial prefix to stop at the exact original step.
- Preloaded-copper problems stay serial: regional repairs may change obstacles
  observed by later nodes. This is a dependency rule, not error recovery.
- Runtime errors reject and mark routing failed. There is no retry of failed
  worker execution. Concurrent `solveAsync` calls on one instance are rejected.
- Full-pipeline async orchestration periodically yields between synchronous
  steps. Its runtime integration currently parallelizes only high density.
  Do not mutate/step the same solver concurrently with an active async solve.

## Packaging and scope

The package build bundles and embeds separate Bun ESM and Node CommonJS worker
programs, including their registrations and algorithm dependencies. Optional
`/runtime/bun` and `/runtime/node` factories supply the corresponding source to
solver-utils; consumers need no adjacent worker file URL. Generated worker
sources are build artifacts, not checked-in code.

`scripts/check-solver-runtime-packaging.ts` packs the real tarball, verifies
complete output/statistics/iteration parity on Bun and Node with both external
and minified rebundled consumers, requires actual task dispatch, and exercises
browser inline solving. It materializes solver-utils/object-hash and bundles the
real graphics-debug peer for the isolated check; it does not simulate a fresh
network dependency installation.

Core/eval/CLI runtime injection remains separate. Core can keep stepping for
debugging; an async caller must pass the runtime to activate threads. The host
must coordinate its thread budget with concurrent files/samples and handle
runtime disposal on cancellation. This API does not yet provide per-task
cancellation or preview streaming.
