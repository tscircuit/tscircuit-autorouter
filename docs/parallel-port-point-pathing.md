# Parallel port-point search

The optional TypeScript backend is isolated in `tiny-hypergraph/lib/core-parallel`; its implementation and worker protocol live under `lib/parallel/`. The ordinary entry excludes worker code. No WASM kernels, binary payloads or native build tools are used.

Four persistent workers own disjoint directed-hop labels and private indexed heaps. They exchange improved candidates through bounded single-producer/single-consumer rings. Payload publication and slot reuse use atomic counters. Shared cost bounds use versioned reads to reject a potentially torn Float64; each batch caches valid upper bounds to reduce repeated atomic reads. Only the owning worker updates a hop's exact label and predecessor. Owner storage is separated to avoid cache-line contention.

The routing graph remains frozen during each route. Workers expand and deliver messages independently. When work appears exhausted or the shared expansion budget is consumed, the coordinator requests a pause. Workers first stop expansion while continuing to drain channels, so a producer cannot deadlock on a full channel. Once every producer has stopped, workers finish draining and acknowledge a stable frontier. The coordinator then checks the goal bound and frontier minima, or resumes the search if more work remains.

Routes commit in their original order. Parallel expansion changes tie-breaking, paths and iteration counts; exact serial replay is not a contract. Every worker expansion consumes one shared budget token. Existing partial-route searches retain their serial implementation. Completion candidates use the same asynchronous backend.

Runtime leases reserve a full persistent worker group. Bun and Node workers register the task explicitly, and the runtime's verified worker count enables parallel routing. Errors propagate, and workers are released before later stages. Graph initialization uses the original constructor boundary, matching the base revision; no deferred initialization or separate warmup task remains.

`parallelRouteWorkers` records acknowledged workers. `maximumParticipatingSearchWorkers` records workers that actually expand candidates. Other metrics include combined expansions, messages, batches and coordinator search wall time.

Validation covers weighted single-route cost parity, reconstructed segments, overlapping nets, shared budgets, completion, real worker failures, transport errors, shared runtimes and entry-point isolation. The autorouter checks bundled and packed Bun, Node and browser consumers.

## Performance status

The prior synchronous-batch implementation did not meet the target. Full dataset18 [Blacksmith run 40476046145](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/40476046145), tiny-hypergraph `c8d64f2` / autorouter `baf7703e`, measured 149.616s → 141.915s summed port-point phase time (1.054x). Both revisions solved and passed DRC on all 16 boards. Summed end-to-end time regressed 597.918s → 639.515s. Its approximately 2x sample-6 improvement was not representative of the full dataset.

A separate same-backend one-worker/four-worker phase comparison measured 1.266x across all 16 inputs ([run 40477576684](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/40477576684)); three sample-6 pairs measured 2.081x ([run 40477389101](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/40477389101)). Search ordering and expansion counts differed, so these are not identical-workload scaling measurements.

The asynchronous-channel revision requires fresh measurements. The target remains 2x faster summed `portPointPathingSolver` time against base at four threads, with unchanged solve/DRC outcomes. No gain is claimed for the current revision while results are pending.

Run benchmarks on Blacksmith per repository policy. `/benchmark --dataset 18 --threads 4` compares both revisions on the same machine. The `Port-point parallel scaling` workflow runs `scripts/benchmark/port-point-threading.ts` with one and four workers in isolated, alternating pairs. Its phase-only output does not validate downstream DRC; use the full pipeline comparison for that.
