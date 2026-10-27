# Physical net forest experiment

The experiment grows physical copper before terminal-pair decomposition. A
multipoint net first requires a connected graph of continuously validated,
same-layer terminal visibility edges. It then attaches each new terminal to the
nearest visible point on already committed branches, including segment interiors.
Each branch is emitted once. There are no per-demand copies of an existing tree
path. Trace `connectsTo` references record the actual terminal/branch attachment;
the existing initially-connected map uses those references to omit redundant MST
demands. Original requests remain in the source input.

Generated branches enter the same preload, high-density obstacle, simplification,
DRC repair, power expansion, and output paths as other actual copper. Existing
upstream topology mechanisms may revise them; all current materialized copper
is retained, and final physical net connectivity is checked. At the joint DRC
and bounded repair handoff, generated branches are fixed at those current
positions. Repair's
original-copper context includes generated branches, so interactions with future
routes are checked. A separate final connectivity assertion unions intersecting
copper segments and vias geometrically and checks every committed terminal. It
never joins copper by trace IDs, net labels, or `connectsTo` declarations.

## Scope

`usePhysicalNetForest` defaults to true; false disables construction. Diagnostics
are exposed as `physicalNetForestSolver.diagnostics`, including committed nets,
branches, segment-interior attachments, avoided pair demands, segment checks,
copper length, and the number of nets validated physically at final output.

The constructive module handles 3–24 distinct terminals with stable `pointId`s
and a common accessible layer. It excludes externally connected/off-board nets,
existing same-net preloaded copper, terminal-via requests, bus members, and
explicit differential pairs. It checks nominal/minimum width (including the
legacy width alias), pad/hole clearance, rotated obstacle envelopes, board bounds
and outlines, and foreign committed copper. Non-plated holes remain obstacles
regardless of an incorrect same-net label. Rectangular hole envelopes are
conservative. Unsupported fixed-copper primitives do not establish eligibility.

Nets outside that constructive class retain their original unresolved routing
requirements. This eligibility decision is not a bounded search failure and
makes no physical impossibility claim. The module does not construct vias or
search obstacle detours. A future extension can enlarge the constructive class
without changing the physical branch interface.

## Functional evidence

With cache disabled, local screens completed SRJ18 samples 1 and 5 and SRJ24
sample 25 with zero relaxed-DRC errors. Sample 5's final geometric assertion
validated all six constructed nets, including an interior attachment. Sample 25
validated all three constructed nets: nine branches, three interior attachments,
48 remaining native pairs. Its direct physical copper length is 29.376 mm versus
32.295 mm for its visible terminal-edge trees. This comparison concerns only the
constructed nets, not total board quality or solve time.

Construction-only activation screens cover all dataset inputs, without claiming
routing completion or timing improvement: SRJ18 activates 14/16 inputs, constructs
74 nets and 209 branches, and makes 19 interior attachments; SRJ24 activates 22/26
inputs, constructs 309 nets and 903 branches, and makes 131 interior attachments.
The corresponding counts of avoided pair demands are 209 and 903. These screens
precede pipeline preprocessing; official full-pipeline diagnostics may differ.

Eleven focused tests (68 assertions) cover single-copy interior attachment, omission
of physically satisfied demands, obstruction/constraint/layer/off-mode exclusions,
width and non-plated-hole handling, retained terminal ownership regressions, and
a negative geometry test that leaves IDs unchanged while disconnecting copper.
Type checking and the final ESM/DTS build pass. Full corpus timing and quality comparison belongs on the
configured Blacksmith benchmark, against common main 637b6c5 and using datasets
18 and 24; no speedup is established by the local screens.

The large local SRJ24 sample 1 screen and one concurrent build were killed by
the shared container memory limit. Those runs establish no result for solve
quality or speed and are not counted among completed functional screens.

## V2 repair integration follow-up

V1's preload representation accidentally disabled the existing bounded repair
stages on boards that previously had no user-preloaded copper. The v2 follow-up
passes explicit generated-branch provenance, keeps those branches fixed at their
current materialized positions, and projects their complete physical envelopes
into the bounded search's fixed obstacles. Original actual copper remains in the
unchanged whole-board reference evaluator. Real user preloads retain the existing
bounded-repair exclusion; IDs or name prefixes never determine provenance. Both
initial and post-exact bounded stages retain their original allowances.

The original SRJ18 regressions for samples 9, 11, 12 and 16 now pass unchanged.
Sample 12 changes from zero bounded attempts and one remaining via error in v1
to three accepted bounded regions and zero DRC errors in the follow-up, using
9 candidates and 7,179 path-search nodes under the original 4,096-candidate and
40,000,000-node ceilings. Muse's original DRC and minimum copper-gap assertions
also pass; its SVG expectation remains a separate route-policy review item.

The follow-up also honors the public updated-preload extension point and carries
explicit `cacheProvider: null` through regional fallback, preventing a first solve
from warming a process cache that changes a subsequent solve's work accounting.
V1 benchmark results remain evidence for the published v1 SHA, not this revision.

The final focused suite passes 20 tests and 168 assertions. Its provenance
regression passes three assertions and rejects duplicated branch IDs that could
otherwise conceal a missing generated branch. The three native algorithm
isolation tests pass 5,527 unchanged assertions with the forest explicitly disabled.
The actual four native Bun worker replay on SRJ18 sample 1 passes exact output,
high-density routes, stats, and iteration comparisons: 1,065 dispatches and 205
output traces, with identical SHA-256
`0b3e844fa00765c37678cf596dd7887a853c09c262eb9e41e836fad3e8243bbc`.

Same-source on/off controls use effort 1 and explicit null cache propagation in
both arms. SRJ18 sample 5 removes 14 native pairs (172 to 158) and validates six
constructed nets, but total iterations increase from 192,730 to 329,306 and HD
iterations from 13,151 to 106,929. SRJ24 sample 25 removes nine pairs (57 to 48),
while total iterations increase from 59,042 to 72,924 and HD iterations from 900
to 24,143. All four solves have zero reference DRC errors and zero errors with
board clearance included. These controls demonstrate physical branch reuse and
substantial downstream work overhead; fewer pairs are not a board-level speedup.

The unchanged bugreport107 regression remains a real failure: after 552.936
seconds it has 145 reference DRC errors. Its repair-stat assertions now pass,
but its zero-DRC assertion fails. This board has 382 connections and 1,072
obstacles, with six constructed nets and 14 branches; its input to joint repair
already has 371 errors. The cause is not established. This off-corpus run exceeds
the benchmark's 360-second routing timeout and is retained as a known regression,
without excluding the board or relaxing its assertions. Full dataset results
must determine whether this integration is useful despite these limitations.
Machine-readable evidence is in `physical-net-forest/RESULTS-V2.json`.

The bounded search's generated-via projection represents complete copper spans
as owned rectangles. It does not add an independent drill obstacle, so an
owned-net search can propose a via that violates same-net drill spacing. The
unchanged actual-copper reference validator still rejects that proposal; the
projection is a conservative copper search model, not a substitute for the
manufacturing-rule validator. Current materialized forest vias are retained in
that reference context.
