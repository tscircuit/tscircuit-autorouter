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
- Refine otherwise coarse cells when at least six point-pair connection hints
  cross the cell. This selectively splits likely congestion hot spots without
  paying for a uniformly fine global grid.
- Cap non-component boundary choices per layer before tiny-hypergraph.
- Sample approximate boundary choices against rotated obstacle geometry.
- Solve only region adjacency and rough region capacity with
  tiny-hypergraph's `RegionPathSolver`. Coarse cells remain shareable between
  nets, while synthetic terminal regions and exact component regions retain
  net ownership.
- Add a concave region-entry penalty based on the fraction of each approximate
  cell's layer-area occupied by obstacles. This steers paths away from partial
  occupancy without increasing the full-occupancy penalty. Exact
  component-topology cells do not receive this approximate penalty.
- Assign real boundary ports with a greedy layer, reuse, and local-crossing
  penalty. This avoids tiny-hypergraph's expensive exact port assignment and
  rip-up loop.
- Preserve graph reachability with strongly penalized approximate bridges only
  where obstacle sampling removes every boundary choice or an exact component
  terminal has no usable escape into the global mesh.
- Route exact component-topology cells, cells with topologically crossing
  boundary pairs, and high-risk approximate cells with the normal intra-node
  solver. Lower-risk cells use direct geometry and rely on the retained
  force-improvement, stitching, simplification, and exact DRC repair stages.
- Materialize and deduplicate implied layer transitions before Pipeline7's
  exact simplification and DRC repair stages.

Benchmark controls are available through `benchmark.sh`:

```text
--approximate-cell-size N
--approximate-max-ports N
--approximate-refinement-depth N
--approximate-exact-pf-threshold N
--approximate-obstacle-occupancy-cost N
--approximate-obstacle-occupancy-exponent N
```

The exact-Pf threshold defaults to `0.01`. Lower values route more approximate
cells exactly, increasing runtime in exchange for fewer rough intra-node
segments. Detected component-topology cells are always exact regardless of the
threshold, as are cells whose assigned boundary pairs contain a topologically
necessary crossing.

Obstacle occupancy includes the configured sampling margin and is weighted by
layer: an obstacle covering half a cell on one of two available layers yields
an occupancy fraction of `0.25`. The default full-occupancy entry cost is
`50`, configurable with `approximateObstacleOccupancyCost` when constructing
Pipeline10. The occupancy exponent defaults to `0.65`, increasing sensitivity
to small occupied fractions while preserving the configured cost at full
occupancy.

## Dataset01 refinement result

Dataset01 exposed two problems that the earlier dataset18 prototype did not
isolate clearly:

- a low normalized node-Pf could still contain a guaranteed same-layer
  crossing, causing direct geometry to emit a known DRC violation;
- a coarse, unobstructed grid cell could collect enough routes to make exact
  intra-node routing and downstream DRC repair pathological.

Pipeline10 now marks crossing cells for exact routing, uses a `0.01` default
Pf threshold, and selectively refines coarse cells crossed by at least six
straight point-pair hints. Crossing-via reduction also materializes any
remaining diagonal layer change into planar geometry plus an explicit via
instead of failing trace simplification.

Blacksmith ran dataset01 samples 1, 2, 3, 8, 18, 21, 27, 32, 37, 49, 66,
and 85 concurrently on the same 4-vCPU testbox. Compared with the previous
Pipeline10 defaults:

| Metric | Previous Pipeline10 | Refined Pipeline10 | Change |
| --- | ---: | ---: | ---: |
| Solver completion | 12/12 | 12/12 | preserved |
| Relaxed DRC pass | 2/12 | 5/12 | +3 clean boards |
| Relaxed DRC issues | 620 | 19 | 96.9% lower |
| Aggregate runtime | 1056.9s | 379.8s | 64.1% lower |
| p50 runtime | 65.3s | 31.1s | 52.4% lower |
| p95 runtime | 279.7s | 62.7s | 77.6% lower |
| Average vias | 85.08 | 118.50 | 39.3% higher |

The dense sample 32 changed from `352.4s / 225 issues / 138 vias` to
`66.0s / 4 issues / 228 vias` under concurrent Blacksmith load. A local
single-sample run completed in `15.3s`; profiling showed tiny-hypergraph region
pathing at `7ms` and exact high-density routing at `6.0s`, down from `80.8s`
before congestion refinement.

Pipeline7 remains the quality target on this cohort: it passed 10/12 boards
with a 25.7s p50 and 44.4s p95. The refined Pipeline10 result is therefore a
large improvement over the first approximation, but not yet a replacement for
Pipeline7. The remaining seven failing samples have only one to four relaxed
DRC issues each.

[Dataset01 Blacksmith testbox run](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/31275848311)

### Obstacle occupancy exponent

Raising the linear full-occupancy cost improved some boards but produced large
DRC and runtime outliers on dense layouts. A concave exponent instead makes
partial occupancy more visible to region pathing while keeping the existing
full-occupancy cost of `50`.

A Blacksmith sweep over the same 12-board dataset01 cohort selected `0.65`:
it completed 12/12, passed relaxed DRC on 7/12, and emitted 16 violations. The
previous linear default passed 5/12 and emitted 19 violations. More aggressive
weighting at `0.5` regressed to 5/12 clean, emitted 117 violations, and raised
p95 runtime from 62.7s to 185.9s.

The selected exponent was then validated on all 85 dataset01 boards:

| Metric | Linear occupancy | Exponent `0.65` | Change |
| --- | ---: | ---: | ---: |
| Solver completion | 82/85 | 82/85 | preserved |
| Relaxed DRC pass | 60/85 | 68/85 | +8 clean boards |
| Relaxed DRC issues | 89 | 53 | 40.4% lower |
| p50 runtime | 3.36s | 3.24s | 3.7% lower |
| p95 runtime | 41.99s | 42.72s | 1.7% higher |
| Average vias | 54.23 | 54.37 | 0.3% higher |

Samples 8, 9, 35, 61, 67, 73, 82, and 85 became clean, with no regression
among boards that passed under the linear cost.

[Occupancy exponent Blacksmith testbox run](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/31300837475)

The full 16-board SRJ18 guardrail preserved 12/16 completion and reduced
violations on completed boards from 1,123 to 949 (15.5%). Among the 11 boards
completed by both configurations, eight improved, one tied, and two regressed
by five or fewer violations. Runtime remains a hard-board tradeoff: p50 rose
from 121.4s to 171.5s, sample 15 changed from a timeout to a 224.0s completion,
and sample 11 changed from a 118.9s completion to a timeout. Both runs had two
timeouts and the same two stitching failures overall.

[SRJ18 occupancy exponent Blacksmith testbox run](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/31300837515)

## Region-path prototype result

On a local dataset18 sample 3 run, the region-only solver reduced the
`portPointPathingSolver` stage from about `6.8s` to `40ms`. End-to-end runtime
fell from about `22.0s` to `8.7s`. The approximation is still intentionally
rough: the relaxed evaluator reported 107 errors and 130 vias, so this is a
speed prototype rather than a release candidate.

Dataset18 sample 1 verifies the component boundary: one component was
detected, 112 component-topology cells survived topology merging, 12 were used
by routed paths, and the region-only path solve took about `52ms`.

An initial local full-occupancy-cost probe at `200` reduced sample 3 to 59
relaxed DRC errors, but multi-sample validation showed that weight was too
aggressive: sample 12 timed out in trace simplification. The tuned default of
`50` retains the occupancy preference without that completion regression.

## Dataset18 result

Blacksmith ran samples 1, 3, 6, 12, and 15 concurrently with a 600-second
per-sample timeout. Pipeline10 used 6 mm cells and six ports per layer.

The current occupancy-aware implementation completed all five samples. On the
three samples completed by both solvers, aggregate runtime fell from `587.1s`
to `323.6s`, a `1.81x` end-to-end speedup. Sample 6 and sample 15 changed from
timeouts to completions. The baseline's lower successful-sample p50 is not a
like-for-like comparison because it excludes those two timed-out boards.

| Sample | Pipeline7 | Occupancy-aware Pipeline10 | Speedup | Relaxed DRC errors | Vias |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 84.3s | 69.5s | 1.21x | 159 | 220 |
| 3 | 62.4s | 34.8s | 1.79x | 63 | 101 |
| 6 | timeout | 280.7s | completion | 210 | 253 |
| 12 | 440.4s | 219.4s | 2.01x | 243 | 351 |
| 15 | timeout | 149.7s | completion | 138 | 295 |

The tuned cost `50` reduced aggregate runtime by 10% and relaxed DRC errors by
23% versus the same region-only solver with occupancy costs disabled. Average
vias increased by 1.6%. Cost `200` was the rejected high-penalty point because
it caused sample 12 to time out.

| Full-occupancy cost | Completed | Aggregate runtime | Relaxed DRC errors | p50 | p95 | Average vias |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 5/5 | 836.3s | 1,053 | 166.2s | 316.3s | 240.2 |
| 50 | 5/5 | 754.0s | 813 | 149.7s | 268.4s | 244.0 |
| 200 | 4/5 | sample 12 timeout | 604 on 4 completed | 105.2s successful-only | 405.7s successful-only | 218.3 successful-only |

The occupancy-aware Pipeline10 run still had a 0% relaxed DRC pass rate. This
means the retained post-processors can consume the approximate topology
without structural solver failures, but they cannot yet repair its geometric
error load completely.

[Region-only Pipeline10 Blacksmith testbox run](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/31272452830)

[Obstacle-occupancy tuning Blacksmith testbox run](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/31274043833)

### Earlier full tiny-hypergraph matrix

The earlier experiment sent the approximate graph through tiny-hypergraph's
full port assignment and rip-up solver:

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

The combined results establish a release boundary: region-only pathing removes
the dominant hypergraph solve cost and reachability failures, while retaining
exact component detection and local component topology. Spatial grid
approximation is still not precise enough for the current post-processors,
however. Pipeline10 should remain opt-in until obstacle-aware local geometry or
stronger post-processing closes the relaxed-DRC gap.
