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
- The real AM3352 dense-node fixture has 4,735 points. The node-local pass reduces it below 1,000 and produces exactly the same final force-improvement output as the existing normalization at its original placement.
- Tests preserve sparse-node control points, input immutability, metadata, copper paths, via positions, long routes, enabled defaults, and local/worker parity.

A fresh `/benchmark --dataset 18` comparison will validate this revision with the early pass enabled.

## Rejected approaches

The original geometry-changing shortcut pass at `1c7c9dc` completed only 12/16 samples versus main's 16/16 in [its paired benchmark](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/35917400876). It exposed via-transition invariants in samples 7, 8 and 10 and an iteration cap in sample 15.

A broader collinear pass at `9cee960`, retaining endpoint/via approaches and 0.25 mm control spacing, improved failure-penalized median runtime from 110.3 to 97.9 seconds but passed DRC on only 14/16 samples: sample 14 gained 183 DRC errors and sample 15 timed out. [Paired comparison](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/35928874631). This is not an acceptable tradeoff. Even geometrically redundant points influence force improvement and repair.

Restricting that pass to single-route nodes produced no reduction on sample 1, so that trial was not adopted. The current version instead retains the established dense-grid eligibility and normalization policy. Earlier point-reduction and timing numbers do not describe the current implementation.
