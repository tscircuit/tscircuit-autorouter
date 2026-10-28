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

The capacity-probe follow-up keeps the original experiment's implementation and
results as a separate measured version. Its narrow extension replaces the
blanket `S < 2^21` limit with the exact owner-dependent key bound. Since
`0 <= mask < 2^N` and `0 <= cell < S`, the largest key is `2^N * S - 1`.
Multiplication of integer `S <= 2^32` by the power of two `2^N` is exact in a
JavaScript Number, so comparison with `2^53` does not itself round an unsafe
capacity into the safe range. The `Uint32Array` cell field separately imposes
`S <= 2^32`, whose largest stored cell is `S - 1`. With 32 owners, `S = 2^21`
is safe at equality. With 12 owners, every Uint32-addressable grid meets the
key bound. This changes eligibility, not the costs or the pruning rule of
already-supported scenes.

The normal portfolio keeps the earlier experiment's pruning on its original
`S < 2^21` domain. Newly eligible larger grids use **storage-only** compact A01,
preserving the original backend's search policy there. Direct construction still
accepts the explicit `compactFrontierPruning` flag for either ablation. The
`compactA01StorageOnlyCandidates` aggregate reports how often the newly covered
representation is used without pruning.

The implementation adds:

- Reusable typed arrays for flat cell IDs, costs, parent labels and the stable
  `(f, insertion sequence)` heap. Only a winning parent chain becomes object
  labels for A01's existing route finalizer. Ordered victim chains are retained.
- A precomputed numeric same-root overlap table and exact 32-bit victim masks.
  These replace repeated root-string/Set checks and linked membership scans
  without merging distinct connection IDs that happen to share a root net.
- Optional queue pruning by `(cell, exact victim mask)` and best queued cost.
  For `N` named owners and `S` grid states, capacity requires `N <= 32`,
  `S <= 2^32`, and `2^N * S <= 2^53`. Unsigned masks and these bounds keep every
  numeric key injective through `Number.MAX_SAFE_INTEGER`. The default
  experiment enables pruning.
- Per-candidate `stats.compactA01` counters, delta-aggregated into the shared HD
  `benchmarkDiagnosticCounters` through `priorityDiagnostics`, so metrics survive
  retirement of earlier nodes. Peak counters are maxima; other counters are sums.

Capacity is selected before search using the named-owner-dependent bound above.
Counting all port names is conservative because A01 only interns names with at
least one point pair. The compact class validates the actual interned owner count,
IDs, dimensions, mask ranges and dependency layout again after setup. Cached
masks outside `[0, 2^N - 1]` throw. A violated invariant throws; no solver error is
swallowed. This bound is a representation limit, not a promise that enough RAM
exists for the corresponding grid.
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

Eleven focused tests cover representation parity across shuffle seeds,
noncontiguous layers and same-root routes; all 32 victim bits and exact set
identity; arena growth/stable heap ties; construction and post-setup capacity
guards; idempotent counter aggregation; and 3,645 original-versus-compact move
cost/rip-chain comparisons involving trace, via and diagonal conflicts. The
capacity follow-up adds BigInt key checks at owner-dependent equality boundaries,
Uint32 maximum cells, actual-versus-conservative owner counts, and invalid cached
mask checks without allocating enormous grids.
They also verify the normal factory policy and an actual grid above `2^21`
states whose route visits cells beyond that earlier limit, retaining the exact
original route and iteration count in storage-only mode.

Three exploratory fresh-process replays of dataset18 sample002 `cmn_36` at scale2
gave medians of 249.0ms original, 220.7ms storage-only and 219.1ms pruned. All nine
outputs had the same 14-route hash. Storage kept 224,662 iterations; pruning used
116,722. These ran on CPU3 while other implementation work continued and are not
a controlled dataset speedup claim. An earlier version that retained linked
membership checks was slower despite fewer iterations; that adverse result led
to implementing the numeric cost representation too.

A separate owner-capacity diagnostic used actual normalized dataset24 sample001
`cmn_599` at virtual scale32: 12 owners and 4,095,792 grid states. The earlier
kernel selects original A01 there; the extended representation is supported.
With equal 2M iteration caps, original A01 took 1.476s and retained seven routes;
extended pruning took 2.693s and retained ten, but neither solved. That larger
prefix is not an optimization verdict. At the natural 12M budget, original took
7.966s and extended storage-only 5.967s, both retaining the same eleven-route
partial hash, exact 1,768,319 useful expansions and 10,231,604 stale pops.
Peak RSS was 811MB versus 528MB. Extended pruning took 14.767s, expanded
7,021,540 useful states and retained a different eleven-route partial hash, still
without solving. These single-run candidate diagnostics support the storage
representation's local same-work gain and provide adverse evidence about
extending pruning. They establish neither complete-node nor board improvement.
The natural-budget measurements include the same pop-observer hook in all modes.

A following complete-node replay used the newer captured HD entrance
`d2f7afe665b880c7e9a3fdbec79eb1a8b3de3755d61ebab229a9173e571d0b64`, restricting
both fresh processes to `cmn_599` with identical worker/protocol settings,
concurrency1, CPU3 and a 180s limit. The earlier frozen kernel completed in
85.268s with 4.982GB peak RSS; the capacity-plus-storage policy completed in
70.454s with 3.171GB peak RSS: 17.37% less time and 36.34% less peak memory.
Both completed twelve routes in exactly 987,130 outer HD iterations, and their
raw output bytes had identical SHA256
`e2149478d91580335b6afe4cef592a0f43131551dcc43e6c4774b0e9c7a4dd63`.
Seven newly eligible candidates used storage-only mode. This output hash also
matches the earlier independent production/A13 geometry audit, which found
forty literal-overlap route pairs in these intermediate physical routes; those
existing conflicts are unchanged. This is one complete-node same-output gain,
not a complete-board or dataset speedup estimate. Earlier adverse pruning and
candidate-budget observations remain part of the experiment.

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
