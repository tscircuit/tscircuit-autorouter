# Parallel port-point pathing

Pipeline9 enables the optional TypeScript worker backend when the runtime requires four workers. Its public entry point is `tiny-hypergraph/lib/core-parallel`; the ordinary `lib/index` entry excludes worker code. The backend uses the original TypeScript A* implementation. It contains no WebAssembly kernels, embedded binaries or native build step.

## Work distribution

Four persistent routing workers search different upcoming routes concurrently. The coordinator commits results in the original route order. Every worker copies a consistent graph snapshot using a shared epoch, then works on private assignment, congestion and intersection-cache data. Static topology and problem data are sent once when a worker starts. Shared versioned cache rows avoid sending the entire graph for every route.

A tracking candidate queue records every region expanded by a search. Before accepting a result, the coordinator checks that every recorded region still has the same version. Versions cover port assignments, congestion and region intersection caches. A stale result is discarded and the route is searched again against the current graph. This is optimistic concurrency control, not a recovery path for worker errors; transport or solver errors reject the solve.

Searches may run ahead up to sixteen pending routes so workers can remain occupied while an earlier route takes longer. Only eligible whole-route searches run in workers; partial-route planning, selective rerips and final route acceptance stay with the coordinator. Route output, commit order and logical iteration budgets remain those of the serial solver. Unused speculative work does not consume the logical solver budget.

The worker group acquires a runtime lease and releases all workers before the high-density stages. Completion searches use the same coordinator. Cancellation checkpoints stop obsolete or disposed jobs, and worker failures propagate to the caller.

## Metrics and verification

`parallelRouteWorkers` records the number of workers that acknowledged startup. `maximumConcurrentRouteSearches` records concurrent dispatch, and `parallelRouteSearches` counts accepted route results. `speculativeRouteSearches`, `staleRouteSearches` and `speculativeRouteExpansions` expose work amplification and invalidation.

Tests cover overlapping routes, stale-result rejection, exact route/iteration parity, completion budgets, concurrent use of a shared runtime, worker errors and module isolation. The autorouter integration test uses the bundled Bun and Node workers and checks that four workers start and multiple route searches are dispatched concurrently.

## Performance

The previous WASM-assisted measurements do not apply to this implementation and have been removed. The TypeScript worker backend needs a fresh Blacksmith comparison with `/benchmark --dataset 18 --threads 4`. The target remains a 2x improvement in summed `portPointPathingSolver` time against the base at four threads, while retaining outcomes and iteration accounting.

A phase-only diagnostic harness is available at `scripts/benchmark/port-point-threading.ts`. `--reference-threads 0` selects the serial TypeScript solver; `--reference-threads 1` selects one TypeScript routing worker. Follow the repository policy requiring Blacksmith for benchmark runs.
