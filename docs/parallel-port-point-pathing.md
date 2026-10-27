# Parallel port-point search

The optional TypeScript backend is isolated in `tiny-hypergraph/lib/core-parallel`; its implementation and worker protocol live under `lib/parallel/`. The ordinary entry excludes worker code. No WASM kernels, binary payloads or native build tools are used.

Four persistent workers divide a route's directed-hop A* frontier. Each hop has one owner, with a private indexed heap and cost labels. Workers exchange improved candidates in bounded batches. During expansion, published labels and the routing graph are frozen; barriers separate expansion, message delivery and global termination checks. Improved closed hops can reopen. Between expansion rounds, globally settled labels restore the original regional pruning optimization without treating speculative local pops as permanent closures. The search stops when every frontier lower bound reaches the best goal cost, or the global expansion budget is exhausted.

Routes still commit in their original order. Parallel expansion changes tie-breaking and iteration counts; exact serial replay is not part of this backend's contract. The coordinator charges the combined worker expansions against one iteration budget, rather than multiplying the budget by four. Existing partial-route searches keep their serial implementation. Completion candidates use the same asynchronous backend.

Runtime leases reserve the full persistent worker group to prevent barrier deadlocks between concurrent solves. Workers are released before later pipeline stages. Bun and Node workers explicitly register the tasks; the runtime's verified persistent worker count enables this backend. Worker failures propagate.

`parallelRouteWorkers` records acknowledged workers. `maximumParticipatingSearchWorkers` records workers that actually expand candidates in a route. Metrics include combined expansions, messages, batches and coordinator search wall time.

Validation covers single-route cost parity on weighted cyclic graphs, reconstructed segment validity, overlapping nets, global budgets, completion, transport errors, shared runtimes and entry-point isolation. The autorouter integration checks its bundled Bun and Node consumers.

The initial distributed-frontier revision (tiny-hypergraph `989c1f9`, autorouter `1c54a2d4`) was measured on sample 6 in [Blacksmith run 40475071346](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/40475071346):

| Metric | Base, 4 threads | PR, 4 threads |
| --- | ---: | ---: |
| Port-point phase | 39.714s | 19.962s |
| End-to-end | 72.826s | 73.104s |
| Solved / DRC passing | yes / yes | yes / yes |

The phase speedup is **1.989x**, slightly below the 2x target on this one board. Four acknowledged workers all performed search work. Routes changed: the downstream squared port-point count increased from 38,424 to 62,772, while estimated squared congestion decreased from 25.662 to 17.465. Later stages consumed the phase gain. This is a measured improvement over base, not a measurement of identical-workload 1-to-4-worker scaling.

The revision that restores settled-neighbor pruning (tiny-hypergraph `c8d64f2`, autorouter `baf7703e`) is under separate sample-6 and full dataset18 comparisons. The full 2x dataset target remains unconfirmed.

The prior region-table prototype regressed on the full dataset18 comparison: 145.262s to 227.340s for summed port-point phase time, with 16/16 solved and DRC passing on both revisions (Blacksmith run 40468865215). That result does not describe the distributed frontier implementation. A new comparison is required; no speedup is claimed while it is pending. The target remains 2x faster summed `portPointPathingSolver` time against base at four threads, with unchanged solve/DRC outcomes.

Run performance measurements on Blacksmith per repository policy. `/benchmark --dataset 18 --threads 4` compares both revisions on the same machine. The phase-only harness is `scripts/benchmark/port-point-threading.ts`; it reports output hashes and iteration counts, which may differ between serial and parallel searches.
