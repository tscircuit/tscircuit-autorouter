# Parallel port-point pathing

The optional TypeScript backend is isolated in `tiny-hypergraph/lib/core-parallel.ts`, with worker and snapshot code under `lib/parallel/`. The ordinary entry excludes worker code. No WASM, native kernel, binary payload or native build tool is used.

Four persistent workers search upcoming whole routes on private, consistent graph snapshots, within a four-route lookahead window. The coordinator commits in original route order. It accepts cached work only when every region in the search read set retains the same version. Changes to assignments, congestion or intersection caches trigger a fresh search. This preserves search paths and logical expansion budgets, including when different minimum-cost paths exist. Partial-route searches retain their serial implementation.

Workers use packed numeric A* frontiers while retaining the original indexed heap comparisons, tie order, cost arithmetic and iteration counts. Candidate objects are reconstructed only when returning a path. The serial solver and scorer remain unchanged. No approximate cost allowance or changed-snapshot path certificate is used.

Persistent-runtime leases prevent overcommitment. Bun and Node explicitly register the worker task; the verified persistent worker count enables the backend. Completion candidates reuse the asynchronous backend, errors propagate, and the route group releases its workers before later high-density stages. Initialization retains the original constructor timing boundary.

Metrics record acknowledged and actually participating workers, concurrency, accepted logical expansions, observed speculative work, stale searches, worker search/snapshot time and graph synchronization time. Speculation can perform additional physical work.

Validation includes exact serial/four-worker path, assignment and iteration parity on overlapping nets and negotiated rerips; changed read sets, blocked paths, terminal costs, removals, budgets, completion, worker failures, shared runtimes and module isolation. The autorouter checks bundled and packed Bun/Node/browser consumers.

## Performance validation

The target is 2x faster summed `portPointPathingSolver` time against base at four threads, with successful downstream routing and DRC.

The discarded bounded-certificate version measured 149.630s → 99.959s (1.497x) in full dataset18 run [40495787529](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/40495787529). All 16 solved and passed DRC under that benchmark's timeout, but end-to-end time regressed 597.299s → 804.216s. A separate sample-6 run timed out after 180 seconds downstream. Exact-cost certificates also changed budgeted routing outcomes; the attempted worker score cache did not improve performance. These implementations are not used.

The current strict-read-set implementation requires fresh measurements. No target achievement is claimed while they are pending.

Run benchmarks on Blacksmith per repository policy. `/benchmark --dataset 18 --threads 4` compares both revisions on the same machine. The manual `Port-point parallel scaling` workflow runs isolated one-worker/four-worker phase pairs and fails on incomplete solves, changed output hashes or changed iteration counts. Phase-only measurements do not validate downstream DRC; the full pipeline comparison does.
