# Parallel port-point search

The optional TypeScript backend is isolated in `tiny-hypergraph/lib/core-parallel`; workers and snapshot management live under `lib/parallel/`. The ordinary entry excludes worker code. No WASM, native kernel or native build tool is used.

Four persistent workers run the original distance-aware A* on private, consistent graph snapshots. The coordinator commits routes in their original order. Workers search upcoming routes while the current route completes, with bounded lookahead. The original indexed heap and search priorities are retained.

Completed work is first validated against its entire region read set. When versions changed, a winning path can still be reused if all intervening updates were additive, its ports remain legal and every segment retains exactly the same cost. Under the nonnegative intersection/via and quadratic density model, adding segments or congestion cannot reduce transition costs. An old minimum path whose cost is unchanged therefore remains minimum. Releases, removals, reordered segments and congestion decreases advance an invalidation generation. Work from an incompatible generation is canceled or rejected; changed path costs and assignments require a fresh search. Errors propagate.

The coordinator charges accepted search iterations against the existing logical budget. Speculative searches can perform extra physical work; metrics report this separately. Existing partial-route searches retain their serial implementation. Completion candidates use the asynchronous route backend. Runtime leases reserve the persistent group and release workers before later pipeline stages.

Bun and Node workers register `ParallelRouteSearchTask` explicitly. The runtime's verified persistent worker count enables this backend. Initialization uses the original constructor boundary, matching the base revision.

Metrics include acknowledged workers, actual participating workers, concurrent searches, charged expansions, speculative searches/expansions, stale results, accepted path certificates, worker search/snapshot time and graph synchronization time.

Validation covers weighted path costs, valid committed segments, overlapping nets, certificate reuse after additions, rejection of blocked paths and increased costs, invalidation after removals/releases, logical budgets, completion, worker failures, shared runtimes and entry-point isolation. The autorouter checks bundled and packed Bun/Node/browser consumers.

## Performance status

The prior synchronous hop-owner design did not meet the target. Full dataset18 [run 40476046145](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/40476046145), tiny-hypergraph `c8d64f2` / autorouter `baf7703e`, measured 149.616s → 141.915s summed port-point time (1.054x), with all 16 solved/DRC passing, while end-to-end time regressed 597.918s → 639.515s. Its near-2x sample-6 result was not representative.

The later asynchronous hop-owner prototypes failed sample 14 in repeated phase checks and were discarded. Those results do not describe the current route-level implementation.

The original-search/path-certificate revision requires fresh Blacksmith measurements. The target remains 2x faster summed `portPointPathingSolver` time against base at four threads, with unchanged solve/DRC outcomes. No gain is claimed for this revision while results are pending.

Run benchmarks on Blacksmith per repository policy. `/benchmark --dataset 18 --threads 4` compares both revisions on the same machine. The manual `Port-point parallel scaling` workflow runs isolated one-worker/four-worker pairs. It retains all failures and exits unsuccessfully when outcomes regress. Phase-only measurements do not validate downstream DRC; use the full pipeline comparison for that.
