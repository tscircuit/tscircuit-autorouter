# Parallel port-point pathing

The optional TypeScript implementation is isolated in `tiny-hypergraph/lib/core-parallel.ts`, with worker and snapshot code under `lib/parallel/`. The ordinary entry excludes worker code. There is no WASM, native kernel, binary payload or native build step.

Four persistent workers search upcoming whole routes on private, consistent graph snapshots within a four-route lookahead window. The coordinator commits in original route order. It accepts cached work only when every region in the search read set retains the same version. Changed assignments, congestion or intersection caches invalidate speculative results; in-flight searches stop early when a region they have read changes. This preserves search paths and logical expansion budgets, including minimum-cost ties. Partial-route searches retain their serial implementation.

Workers use packed numeric A* frontiers, prefiltered legal destination lists and scalar lower bounds before geometric calculations. They retain the original indexed heap comparisons, tie order, cost arithmetic and iteration counts. Candidate objects are reconstructed only when returning a path. Workers receive numeric routing data without application metadata; snapshots supply existing assignments. The serial solver and scorer remain unchanged. There is no approximate cost allowance or changed-snapshot path certificate.

Persistent-runtime leases prevent overcommitment. Bun and Node explicitly register the worker task; a verified persistent worker count enables the implementation. Completion candidates reuse the asynchronous implementation, errors propagate, and the route group releases its workers before later high-density stages. Initialization retains the original constructor timing boundary.

Metrics record acknowledged and actually participating workers, concurrency, accepted logical expansions, observed speculative work, stale searches, worker search/snapshot time and graph synchronization time. Speculation can perform additional physical work. Configuring four threads alone does not establish a speedup.

Validation includes exact serial/four-worker path, assignment and iteration parity on overlapping nets and negotiated rerips; changed read sets, blocked paths, terminal costs, removals, budgets, completion, worker failures, shared runtimes, seeded assignments and module isolation. The autorouter checks bundled and packed Bun/Node/browser consumers.

## Performance validation

The target is 2x faster summed `portPointPathingSolver` time against base at four threads, with successful downstream routing and DRC. It has not been reached.

The preceding strict implementation measured 161.020s → 125.428s (1.284x, 22.1% less phase time) in the full dataset18 comparison [40511314731](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/40511314731). All 16 boards solved and passed DRC in both revisions, and all 16 used four participating search workers. Summed end-to-end time improved 672.086s → 628.830s (6.4%). These figures precede the final frontier and worker-input optimizations.

The compact-frontier experiment preserved all 16 output hashes and iteration counts in [40514128709](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/40514128709), but its own one-worker time was 115.414s versus 124.716s with four workers (0.925x). Repeated samples 6 and 14 also matched; targeted full-pipeline samples 6, 8 and 14 all solved and passed DRC in [40514240384](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/40514240384). The improvement against the old autorouter therefore does not demonstrate scaling over this implementation's one-worker mode.

The final pinned revision is being measured again with `/benchmark --dataset 18 --threads 4` and isolated one-worker/four-worker phase pairs. Final results will replace these preliminary figures when complete.

Run benchmarks on Blacksmith per repository policy. `/benchmark --dataset 18 --threads 4` compares both revisions on the same machine. The manual `Port-point parallel scaling` workflow runs isolated one-worker/four-worker phase pairs and fails on incomplete solves, changed output hashes or changed iteration counts. Phase-only measurements do not validate downstream DRC; the full pipeline comparison does.
