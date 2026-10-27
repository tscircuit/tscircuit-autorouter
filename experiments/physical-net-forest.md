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
DRC repair, power expansion, and output paths as other actual copper. Repair's
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
