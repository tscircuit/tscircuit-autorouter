# Experiment: compact A01 frontier and collision state

The hypothesis is that the measured A01 leaf spends avoidable work allocating
object labels, processing duplicate queue entries and scanning linked victim
histories. This branch replaces those representations in the normal
`PortfolioSingleIntraNodeSolver` A01 candidates. It does not change A03, A13,
priority-DAG search, copper sizes, endpoints or the downstream repair stages.

`HighDensitySolverA01Compact` remains an instance of the pinned external A01,
so its scheduler work classification and initialized iteration budget remain
unchanged. A01 setup, via occupancy, collision predicates and route finalization
come from `@tscircuit/high-density-a01` at `10cdce5ad507adfaaec8ac32ea905ab02ffefa8a`.
The adapted search and cost code is copyright 2026 tscircuit, under MIT; the
repository's LICENSE contains the license terms.

The implementation adds:

- Reusable typed arrays for flat cell IDs, costs, parent labels and the stable
  `(f, insertion sequence)` heap. Only a winning parent chain becomes object
  labels for A01's existing route finalizer. Ordered victim chains are retained.
- A precomputed numeric same-root overlap table and exact 32-bit victim masks.
  These replace repeated root-string/Set checks and linked membership scans
  without merging distinct connection IDs that happen to share a root net.
- Optional queue pruning by `(cell, exact victim mask)` and best queued cost.
  Unsigned masks and fewer than `2^21` grid states keep the numeric key injective
  below `2^53`. The default experiment enables pruning.
- Per-candidate `stats.compactA01` counters, delta-aggregated into the shared HD
  `benchmarkDiagnosticCounters` through `priorityDiagnostics`, so metrics survive
  retirement of earlier nodes. Peak counters are maxima; other counters are sums.

Capacity is selected before search: scenes with more than 32 named connections
or at least `2^21` grid states construct the original A01. Counting all port names
is conservative because A01 only interns names with at least one point pair.
The compact class also validates the actual IDs, dimensions and dependency
layout after setup. A violated invariant throws; no solver error is swallowed.
This adapter intentionally depends on the pinned dependency's ordinary private
properties and must be revalidated when that dependency changes.

## Separate representation from policy

Construct the class with `compactFrontierPruning: false` to compare storage and
numeric membership with the original A01. That mode preserves the original
neighbor order, heap ties, visited-cell closure, costs, skip/rip behavior and
iteration accounting. Regression tests compare exact outputs and iterations.

Pruning is a deliberate search-policy experiment. Identical cell and exact
victim set have the same local continuation cost within one frozen search, but
different prefixes can produce different final copper and ordered rip/requeue
histories. This is not a proof of equivalent multinet routability or optimality.
The original heuristic's cell-only visited closure is retained. Removing stale
queue work also allows more genuine expansion within the same iteration count;
compare wall time, final quality and useful expansions, not iteration count alone.

## Focused validation and replay

```sh
bun test --timeout 9999999 tests/features/compact-a01-*.test.ts
bun test --timeout 9999999 tests/bugs/portfolio-single-intra-node-external-solver-name.test.ts
bun experiments/hd-compact-frontier/replay.ts INPUT.json cmn_36 2 baseline
bun experiments/hd-compact-frontier/replay.ts INPUT.json cmn_36 2 storage
bun experiments/hd-compact-frontier/replay.ts INPUT.json cmn_36 2 pruned
```

`INPUT.json` is a captured Pipeline9 `highDensityRouteSolver` entrance, including
`nodePortPoints`, serialized `connMap.netMap` and `nodePfById` entries. The replay
normalizes the node through the production regular-node factory and reports a
route hash, work, memory and counters in a fresh process. Scale2 output is still
virtual geometry: matching hashes there do not prove physical clearance after
inverse scaling. Final pipeline DRC remains a separate measurement.

Six focused tests cover representation parity across shuffle seeds,
noncontiguous layers and same-root routes; all 32 victim bits and exact set
identity; arena growth/stable heap ties; construction and post-setup capacity
guards; idempotent counter aggregation; and 3,645 original-versus-compact move
cost/rip-chain comparisons involving trace, via and diagonal conflicts.

Three exploratory fresh-process replays of dataset18 sample002 `cmn_36` at scale2
gave medians of 249.0ms original, 220.7ms storage-only and 219.1ms pruned. All nine
outputs had the same 14-route hash. Storage kept 224,662 iterations; pruning used
116,722. These ran on CPU3 while other implementation work continued and are not
a controlled dataset speedup claim. An earlier version that retained linked
membership checks was slower despite fewer iterations; that adverse result led
to implementing the numeric cost representation too.

## Dataset evaluation

Run both complete datasets with Pipeline9, effort1, one routing thread per
sample, the same concurrency and a 360-second sample cap:

```sh
./benchmark.sh --pipeline 9 --dataset 18 --effort 1 --threads 1 --concurrency 2 --sample-timeout 360s
./benchmark.sh --pipeline 9 --dataset 24 --effort 1 --threads 1 --concurrency 2 --sample-timeout 360s
```

Compare against the same-machine unmodified commit. Report final completion,
relaxed DRC, time-to-clean output, HD and repair stage times, vias, wire length,
RSS and tail cases. Preserve unrelated upstream failures as separately attributed
failures rather than interpreting them as evidence about the compact kernel.
Dataset-wide results are recorded with the draft PR's benchmark report.
