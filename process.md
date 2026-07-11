# Dataset 01 topology-merging regression investigation

- Dataset: `dataset01`
- Run location: local
- Solver: `AutoroutingPipelineSolver7_MultiGraph`
- Regression point: commit `8a92c053` (`true topology merging`)
- Comparison commit: `44c1f1f2` (immediately before topology merging)

## Current baseline

Command:

`./benchmark.sh --pipeline 7 --dataset dataset01 --concurrency 4 --sample-timeout 60s`

- Completed: 34.1% (29/85)
- Relaxed DRC pass: 32.9%
- Timed out: 0/85
- P50: 0.5s
- P95: 6.9s
- Six samples exhausted TinyHyperGraph iterations.
- Fifty samples failed TinyHypergraph's static reachability precheck, indicating
  a disconnected input graph rather than insufficient search iterations.

Individual failures will be compared against the previous commit using
identical effort and solver limits.

## Previous-commit comparison

Command in the detached `44c1f1f2` worktree:

`./benchmark.sh --pipeline 7 --dataset dataset01 --concurrency 4 --sample-timeout 60s`

- Completed: 100.0% (85/85)
- Relaxed DRC pass: 85.9%
- Timed out: 0/85
- P50: 1.5s
- P95: 10.0s

## Root cause

The new topology solver refines positive-area overlaps inside each input group,
including RectDiff's overlapping target-obstacle nodes. An endpoint in the
overlap becomes an interior atomic region. Its neighboring atomic regions
inherit `_containsObstacle` and `_containsTarget`, but do not contain the exact
connection point and therefore receive no Tiny net reservation. Tiny removes
those full-obstacle neighbors, leaving the selected endpoint region isolated.

Dataset-wide correlation:

- 24 circuits with no overlapping target-obstacle pair: 24 solved, 0 failed.
- 61 circuits with at least one overlapping target-obstacle pair: 5 solved,
  56 failed.
- Every one of the 56 solver failures has an overlapping target-obstacle pair.

Representative `circuit100`:

- Current topology: 312 nodes, 351 after subdivision.
- Previous topology: 272 nodes, 292 after subdivision.
- `source_net_11_mst1` starts in `topology_merge_52`, the overlap of global
  target nodes `cmn_142` and `cmn_143`.
- All four raw neighboring regions are target obstacles and are filtered from
  Tiny; the terminal retains only two same-net terminal ports and no routing
  port. Static reachability fails after two hops.

Representative no-component `circuit119`:

- The global group has 35 nodes and five same-layer overlaps.
- Topology merging rebuilds it as 50 nodes; subdivision grows 43 -> 72 nodes,
  edges 124 -> 207, and Tiny ports 256 -> 389.
- Its two never-routed endpoints are likewise intersections of two target
  obstacles surrounded by target-obstacle atomic cells.
- Tiny retries those impossible routes 1,067 and 1,083 times and exhausts two
  million iterations. This is the same topology bug hidden by the precheck's
  bounded-hop optimism, not merely a search-performance regression.
