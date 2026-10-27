# Parallel port-point search

The optional TypeScript backend is isolated in `tiny-hypergraph/lib/core-parallel`; its implementation and worker protocol live under `lib/parallel/`. The ordinary entry excludes worker code. No WASM kernels, binary payloads or native build tools are used.

Four persistent workers divide a route's directed-hop A* frontier. Each hop has one owner, with a private indexed heap and cost labels. Workers exchange improved candidates in bounded batches. During expansion, published labels and the routing graph are frozen; barriers separate expansion, message delivery and global termination checks. Improved closed hops can reopen. The search stops when every frontier lower bound reaches the best goal cost, or the global expansion budget is exhausted.

Routes still commit in their original order. Parallel expansion changes tie-breaking and iteration counts; exact serial replay is not part of this backend's contract. The coordinator charges the combined worker expansions against one iteration budget, rather than multiplying the budget by four. Existing partial-route searches keep their serial implementation. Completion candidates use the same asynchronous backend.

Runtime leases reserve the full persistent worker group to prevent barrier deadlocks between concurrent solves. Workers are released before later pipeline stages. Bun and Node workers explicitly register the tasks; the runtime's verified persistent worker count enables this backend. Worker failures propagate.

`parallelRouteWorkers` records acknowledged workers. `maximumParticipatingSearchWorkers` records workers that actually expand candidates in a route. Metrics include combined expansions, messages, batches and coordinator search wall time.

Validation covers single-route cost parity on weighted cyclic graphs, reconstructed segment validity, overlapping nets, global budgets, completion, transport errors, shared runtimes and entry-point isolation. The autorouter integration checks its bundled Bun and Node consumers.

The prior region-table prototype regressed on the full dataset18 comparison: 145.262s to 227.340s for summed port-point phase time, with 16/16 solved and DRC passing on both revisions (Blacksmith run 40468865215). That result does not describe the distributed frontier implementation. A new comparison is required; no speedup is claimed while it is pending. The target remains 2x faster summed `portPointPathingSolver` time against base at four threads, with unchanged solve/DRC outcomes.

Run performance measurements on Blacksmith per repository policy. `/benchmark --dataset 18 --threads 4` compares both revisions on the same machine. The phase-only harness is `scripts/benchmark/port-point-threading.ts`; it reports output hashes and iteration counts, which may differ between serial and parallel searches.
