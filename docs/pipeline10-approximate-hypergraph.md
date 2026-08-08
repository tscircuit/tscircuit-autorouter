# Pipeline10 approximate hypergraph experiments

Pipeline10 is an experimental Pipeline7 variant for testing spatially
approximate hypergraph topologies. It is not the default autorouter.

## Approximation

- Cover global free space with a bounded uniform grid.
- Preserve the existing exact component topology for detected BGA, QFP, and
  SOIC regions.
- Optionally refine grid cells near every obstacle and terminal with a local
  quadtree. The default refinement depth is `1`.
- Cap non-component boundary choices per layer before tiny-hypergraph.
- Sample approximate boundary choices against rotated obstacle geometry.
- Keep coarse regions shareable between nets and reserve only synthetic
  terminal regions. The ordinary tiny-hypergraph duplicate-port prepass is
  disabled because it reintroduces precise per-net reservations into coarse
  cells.
- Materialize and deduplicate implied layer transitions before Pipeline7's
  exact simplification and DRC repair stages.

Benchmark controls are available through `benchmark.sh`:

```text
--approximate-cell-size N
--approximate-max-ports N
--approximate-refinement-depth N
```

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

Depth `1` is the experimental default because it produced the best DRC and via
tradeoff on the boards that completed while retaining a smaller graph than
depth `2`.

The matrix also establishes a release boundary: spatial grid approximation is
not yet precise enough for the current post-processors. No Pipeline10 setting
passed relaxed DRC, and the harder boards either timed out or failed in
high-density routing, tiny-hypergraph reripping, or trace simplification.
Pipeline10 should remain opt-in until obstacle-aware local topology or stronger
post-processing closes that gap.
