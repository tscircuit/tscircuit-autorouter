# Experiment: embed grown topology at physical dimensions

The original paired measurements in `experiments/hd-results/legalization` remain
the historical evidence for source `8115e35a4517191c306820438b14a197dc911c7a`.
The first selective refinement at source `70d7a1bbbc61ca474c9b696cdccba7a8bd814c14`
completed its five-arm dataset18/24 comparison in
[run 40740148169](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/40740148169).
It preserved one extra clean dataset24 board over baseline, but lost the old-full
clean sample 11 and did not establish a substantial routing-time improvement.
Compression-only also lost clean dataset18 sample 15. Those negative results remain
separate evidence; the current joint-projection follow-up must be confirmed anew.

## Refinement: joint physical projection and explicit ablations

`physicalLegalizationMode` is a serializable Pipeline9 constructor option, also
accepted by the HD and grow/shrink constructors. There are no environment controls
or measurement hooks that change the policy:

| Mode | Behavior on a completed grown proposal |
| --- | --- |
| `off` | Preserve the original proposal; skip legalization entirely. |
| `compression-only` | Preserve geometry, widths, vias, terminal/point metadata and internal node ports; remove strictly collinear redundant vertices. Do not construct or evaluate a physical scene. |
| `full` | Use the full iteration schedule under the refined shared physical guards. This is not byte-equivalent historical source `8115e35a`. |
| `selective` | Apply those same guards and accepted-proposal rules, but spend projection work only on conflicts with movable degrees of freedom and continued measured progress. |

The ordinary Pipeline9 factory now defaults to `full`; `selective` remains an explicit research mode. The legacy
`physicalLegalization: true` on a direct HD/grow-shrink caller still selects `full`
unless a mode is explicit. Setting `maxIterations: 0` on the direct legalizer
retains its historical full-scene diagnostic behavior; use `compression-only` for
the inexpensive component ablation. Compression-only processes supported grown
proposals without the old pairwise-conflict eligibility check, so this distinction
is part of the ablation rather than an unreported equivalence claim.

Selective policy uses no sample IDs, dataset labels, elapsed-time thresholds or
timing feedback. It skips projection with no movable contact contribution and
checks movable squared-penetration progress every four completed iterations.
Less than 0.5% reduction over that window stops further work while retaining a
useful accepted partial proposal. A deterministic geometry-work allocation limits
distance/index work at iteration boundaries, with the same 40-iteration maximum.
One complete iteration may exceed the remaining allocation; mandatory final
acceptance checks always finish. This is not a strict CPU, memory or per-contact
limit. One force-array workspace is reused across objective/backtracking calls.

The work counter covers optimization index entries and exact-distance operations,
including obstacle/drill guards; it excludes the separate authoritative pairwise
and final clean audits. Total elapsed time includes setup and all audits. New
metrics distinguish pairwise, energy and drill measurement. Uncomputed losses,
movable/immutable conflicts and missing drill measurements are `null`, not zero,
and are not added to shared numeric counters. A direct helper caller without
drill dimensions can obtain only an explicit `copper-only` clean scope; ordinary
Pipeline9 supplies drill dimensions. Shared physical clean counters require the
`copper-and-drill` scope. Neither scope certifies the complete board.

Shared guard fixes apply to both projection modes: arbitrary point metadata and
all internal node ports survive compression; shared XY vertices use their widest
copper radius; each existing drill-pair conflict may not deepen, and clean drill
pairs remain clean even if a copper objective improves. Same-net drill-only
conflicts are no longer skipped by an inter-net-only eligibility check. Declared
trace-to-pad, via-to-pad and non-plated-hole clearances flow from SRJ through the
regular-node factory into both the optimizer guard and independent clean audit.
The NPTH rule uses `isNonPlatedHole`, never provenance metadata. These physical
context additions can legitimately change serialized HD-input hashes; retain
both original SRJ identity and raw constructor identity in comparisons.

The existing pre-force simplifier already compresses regions with at least 4096
points and straight runs of at least 64 grid segments. This refinement does not
claim that mechanism as new. Aggressive compression preserves initial copper but
changes later numerical control vertices and protected endpoint segments; its
effect on force/repair and final route quality needs the separate arm.

The archived five-arm source used a `"selective"` factory default and derived
its `"compression-only"` and `"full"` controls by one literal change. The current
follow-up instead compares joint full projection with the unchanged historical
full source and original baseline. All prior result reports remain immutable.
Promotion requires retaining the clean dataset18/24 outcomes, including the
replicated dataset24 samples 2 and 11, and independently checking the known
snapshot-masked numerical fixtures. No new whole-board result is claimed before
that confirmation.

The lost sample 11 was localized to grown node `cmn_3`. A faithful captured proposal
contains 9760 points across 80 routes. The selective-refinement implementation
accepted no projection step: every energy-decreasing first trial violated a pad
constraint by a few micrometres after drill projection undid the earlier pad
projection. Projecting constraint families separately is therefore insufficient.

The follow-up precomputes the active obstacle and drill half-spaces once per
optimization iteration, then alternates both families for at most 32 passes,
stopping when vertex adjustments are below 1e-12. The same exact nonlinear
obstacle, board and per-drill-pair guards still decide trial and final acceptance.
A capacity-node inset includes each vertex's starting coordinate, keeping trial
motion continuous as step size decreases. Point owner annotations remain protected:
even repeated labels can anchor a shared branch endpoint on another route.
Matching route and adjacent-point owners does not prove that deleting the vertex
will preserve the shared junction during later motion.

A correctness-only replay with conservative metadata anchors reduces literal
overlaps 121→18 and drill-hole pairs 8→0 with all guards passing, versus 121→22
and 8→8 for the old
full proposal. The old result additionally violates two new per-pair drill
nonregression constraints; its aggregate hole count hid that trade. The replay
shows a useful local geometry improvement, not a measured whole-board speed or
clean-solve claim. The replay preserves all 80 explicit node-port pairs and all
504 originally connected same-net port pairs under both centerline and physical
copper audits. It records 1304460 geometry operations; this is an operation count,
not a wall-clock measurement. A superseded owner-label compression variant reached
12 overlaps but broke a separate branch-weld regression and is not the current
implementation.

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
  interior vertices remain inside the envelope of the node's copper-radius inset
  and their starting position; an existing capacity-boundary position cannot
  force a discontinuous jump. Fixed terminals stay at their original coordinates. This does not implement a new
  joint region repair or upstream port-assignment feedback algorithm.
- Only accepted candidates at scale greater than one are processed. At scale one
  routing is unchanged. No extra routing portfolio is launched. Copper widths,
  via diameters, route/layer ordering, shared-net junction coordinates and
  terminal metadata remain intact. Jumpers and `through_obstacle` segments are
  explicitly recorded as unsupported and retained for established processing.
- Strictly collinear points with no distinct metadata are removed without changing
  the copper. Point connection/root owner labels and unknown metadata stay intact,
  preserving their role in shared branch junctions. This reduces grid stair-step
  sampling overhead while retaining corners,
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
bun experiments/physical-route-legalization/replay.ts hd-input.json grown-winners.json 0 compressed.json compression-only
bun experiments/physical-route-legalization/replay.ts hd-input.json grown-winners.json 40 projected.json selective
```

The explicit compression-only run isolates geometry-preserving compression;
selective projection includes setup and all validation. Disabling `physicalLegalization` on
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


## Final reported via repair after preloaded routing

The conservative joint-projection source still exposes a later MIDI drill-clearance residual. A captured-stage replay proves that the existing `Pipeline9ReportedViaMergeSolver` can clear this single error with full reference DRC. Its usual caller is inside bounded regional negotiation; that entire stage intentionally exits before negotiation whenever preloaded traces or synthetic sections exist. The MIDI input has 21 preloaded traces, so that route never invokes the otherwise successful merger.

A final stepped child now applies the existing reported merger to the completed joint output. Eligibility requires exactly one explicit via-pair error, actual reference-circuit identities, matching drill/annulus/layers, overlapping same-net copper, and ownership by newly routed traces. Synthetic/preloaded routes are excluded. Publication requires zero full reference DRC errors and an independent check that route endpoints, terminal/jumper/through-obstacle points, immutable routes and fixed-copper via contacts remain protected. The existing finite merger limit remains active; child failure propagates normally. Output and error-count statistics distinguish the bounded stage from this final pass.

This is a repair scheduling correction, separate from the high-density projection improvement. Its small reference-DRC tests and captured MIDI stage replay establish candidate correctness; the complete MIDI pipeline must still be tested on the frozen source. It does not address Bug107's broad remaining conflict set and establishes no whole-dataset speedup.
