# Experiment: embed grown topology at physical dimensions

Pipeline 9 currently grows node coordinates, routes with unchanged copper sizes,
then divides coordinates back to the physical node. Widths and via diameters do
not shrink, so a useful connectivity proposal can contain physical copper
overlaps. This experiment treats that geometry as a warm start for a bounded
physical embedding, before established board-wide force improvement and repair.

## Implementation and scope

- The ordinary Pipeline 9 node factory enables `physicalLegalization`. Other
  pipelines and the regional/preloaded-copper solver retain their existing
  configuration. The ordinary node factory is selected only when the existing
  preload-overlap filter finds no fixed copper in the expanded node. Changed
  interior vertices remain in the node, with a copper-radius inset; fixed
  terminals stay at their original coordinates. This does not implement a new
  joint region repair or upstream port-assignment feedback algorithm.
- Only accepted candidates at scale greater than one are processed. At scale one
  routing is unchanged. No extra routing portfolio is launched. Copper widths,
  via diameters, route/layer ordering, shared-net junction coordinates and
  terminal metadata remain intact. Jumpers and `through_obstacle` segments are
  explicitly recorded as unsupported and retained for established processing.
- Strictly collinear metadata-free points are removed without changing the
  copper. This reduces grid stair-step sampling overhead while retaining corners,
  vias, terminals and width changes. Compression is a separate ablation because
  it changes the input discretization of downstream numerical repair.
- Deterministic projected gradient steps reduce squared physical penetration of
  trace capsules, via barrels, hole spacing and local board obstacles. Vias use
  their actual through/blind/buried layer spans from the production copper
  geometry model. The default limit is 40 accepted iterations with bounded
  backtracking. A broad phase rejects remote primitive/obstacle contacts.
- Endpoint and same-owner XY aliases share position variables. Via position lists
  are updated with their layer-transition vertices. All supplied node port points
  and `pcb_port_id` vertices are locked.
- Obstacle constraints preserve the worst penetration for each original
  route/obstacle pair. A previously clear route/obstacle pair must remain clear;
  a previously conflicting pair cannot become deeper. This is deliberately not
  a promise that every primitive in an already dirty pair remains individually
  unchanged. Rectangle rotation and circular obstacles are respected. Obstacles
  outside the node are included through the sum of copper radius and clearance.
  Connected pads are transparent to trace copper, but via-to-pad conflicts are
  guarded even on the same net; this conservatively avoids introducing via-in-pad
  geometry when no local via-in-pad policy was supplied. Any primitive already
  violating a board edge is pinned before projection, so its violation cannot
  deepen. Outline checks include finite copper width at segment endpoints.
- Acceptance requires reduced summed penetration, nonincreasing literal-overlap
  route-pair count, no new board-edge violation, and no worse route/obstacle-pair
  penetration. Requested-clearance pair count can rise while the total depth and
  literal-overlap count fall. Both counts are reported; a lower energy is not a
  DRC proof.
- `clean` requires a separate final check of production copper geometry using
  the existing independent segment-distance implementation, all supplied board
  obstacles, outline/bounds edge margins including endpoint clearance, and
  supplied via-hole spacing. It means clean within this captured local scene,
  not certification of the final board. The full pipeline still runs its existing
  checks and repairs. Partial proposals have `improved-needs-repair` status;
  failed bounded optimization has `unchanged-needs-repair` status. Solver
  invariants throw; no exception is caught and relabeled as successful routing.

## Reproduction and ablations

Run focused checks:

```sh
bun test tests/physical-route-legalization-*.test.ts --timeout 9999999
./benchmark.sh --pipeline 9 --dataset 18 --concurrency 2 --threads 1 --effort 1 --sample-timeout 360s
./benchmark.sh --pipeline 9 --dataset 24 --concurrency 2 --threads 1 --effort 1 --sample-timeout 360s
```

For an isolated replay, capture the HD-stage constructor input and completed grown
node winners in JSON. Inputs use `{ nodePortPoints, connMap: { netMap }, layerCount,
obstacles, obstacleMargin, ... }`; winners use `{ nodes: [{ id, routes }] }` in
physical coordinates, after inverse scaling. Then compare:

```sh
bun experiments/physical-route-legalization/replay.ts hd-input.json grown-winners.json 0 compressed.json
bun experiments/physical-route-legalization/replay.ts hd-input.json grown-winners.json 40 projected.json
```

The zero-iteration run isolates geometry-preserving compression; 40 includes
projection and all validation. Disabling `physicalLegalization` on
`HighDensitySolver` retains the original raw proposal. `physicalLegalizationIterations`
sets the projection bound. These are serializable constructor options, not
process-local monkey patches.

Shared `benchmarkDiagnosticCounters` receive `physicalLegalization*` counters for
proposal/status counts, milliseconds, iterations, points before/after, requested
clearance and literal-overlap pair counts, penetration loss, candidate pair
counts, and obstacle/board guard rejection counts. Per-proposal metrics also live
in the grow/shrink solver's `stats.physicalLegalization`. A failed earlier
pipeline stage cannot exercise this experiment and is reported separately from
legalization failure.

## Focused measured evidence

Saved Pipeline 9 dataset18 sample002 scale-two witnesses were replayed with full
same-net connectivity, physical obstacles and layer context. On the checked
prototype, cmn_3 changed literal-overlap route pairs from 47 to 25 and squared
penetration from 24.90 to 4.05. Requested-clearance pair count rose from 78 to 79;
this is an explicit tradeoff, not clean output. cmn_0 changed requested-clearance
pairs from 14 to 6, retaining zero literal-overlap pairs. cmn_36 remained unchanged.
All retain their original trace/via counts. Geometry-preserving compression
changes point counts 3043→540, 1858→295 and 912→593 respectively. These local
witness results justify a complete-pipeline experiment; they do not prove a
dataset-wide speedup or reduced final DRC repair cost. The final dataset18/24
results must be assessed on equal final completion, DRC, time, memory and quality.

## Limitations

This method preserves the existing layer/crossing topology; it cannot create a
missing legal channel, undo an essential same-layer crossing, change an upstream
terminal assignment, or prove infeasibility. Dense constraints can trap the
continuous optimizer. The bounded numerical search is incomplete. Existing
obstacle-access conflicts can remain and force a `needs-repair` status. Constraints
not supplied to this local scene, such as external inter-node copper or final
board-specific pad/hole rules, still require full-pipeline validation. A local
overlap reduction may reduce later work, but preprocessing/projection also costs
time and downstream numerical repair may respond differently to compressed
routes. Full-board measurements, including negative results, decide promotion.
