# Node-local simplification experiment

## Current approach

Pipeline9 runs its established dense-grid reduction within each ordinary high-density node before returning the node's routes. The regular-node factory is shared by local routing and networked workers. `enableNodeSimplification` defaults to `true`; setting it to `false` selects the original node solver for comparisons.

The pass uses exactly the existing pre-force normalization: materialize layer-transition vias, then call `simplifyPipeline9CollinearRoutePoints`. That policy removes long collinear runs of at least 64 grid segments only in regions containing at least 4,096 points. Ordinary control vertices remain unchanged. No obstacle or route spatial index is required because the operation preserves copper paths.

This deliberately moves a proven normalization earlier rather than introducing a broader geometric approximation. The existing pre-force normalization remains for fixed-copper/B01 and regional fallback routes, which are excluded from the early pass. Reapplying it to already-normalized ordinary routes preserves the force-improvement input. Global trace simplification and global repair remain in place.

The incremental wrapper performs one bounded node operation. It can run inside a network worker, reducing the returned point payload for eligible dense nodes. Actual network throughput and replacement of global simplification have not been measured. Small, non-grid-heavy nodes do not benefit from this version.

## Network policy

Enabled requests use `ordinary_node_grid_simplification_then_regional_without_fixed_copper_v4`, separating their cache entries from original routing and the discarded broader experiments. Remote workers must support the new policy. Explicitly disabling node simplification preserves the original policy and solver; updated workers still accept original-policy requests.

## Validation

- 39 focused simplification and networked tests pass, plus type checking and package build.
- The real AM3352 dense-node fixture has 4,735 points. The node-local pass reduces it to 889 (81.2% fewer points) and produces exactly the same final force-improvement output as the existing normalization at its original placement.
- Tests preserve sparse-node control points, input immutability, metadata, copper paths, via positions, long routes, enabled defaults, and local/worker parity.

## Dataset 18 result

`/benchmark --dataset 18` compared enabled revision `28bcf42` with main `eb7e607` sequentially on the same Blacksmith machine, effort 1, 360-second per-sample timeout. [Benchmark result](https://github.com/tscircuit/tscircuit-autorouter/pull/2703#issuecomment-5804314986), [raw reports](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/35930952310).

| Metric | Main | Node-local pass |
| --- | ---: | ---: |
| Completed / relaxed DRC passed | 16/16 | 16/16 |
| DRC errors | 0 | 0 |
| Timeouts | 0 | 0 |
| Median time | 99.7 s | 100.6 s (+0.9%) |
| P95 time | 317.6 s | 323.0 s (+1.7%) |
| Average vias | 223.88 | 223.88 |

The benchmark reports zero outcome regressions. This run does not establish an overall speedup. All nine CI test shards pass at the benchmarked revision, using the original snapshots and DRC expectations. No snapshots or existing DRC assertions were changed to accept this version.

Pre-force route data is identical with the early pass enabled or disabled on samples 1, 14 and 15. The sample 15 comparison required fresh processes: reusing the global router cache across both cases changes some upstream routing and is not a valid equivalence check.

The AM3352 dense fixture's serialized route payload decreases from 264,817 to 60,861 bytes (77.0%). This is a fixture measurement, not network-throughput evidence. Small nodes receive no grid reduction, and via canonicalization may add explicit transition vertices.

The formatting CI check remains failing. `AGENTS.md` explicitly prohibits formatting or linting; no formatter was run. The draft remains open for review.

## Rejected approaches

The original geometry-changing shortcut pass at `1c7c9dc` completed only 12/16 samples versus main's 16/16 in [its paired benchmark](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/35917400876). It exposed via-transition invariants in samples 7, 8 and 10 and an iteration cap in sample 15.

A broader collinear pass at `9cee960`, retaining endpoint/via approaches and 0.25 mm control spacing, improved failure-penalized median runtime from 110.3 to 97.9 seconds but passed DRC on only 14/16 samples: sample 14 gained 183 DRC errors and sample 15 timed out. [Paired comparison](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/35928874631). This is not an acceptable tradeoff. Even geometrically redundant points influence force improvement and repair.

Restricting that pass to single-route nodes produced no reduction on sample 1, so that trial was not adopted. The current version instead retains the established dense-grid eligibility and normalization policy. Earlier point-reduction and timing numbers do not describe the current implementation.
