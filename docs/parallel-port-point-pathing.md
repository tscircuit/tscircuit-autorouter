# Parallel port-point pathing

The optional TypeScript implementation is isolated in `tiny-hypergraph/lib/core-parallel.ts`, with worker and snapshot code under `lib/parallel/`. The ordinary entry excludes worker code. There is no WASM, native kernel, binary payload or native build step.

Four persistent workers search upcoming whole routes on private, consistent graph snapshots within a four-route lookahead window. The coordinator commits in original route order. It accepts cached work only when every region in the search read set retains the same version. Changed assignments, congestion or intersection caches invalidate speculative results; in-flight searches stop early when a region they have read changes. This preserves search paths and logical expansion budgets, including minimum-cost ties. Partial-route searches retain their serial implementation.

Workers use packed numeric A* frontiers, prefiltered legal destination lists and scalar lower bounds before geometric calculations. They retain the original indexed heap comparisons, tie order, cost arithmetic and iteration counts. Candidate objects are reconstructed only when returning a path. Workers receive numeric routing data without application metadata; snapshots supply existing assignments. The serial solver and scorer remain unchanged. There is no approximate cost allowance or changed-snapshot path certificate.

Persistent-runtime leases prevent overcommitment. Bun and Node explicitly register the worker task; a verified persistent worker count enables the implementation. Completion candidates reuse the asynchronous implementation, errors propagate, and the route group releases its workers before later high-density stages. Initialization retains the original constructor timing boundary.

Metrics record acknowledged and actually participating workers, concurrency, accepted logical expansions, observed speculative work, stale searches, worker search/snapshot time and graph synchronization time. Speculation can perform additional physical work. Configuring four threads alone does not establish a speedup.

Validation includes exact serial/four-worker path, assignment and iteration parity on overlapping nets and negotiated rerips; changed read sets, blocked paths, terminal costs, removals, budgets, completion, worker failures, shared runtimes, seeded assignments and module isolation. The autorouter checks bundled and packed Bun/Node/browser consumers.

## Performance validation

The target is 2x faster summed `portPointPathingSolver` time against base at four threads, with successful downstream routing and DRC. The measured implementation is autorouter `9b022de8f2771ff3a87133bcdc53eb15e722ff7a`, pinning tiny-hypergraph `577feca9ac7a70df298333ab90ee0991cf78dcfe`.

The exact requested `/benchmark --dataset 18 --threads 4` completed in [40526921244](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/40526921244). Both revisions ran on the same Blacksmith 8-vCPU ARM machine with Bun 1.4.2. Times below sum all 16 boards, including any failed or partial samples; none failed or timed out.

| Measurement | Base, four threads | PR, four threads | Result |
| --- | ---: | ---: | --- |
| Port-point phase | 154.547s | 105.331s | 1.467x faster; 31.8% less time |
| Total routing time | 627.741s | 573.873s | 8.6% less time |
| Solved / DRC passed | 16 / 16 | 16 / 16 | No outcome regressions |
| Timeouts / DRC errors | 0 / 0 | 0 / 0 | No failures |

All 16 PR boards recorded four actually participating search workers. The 2x phase target is **not met**: this run would require 77.273s or less, another 26.6% reduction from the measured PR time.

The isolated comparison [40526849022](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/40526849022) used the same TypeScript implementation with one and four workers. One worker took 113.459s; four took 116.358s (0.975x). All 16 output hashes and iteration counts matched, and all 16 used four participating workers. Three alternating pairs for samples 6 and 14 in [40526866687](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/40526866687) also matched on every pair, but four workers were slower (0.962x).

Thus, the gain against the existing autorouter includes the packed TypeScript search optimizations; it does not demonstrate useful scaling over this implementation's one-worker mode. The isolated four-worker run performed 29.5 million observed expansions for 18.3 million accepted expansions and rejected 3,746 stale searches. Conflicting graph updates remain the limiting factor.

Two separate experiments retained exact output parity but did not establish useful scaling: lazy shared graph views measured 1.005x in [40529319848](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/40529319848), and geographically spaced searches across a 16-route lookahead measured 0.994x in [40531036928](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/40531036928). The wider lookahead increased observed work to 51.2 million expansions. Neither experiment is part of the pinned implementation.

Run benchmarks on Blacksmith per repository policy. `/benchmark --dataset 18 --threads 4` compares both revisions on the same machine. The manual `Port-point parallel scaling` workflow runs isolated one-worker/four-worker phase pairs and fails on incomplete solves, changed output hashes or changed iteration counts. Phase-only measurements do not validate downstream DRC; the full pipeline comparison does.
