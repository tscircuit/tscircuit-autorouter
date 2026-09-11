# Pipeline9: prevent high-density DRCs while routing

Research snapshot: 2026-09-07. Upstream main was fetched and verified at
`fb6c6d77c091a56c9e1d4648bbac40a7cccd0def` (`0.0.885`).

This is a fresh, documentation-only investigation from main. It does not copy
the HD force-repair, inherited-copper repair, stitching changes, or pad-check
cache from PRs #2413, #2431, or #2436. No routing behavior changes in this PR.

## Objective and constraints

Prevent invalid copper during high-density node routing, with less total work
than repeatedly generating a route, running board DRC, and force-repairing it.
Preserve terminal connectivity, fixed copper, declared widths and clearances,
layer semantics, and the existing downstream Joint/Repair03 implementation.

- No new HD force solver, force-repair pass, adaptive weights, failure-triggered
  alternate solver, sample-specific threshold, or enabling feature flag.
- Do not reduce repair/search effort or relax DRC to manufacture a speed gain.
- No local tests, benchmarks, solver runs, installs, builds, typechecks,
  formatting, or linting. Executable validation belongs on GitHub/Blacksmith.
- Future comparisons must use Pipeline9, all six datasets, and matching main/PR
  defaults on the same worker. No timeout increases.
- Follow repository AGENTS.md and the additional rules in [PR #2321][rules].
  That PR is closed/unmerged; its additional rules are followed because the
  user explicitly requested them.

The performance workflow informs the evidence-first ranking and isolated
experiments. Its local-install instructions and permissive rule that completion
gains excuse DRC regressions do not override these user constraints.

### What “without HD force repair” means in this investigation

Main already contains `highDensityForceImproveSolver` followed by
`Pipeline4HighDensityRepairSolver`, before stitching; the regional path also
contains force/repair work. Merely omitting PR #2436's added layer is therefore
**not** a force-free full-pipeline experiment. [Pipeline stages][stages]

The first measurements must inspect node output **before** those existing
stages. A later strict force-free Pipeline9 prototype must explicitly remove
the existing HD force/repair stages in its experimental revision and account
for the regional path, while leaving downstream Joint/Repair03 unchanged.
Use separate revision comparisons, not a new runtime flag. This research-only
PR does not silently remove upstream stages or claim force-free benchmark results.

## What the existing benchmark evidence does and does not show

These are **main-only baseline findings**, not this PR's results. Current-wave
main artifacts cover 01/18/21/23. For 19/20, whose newer jobs were still running
when inspected, completed historical artifacts use the identical main SHA.
Historical runtimes are not treated as controlled cross-wave measurements.

| Dataset | Completed / total | Timeouts | Other failures | Dirty completed | Final DRC entries | Main artifact |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 01 | 85 / 85 | 0 | 0 | 0 | 0 | [10019985917][result01] |
| 18 | 13 / 16 | 1 | 2 | 5 | 98 | [10020438258][result18] |
| 19 | 182 / 200 | 18 | 0 | 102 | 681 | [10010487621][result19] |
| 20 | 153 / 200 | 47 | 0 | 58 | 288 | [10011314965][result20] |
| 21 | 10 / 10 | 0 | 0 | 1 | 2 | [10019939520][result21] |
| 23 | 76 / 76 | 0 | 0 | 12 | 22 | [10020088694][result23] |
| Total | 519 / 587 | 66 | 2 | 178 | 1,091 | |

Only `main/benchmark-result.json` members were streamed from the artifacts;
archives were not saved. For every completed board, the sum of
`drcErrorTypes` equals `drcErrorCount` (519 rows, zero mismatches).

| Reported error category | 18 | 19 | 20 | 21 | 23 | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `pcb_trace_error` | 20 | 300 | 179 | 0 | 1 | 500 |
| `pcb_via_trace_clearance_error` | 16 | 144 | 82 | 0 | 0 | 242 |
| `pcb_pad_trace_clearance_error` | 37 | 125 | 21 | 2 | 17 | 202 |
| `trace_smtpad_accidental_contact` | 22 | 85 | 2 | 0 | 2 | 111 |
| `trace_via_overlap` | 1 | 27 | 4 | 0 | 0 | 32 |
| `pcb_via_clearance_error` | 2 | 0 | 0 | 0 | 0 | 2 |
| `trace_plated_hole_accidental_contact` | 0 | 0 | 0 | 0 | 2 | 2 |

Pad-related entries account for 315/1,091 (28.9%); via-related entries account
for 276/1,091 (25.3%). These families motivate pad and via prevention research.
The 500 generic `pcb_trace_error` entries must **not** all be relabeled as
trace-to-trace clearance errors. The benchmark's abbreviated message summaries
cannot completely subtype them. Categories partition reported entries, not
necessarily geometrically distinct violations.

Final output follows HD routing, force/repair, stitching, simplification and
other downstream processing. These totals do not identify the stage that
introduced an error, or prove that a node-router change can fix it. Inherited
fixed-copper violations may be outside a node router's authority entirely.
Dataset01 is already clean: its success criterion is preserving cleanliness
and completion without adding substantial overhead, not a percentage DRC gain.

## Ranked ideas, grounded in current code

Ranking separates potential coverage from implementation size. Benefits below
are hypotheses, not measured improvements or promises of a 30–50% reduction.

### 1. Make all ordinary routing paths consume physical obstacles

**Verified gap.** Pipeline9 selects ordinary routing when no fixed preloaded
route overlaps a node, even if board pads are nearby. It passes `obstacles`
into `HighDensitySolver`, but `IntraNodeRouteSolver` accepts that parameter
without storing or forwarding it to its leaf. The leaf receives previously
solved routes from that node, not the physical board obstacles. Most portfolio
families also omit the obstacle context; the through-obstacle branch is an
exception. [Node selection][selection], [ordinary factory][factory],
[leaf setup][intra], [portfolio factories][portfolio]

**Proposal.** Carry one immutable local physical-copper context through every
participating ordinary strategy. Include foreign pads, plated holes, immutable
preloaded copper, layer occupancy and resolved rule values. Check candidate
segments and vias in board coordinates. Direct-line, midpoint-via and
closed-form outputs must satisfy the same physical legality contract as search
edges; fixing only A* leaves shortcuts that bypass the correction.

Use authoritative connectivity for intentional pad entry, not name prefixes or
a blanket permission to intersect any copper near a terminal. SRJ currently
exposes rectangular obstacles with optional rotation; do not pretend this
already retains native circular/polygon pad geometry or use debug-only
`circuitJsonMetadata` as routing semantics. Any richer shape support requires a
typed SRJ geometry extension, separately reviewed. [SRJ obstacle contract][srj]

**Why it may be faster.** Reject an illegal extension immediately using a local
index, instead of materializing and repairing a complete bad route. Build the
immutable board index once, query nearby geometry, and share read-only context.

**Risk.** Previously accepted illegal routes may become failures. The existing
search must have legal detour candidates; a publication check alone is not a
router. Test every enabled ordinary family, own-net entry, foreign pads outside
the node but inside copper reach, rotated pads, layer controls and cache invalidation.

### 2. Check the whole segment against vias, using actual copper sizes

**Verified gap.** The regular leaf checks candidate-point distance to vias, but
its parent-edge predicate checks segments only. Two legal endpoints do not
prove that the copper between them clears a via. The final connector to the
goal uses the same edge predicate. The obstacle-index builder also discards
each obstacle route's width/via diameter, while guards use current-route sizes.
[Point and edge predicates][edge], [obstacle index construction][indexbuild]

**Proposal.** Extend the existing narrow-phase predicate with exact
point-to-segment distance for via copper over the segment's full length. Retain
actual obstacle radii, layer spans, connectivity and pair-specific clearances
in indexed primitives. For applicable foreign copper, require centerline
separation of at least `candidate radius + obstacle radius + required gap`.
Check a new via against all occupied layers, not just its start/end layer.

Keep existing candidate ordering and budgets. Query an expanded edge bounding
box, then test only nearby primitives. An index query is not itself a proof of
clearance. Existing `HighDensityRouteSpatialIndex` already accounts for maximum
copper radius in its broad phase; extend the actual leaf's missing behavior
rather than claiming that earlier index fix is new. [Existing route index][routeindex]

**Risk/test.** Larger vias and mixed-width traces expose hidden infeasibility.
Cover a via between legal endpoints, the final goal connector, threshold
equality, mixed diameters, same-net policy and intermediate-layer via occupancy.
This is the smallest recommended first implementation experiment.

### 3. Preserve physical clearance through coordinate transforms

**Verified gap.** Existing grow/shrink scales node bounds and port positions but
passes unchanged widths, via sizes, margins and physical obstacle coordinates
to its portfolio. It then inverse-scales route/via coordinates without changing
copper dimensions. The optional final-space validator is not supplied by the
ordinary Pipeline9 factory. [Transforms and acceptance][scaling], [factory][factory]

**Why this matters.** A centerline separation `d` in a space enlarged by `s`
becomes `d/s` after publication. If the required physical separation `R` stays
unchanged, passing `d >= R` does not imply `d/s >= R`. The transform therefore
does not preserve physical legality by construction.

**Proposal.** Prefer legal candidate generation directly in physical board
coordinates. If the existing coordinate transform is retained, transform all
dimensional constraints and obstacle geometry consistently, then restore
positions and dimensions consistently. Validate the final-space contract.
Do not add another growth strategy, adaptive calibration or repair-on-failure.

**Risk/test.** Some historical completion may rely on squeezed, invalid gaps.
Pure uniform scaling cannot create physical routing capacity. Use metamorphic
tests with pads, mixed widths, vias and nonzero node centers; report lost
completions instead of hiding them. Linear local-geometry transformation is
cheap, but its effect on search time and success must be measured separately.

### 4. Allocate physically feasible shared-edge ports before routing nodes

**Verified gap.** `redistributePortPointsOnSharedEdge` groups by layer and places
ports at equal fractions based on count. It accepts no widths or clearance
rules and does not use the port points' net ownership when spacing them.
Pipeline9 passes a `minTraceWidth` property to the parent
stage, but that stage's input/implementation does not consume it. Its obstacle
guard recognizes axis-aligned boundary coincidence, not clearance-expanded
blocked intervals. [Port allocation][ports], [input and dispatch][portinput],
[obstacle guard][portguard]

**Proposal.** Build usable intervals along each shared edge after subtracting
physical obstacle keepouts. Place crossings in stable order with the necessary
edge-to-edge spacing, preserving locked terminals and exact shared port IDs.
Both owners receive the same coordinates and local approach constraints.
Foreign-net center pitch must reflect both trace half-widths plus the rule gap.
Same-net shared ports still need exact terminal/branch ownership.

**Cost/risk.** Sorting plus interval construction is bounded local work; an
index avoids scanning every board obstacle for every edge. A genuinely
over-capacity edge must be reported as infeasible, not squeezed. Coordinate
movement alone cannot fix a topologically impossible assignment, and boundary
pitch alone does not guarantee safe approach angles.

**Tests.** Unequal widths, partial edge blockage, corner approaches, rotated
obstacles, different layers, exact capacity boundaries, fixed terminals and
two-owner endpoint equality. Topology changes, if needed, are a separate experiment.

### 5. Give adjacent nodes a shared copper-clearance contract

**Verified gap.** `finishActiveNode` appends completed routes, but subsequent
ordinary and B01 setups do not include those previously generated neighboring
routes as obstacles. Independent centerlines can be individually valid yet
place copper too close across a seam. [Completion/setup][neighbors], [B01 input][b01input]

**Proposal.** Combine the precomputed boundary contract from idea 4 with an
immutable view of relevant committed neighboring copper. Query a halo sized
from candidate copper reach plus applicable clearance, rather than using node
centers alone. Preserve fixed/preloaded ownership and all layer spans.

**Risk.** A naive "route nodes serially and freeze the earlier winner" design
can reduce completion, parallelism and cache reuse. Prefer shared constraints
known before independent routing where possible. If committed-neighbor context
is necessary, its deterministic ordering/version must be explicit in both
local and networked execution. Do not let speculative remote nodes see a
different problem. [Network input projection][network]

**Tests.** Two neighboring nodes, near-seam vias, corner neighbors, same-net
shared ports, preserved physical splice ownership, local/network equivalence
and routing-order sensitivity. This is broader than the first leaf-level fix.

### 6. Propagate declared via/pad rules and complete obstacle envelopes

**Verified gap.** The B01 adapter includes board obstacles only when they overlap
node bounds expanded by `obstacleMargin`; candidate copper extends beyond its
centerline. `viaToPadClearance` is stored but forwarded to the regional path,
not the ordinary/B01 constructors. B01 uses a fixed preloaded clearance value.
This is not proof B01 has no obstacle checking: it already performs exact
layer-aware checks against supplied obstacles. [Adapter][b01input], [pinned B01][b01]

**Proposal.** Resolve trace/pad, via/pad and via/via rules once, then supply the
appropriate values and full physical envelope to candidate generation. Maintain
pad shape/rotation/layer fidelity within the actual input contract. Treat
same-net attachment and permission for via-in-pad separately; do not globally
exempt connected pads or alter manufacturing rules to make a route pass.

**Risk/test.** Missing context causes false negatives; oversized rectangular
keepouts cause false positives. Cover large vias beside pads just outside a
node, non-default clearances, inner layers, rotated geometry, permitted pad
entry and prohibited via-in-pad. Predicate parity must use the pinned native
checks as the independent oracle.

### 7. Make exact legality cheap and cache-safe

This supports ideas 1–6; caching alone does not repair or prevent a DRC.

Build typed segment/via/pad primitives once per immutable context. Use the
existing spatial-index machinery for conservative candidate retrieval and exact
local tests. With `k` nearby primitives, narrow-phase work is proportional to
`k`, although a dense/worst-case query can still reach the whole local set.
Do not run Circuit JSON conversion, connectivity reconstruction and full-board
DRC for every candidate edge.

Every cache must include the physical context that changes feasibility:
geometry, dimensions, rule values, layer occupancy, connectivity, boundary
contract, coordinate frame and algorithm schema. The existing intra-node key
does not contain board obstacles because its leaf does not use them today;
adding obstacle checks without changing that key permits stale routes.
[Current cache key][cache]

Test moved pads, changed clearances, unchanged node coordinates with changed
neighbors, cache hits versus uncached execution, and local/networked results.
Missing or inconsistent context must fail visibly; never serve an old route
as an implicit alternate solution.

## Two analytical reproduction designs for the first prototypes

These are constructed geometric examples, **not executed test results**.

1. **Via between legal grid endpoints:** node `[-4,4]²`, target top-layer
   route `(-4,0) → (4,0)`. A foreign route descends from `(-2.8,4,0)` to
   `(-2.8,0.30,0)`, changes to layer 1 there, then reaches `(-2.8,-4,1)`.
   Trace widths are 0.15, via diameter 0.30 and obstacle margin 0.15.
   With planar candidate spacing 0.80, consider the grid edge
   `(-3.2,0) → (-2.4,0)`: both endpoint distances to the via are 0.50, but the
   actual copper gap is `0.30 - 0.15 - 0.075 = 0.075`, below 0.10.
   The existing endpoint-via threshold is 0.375; the V6 segment threshold is
   0.225. The endpoints pass the former, and the foreign same-layer arm 0.30
   away passes the latter, while the full edge violates via clearance.
   Terminals are on node boundaries and a detour is geometrically possible.
   Exercise both the edge predicate and a real solve remotely, with safe controls.
2. **Pad outside a node, clearance inside it:** node `[-4,4]²`, top-layer
   terminals `(-4,3.85) → (4,3.85)`, trace width 0.15. A foreign top-layer
   rectangular pad centered `(0,4.10)` has width 0.50 and height 0.20.
   Its copper starts at `y=4.0`, but the direct route's edge gap is
   `4.0 - 3.85 - 0.075 = 0.075`. An inward detour through `y=3.5` is possible.
   This exercises clearance-aware obstacle reach without placing pad copper
   inside the mesh node. A bottom-layer-only pad is the legal direct-path control.

## Recommended implementation and validation sequence

1. **Attribute before optimizing.** On hosted fixtures, capture canonical
   DRCs/ownership before routing, directly after raw HD routing, after existing
   HD force/repair, after stitching, after simplification/width changes and at
   final output. Distinguish inherited violations from new ones, and node-local
   from cross-node/pad/preloaded conflicts. Retain full stage diagnostics as
   artifacts; the top-five-message summary cannot establish cause. These extra
   diagnostic checks must be outside timed benchmark measurements.
2. **Small first code experiment:** exact full-edge via checking with actual
   obstacle copper dimensions and goal-connector coverage (idea 2). No new
   solver, force pass, candidate budget or adaptive strategy.
3. **Next separate experiment:** physical pad-context propagation through all
   ordinary strategy paths, their shortcuts and caches (idea 1). Do not call a
   leaf-only patch complete while another winning path ignores the same pads.
4. **Then isolate transforms and seams:** ideas 3–6 address distinct mechanisms.
   Do not combine all of them into an uninterpretable benchmark delta. For a
   strictly force-free claim, include a separately identified revision without
   the existing HD force/repair stages; retain downstream Repair03 in that run.
5. **Remote correctness first, then six-dataset comparison.** Use generic
   geometry/metadata tests plus existing regressions. Validate native ordered
   errors and geometry where relevant, not just aggregate counts. Keep shared
   solver consumers and networked node execution covered by CI.

For each code experiment, use the repository's deployed commands on its PR:

```text
/benchmark-all --pipeline 9 --same-machine
/benchmark --pipeline 9 --dataset 19 --same-machine
/benchmark --pipeline 9 --dataset 20 --same-machine
/benchmark --pipeline 9 --dataset 21 --same-machine
/benchmark --pipeline 9 --dataset 23 --same-machine
```

The current all-dispatcher covers 01/18; explicit commands cover 19/20/21/23.
Keep both sides' timeout, effort, worker/concurrency and dataset revisions
identical. Verify actual main/PR SHAs from result comments. Report matched-board
DRCs, newly clean/dirty boards, gained/lost completions, new/preexisting timeouts,
other failures, P50/P95, aggregate time, via counts and stage time. Timed-out
boards do not become DRC improvements. More completion does not automatically
justify new DRC regressions.

No benchmark is manually dispatched for this documentation-only revision:
there is no algorithm change to measure. GitHub may run its normal PR checks;
those are not evidence that any proposed prevention mechanism works.

## External primary-source check

Rule-aware construction is an established routing model: KiCad's official
manual describes respecting copper rules while placing tracks/vias, including
a walk-around mode that does not move existing obstacles. This supports the
direction, not a claim about tscircuit performance or algorithm equivalence.
[KiCad routing rules][kicad]

The pinned B01 source already distinguishes broad-phase obstacle cells from
exact collision checks. Reuse that design principle where appropriate, but
do not replace every ordinary node with B01 based on its small synthetic
obstacle-dataset results: its input/window limits and completion tradeoffs
must be measured on real Pipeline9 datasets. [Pinned B01 description][b01]

[rules]: https://github.com/tscircuit/tscircuit-autorouter/pull/2321/files
[stages]: https://github.com/tscircuit/tscircuit-autorouter/blob/fb6c6d77c091a56c9e1d4648bbac40a7cccd0def/lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts#L638
[selection]: https://github.com/tscircuit/tscircuit-autorouter/blob/fb6c6d77c091a56c9e1d4648bbac40a7cccd0def/lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver.ts#L960
[factory]: https://github.com/tscircuit/tscircuit-autorouter/blob/fb6c6d77c091a56c9e1d4648bbac40a7cccd0def/lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver.ts#L339
[intra]: https://github.com/tscircuit/tscircuit-autorouter/blob/fb6c6d77c091a56c9e1d4648bbac40a7cccd0def/lib/solvers/HighDensitySolver/IntraNodeSolver.ts#L103
[portfolio]: https://github.com/tscircuit/tscircuit-autorouter/blob/fb6c6d77c091a56c9e1d4648bbac40a7cccd0def/lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver.ts#L409
[srj]: https://github.com/tscircuit/tscircuit-autorouter/blob/fb6c6d77c091a56c9e1d4648bbac40a7cccd0def/lib/types/srj-types.ts#L109
[edge]: https://github.com/tscircuit/tscircuit-autorouter/blob/fb6c6d77c091a56c9e1d4648bbac40a7cccd0def/lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver.ts#L337
[indexbuild]: https://github.com/tscircuit/tscircuit-autorouter/blob/fb6c6d77c091a56c9e1d4648bbac40a7cccd0def/lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver.ts#L484
[routeindex]: https://github.com/tscircuit/tscircuit-autorouter/blob/fb6c6d77c091a56c9e1d4648bbac40a7cccd0def/lib/data-structures/HighDensityRouteSpatialIndex.ts#L119
[scaling]: https://github.com/tscircuit/tscircuit-autorouter/blob/fb6c6d77c091a56c9e1d4648bbac40a7cccd0def/lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver/GrowShrinkHighDensityIntraNodeSolver.ts#L47
[ports]: https://github.com/tscircuit/tscircuit-autorouter/blob/fb6c6d77c091a56c9e1d4648bbac40a7cccd0def/lib/solvers/UniformPortDistributionSolver/redistributePortPointsOnSharedEdge.ts#L27
[portinput]: https://github.com/tscircuit/tscircuit-autorouter/blob/fb6c6d77c091a56c9e1d4648bbac40a7cccd0def/lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver.ts#L22
[portguard]: https://github.com/tscircuit/tscircuit-autorouter/blob/fb6c6d77c091a56c9e1d4648bbac40a7cccd0def/lib/solvers/UniformPortDistributionSolver/shouldIgnoreSharedEdge.ts#L18
[neighbors]: https://github.com/tscircuit/tscircuit-autorouter/blob/fb6c6d77c091a56c9e1d4648bbac40a7cccd0def/lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver.ts#L460
[b01input]: https://github.com/tscircuit/tscircuit-autorouter/blob/fb6c6d77c091a56c9e1d4648bbac40a7cccd0def/lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver.ts#L980
[network]: https://github.com/tscircuit/tscircuit-autorouter/blob/fb6c6d77c091a56c9e1d4648bbac40a7cccd0def/lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9NetworkedInputProjection.ts#L14
[cache]: https://github.com/tscircuit/tscircuit-autorouter/blob/fb6c6d77c091a56c9e1d4648bbac40a7cccd0def/lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver.ts#L150
[b01]: https://github.com/tscircuit/high-density-b01/blob/e651cab6c314e7aab6df31fd6067277436f67148/README.md
[kicad]: https://docs.kicad.org/10.0/en/pcbnew/pcbnew.html#routing-tracks
[result01]: https://github.com/tscircuit/tscircuit-autorouter/pull/2436#issuecomment-5571074761
[result18]: https://github.com/tscircuit/tscircuit-autorouter/pull/2436#issuecomment-5571075066
[result19]: https://github.com/tscircuit/tscircuit-autorouter/pull/2436#issuecomment-5566392643
[result20]: https://github.com/tscircuit/tscircuit-autorouter/pull/2436#issuecomment-5566392989
[result21]: https://github.com/tscircuit/tscircuit-autorouter/pull/2436#issuecomment-5571080555
[result23]: https://github.com/tscircuit/tscircuit-autorouter/pull/2436#issuecomment-5571079300
