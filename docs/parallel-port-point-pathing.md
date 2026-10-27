# Parallel port-point scoring

The optional TypeScript backend is isolated in `tiny-hypergraph/lib/core-parallel`. The normal library entry excludes worker code. No WASM kernels, binary payloads or native build tools are used.

## Work distribution

Four persistent workers prepare exact region transition-cost tables. The original TypeScript A* queue and route commits run on the caller, preserving route order, paths and logical iteration budgets. This avoids speculative route searches and their invalidation/rework.

For each eligible region, workers compute a symmetric matrix of the marginal region cost of every pair of incident ports. The matrix is keyed by region version and by the current route net when that net already occurs in the region; other nets share the same route-independent table. It includes intersection, layer-transition and density costs; the caller adds congestion, port penalties and distance in the original arithmetic order. Dense regions are split into independent 16-row chunks. A 256 MiB arena bounds quadratic storage, allocating smaller regions first; any region beyond that budget keeps its ordinary scorer.

Tables are cached by region version. Region changes queue new preparation work; unchanged tables are reused across routes and nets. Workers claim disjoint region jobs from a shared queue, and each worker receives an initial job when sufficient work exists. The coordinator waits for all workers before searching or mutating graph state. Shared cache arrays remain read-only until the barrier completes.

The serial solver exposes only an optional generic region-cost provider. The parallel pool and worker protocol remain under `lib/parallel/`. Runtime leases prevent competing solves from overcommitting persistent workers, and all workers are released before the later high-density stages. Completion candidates reuse tables when topology, problem and scoring settings match.

## Verification

`parallelRouteWorkers` records acknowledged workers. `maximumParticipatingCostWorkers` records workers that actually compute tables during a round. Metrics expose tables/cells prepared, worker and preparation time, cache hits/misses and caller search time.

All 168 tiny-hypergraph tests pass, including exact scoring parity for owned nets, single-layer crossings, port penalties, congestion, density and cache changes. Twelve overlapping-net cases compare exact routes and iteration budgets. Tests also cover completion, failures, shared runtimes and module isolation. Bundled Bun and Node consumers are checked in the autorouter.

## Performance status

The WASM-assisted results do not apply and were removed. The first TypeScript route-speculation prototype regressed 23.2% on dataset18 despite correct outcomes and four active workers. Prioritizing commits and refreshing snapshots reduced wasted work but remained 6.7% slower on sample 6. Those results motivated moving parallel work to independent region scoring instead.

The first region-table prototype excluded dense and owned-net regions and regressed 20.3% on sample 6. The current revision covers both and divides dense work among workers; its performance is pending. The region-scoring backend requires a fresh `/benchmark --dataset 18 --threads 4`. No speedup is claimed until that comparison completes. The target remains 2x faster summed `portPointPathingSolver` time against base at four threads, with unchanged outcomes.

The phase-only harness is `scripts/benchmark/port-point-threading.ts`; `--reference-threads 0` selects ordinary serial TypeScript, and `--reference-threads 1` selects one scoring worker. Run benchmarks on Blacksmith per repository policy.
