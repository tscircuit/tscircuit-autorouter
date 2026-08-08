# Pipeline10 approximate hypergraph experiments

Pipeline10 is an experimental Pipeline7 variant for testing spatially
approximate hypergraph topologies. It is not the default autorouter.

## Approximation

- Cover global free space with a bounded uniform grid.
- Preserve the existing exact component topology for detected BGA, QFP, and
  SOIC regions.
- Refine grid cells near every obstacle and terminal with a local quadtree.
  The Pipeline10 default refinement depth is `2`; region-only pathing makes
  this extra spatial detail inexpensive.
- Cap non-component boundary choices per layer before tiny-hypergraph.
- Sample approximate boundary choices against rotated obstacle geometry.
- Solve only region adjacency and rough region capacity with
  tiny-hypergraph's `RegionPathSolver`. Coarse cells remain shareable between
  nets, while synthetic terminal regions and exact component regions retain
  net ownership.
- Assign real boundary ports with a greedy layer, reuse, and local-crossing
  penalty. This avoids tiny-hypergraph's expensive exact port assignment and
  rip-up loop.
- Preserve graph reachability with strongly penalized approximate bridges only
  where obstacle sampling removes every boundary choice or an exact component
  terminal has no usable escape into the global mesh.
- Route exact component-topology cells and high-risk approximate cells with
  the normal intra-node solver. Lower-risk cells use direct geometry and rely
  on the retained force-improvement, stitching, simplification, and exact DRC
  repair stages.
- Materialize and deduplicate implied layer transitions before Pipeline7's
  exact simplification and DRC repair stages.

Benchmark controls are available through `benchmark.sh`:

```text
--approximate-cell-size N
--approximate-max-ports N
--approximate-refinement-depth N
--approximate-exact-pf-threshold N
```

The exact-Pf threshold defaults to `0.3`. Lower values route more approximate
cells exactly, increasing runtime in exchange for fewer rough intra-node
segments. Detected component-topology cells are always exact regardless of the
threshold.

## Region-path prototype result

On a local dataset18 sample 3 run, the region-only solver reduced the
`portPointPathingSolver` stage from about `6.8s` to `40ms`. End-to-end runtime
fell from about `22.0s` to `8.7s`. The approximation is still intentionally
rough: the relaxed evaluator reported 107 errors and 130 vias, so this is a
speed prototype rather than a release candidate.

Dataset18 sample 1 verifies the component boundary: one component was
detected, 112 component-topology cells survived topology merging, 12 were used
by routed paths, and the region-only path solve took about `52ms`.

## Dataset18 result

Blacksmith ran samples 1, 3, 6, 12, and 15 concurrently with a 600-second
per-sample timeout. Pipeline10 used 6 mm cells and six ports per layer.

| Solver | Refinement | Completed | Relaxed DRC pass | Timeouts | Successful p50 | Sample 3 time / DRC / vias |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Pipeline7 baseline | n/a | 60% | 40% | 2/5 | 84.3s | 62.4s / 8 / 92 |
| Pipeline10 | 0 | 40% | 0% | 2/5 | 83.9s | 35.0s / 63 / 174 |
| Pipeline10 | 1 | 40% | 0% | 3/5 | 82.9s | 49.2s / 46 / 114 |
| Pipeline10 | 2 | 40% | 0% | 0/5 | 119.6s | 77.9s / 65 / 79 |

Runs:

- [Pipeline7 baseline](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/31267981217)
- [Pipeline10 refinement 0](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/31270121149)
- [Pipeline10 refinement 1](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/31270122462)
- [Pipeline10 refinement 2](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/31270123651)

These runs predate region-only pathing. Depth `1` was the old full
tiny-hypergraph default; Pipeline10 now uses depth `2` because the larger
region graph solves in milliseconds and reduces downstream node congestion.

The matrix also establishes a release boundary: spatial grid approximation is
not yet precise enough for the current post-processors. No Pipeline10 setting
passed relaxed DRC, and the harder boards either timed out or failed in
high-density routing, tiny-hypergraph reripping, or trace simplification.
Pipeline10 should remain opt-in until obstacle-aware local topology or stronger
post-processing closes that gap.
