# Solver execution interface

`SolverExecutor` is a common structural contract for executing typed solver tasks.
The host owns execution resources; solvers own the routing algorithm and the
order in which results affect it. This initial interface does not dispatch any
autorouter work, create workers, or change synchronous solver behavior.

## Task catalogs

Each solver defines its own task catalog. Inputs, results, and shared context
must be structured-cloneable data. A worker entrypoint registers handlers by
task kind; callbacks and solver instances do not cross the worker boundary.
Use namespaced task kinds when combining catalogs from different packages.

```ts
import type {
  SolverExecutor,
  SolverTaskDefinition,
} from "@tscircuit/capacity-autorouter"
import { createSharedSolverBuffer } from "@tscircuit/capacity-autorouter"

type RouteAnalysisTasks = {
  "hypergraph/analyze-route": SolverTaskDefinition<
    { routeId: number },
    { usedPortIds: number[]; iterations: number },
    { routeEnds: SharedArrayBuffer }
  >
}

async function analyzeRoutes(
  executor: SolverExecutor<RouteAnalysisTasks>,
  endpoints: Int32Array,
): Promise<number[][]> {
  const shared = { routeEnds: createSharedSolverBuffer(endpoints) }
  const routeCount = endpoints.length / 2
  const results = await Promise.all(
    Array.from({ length: routeCount }, (_, routeId) =>
      executor.execute("hypergraph/analyze-route", { routeId }, { shared }),
    ),
  )
  return results.map((result) => result.usedPortIds)
}
```

The example is a proposed task definition, not a registered handler. The
autorouter's exported `AutorouterTaskMap` starts empty and will grow with actual
task implementations. Its `AutorouterExecutor` alias is accepted as the optional
`executor` in `AutoroutingPipelineSolverOptions`. Pipeline9's networked variant
inherits that option. Supplying it does not enable parallelism yet.
The pipeline retains the resource as `solver.executor`; its copied `opts` and
`getConstructorParams()` exclude the executor so reproduction data stays portable.

Other solver packages can define the same structural contract or eventually
import it from a neutral package without a runtime dependency on their parent
autorouter. A host can pass one executor implementing a combined task catalog to
multiple solvers. Pass `{ shared: undefined }` for tasks without shared context.

## Shared memory ownership

`createSharedSolverBuffer(view)` copies only a view's visible bytes into a new,
fixed-size `SharedArrayBuffer`. Reconstruct the appropriate typed view in the
handler, for example `new Int32Array(context.shared.routeEnds)`. Allocation and
initialization happen once; structured cloning a shared buffer or a view backed
by it shares storage rather than copying its bytes. `SolverSharedMemory` is an
optional named-buffer shape for task catalogs that need several allocations.

Initialize shared topology before submitting tasks and keep it immutable until
all consuming requests settle. `readonly` and `Object.freeze()` do not prevent
writes to shared bytes. Keep mutable occupancy, heaps, random generators, and
search state private to each task. If a future task writes shared output, give it
an exclusive range and publish completion before the coordinator reads it.

Do not put shared buffers into a transfer list. This interface intentionally has
no transfer-list API: detaching ordinary buffers can change serial behavior.
Inline executors must clone ordinary inputs, context, and outputs just as a
worker transport does; shared buffers retain their shared backing storage.

## Deterministic execution

The executor can finish requests in any order. The solver must consume results
and task failures in original logical order, including existing first-success
rules, floating-point reductions, and tie behavior. Promise rejection arrival
order must not select a routing result. Infrastructure failure must surface as a
failure, not successful partial routing.

Seeds, candidate sets, cache visibility, and iteration limits belong to solver
inputs and policy. They must not depend on worker count, worker identity, or
completion order. Task-specific outputs must report whatever logical work or
prefix state their coordinator needs to reproduce existing iteration limits.
Waiting for a request consumes no solver iterations. This interface alone does
not establish single-core parity; each task integration must verify it against
the existing serial implementation, including warm caches and budget boundaries.

The host creates one executor and retains it across phases and subsolvers. Only
that owner calls `dispose()` after all solvers have stopped. Disposal stops new
submissions, settles outstanding requests, and releases workers. Keep executor
references and shared storage out of SRJ, algorithm cache keys, diagnostic JSON,
and serialized CLI job options.

Worker-thread adapters, CLI flags, common async stepping, and individual solver
task handlers will be introduced separately. Browser worker support is not
required; Node-specific imports belong in the future host adapter.
