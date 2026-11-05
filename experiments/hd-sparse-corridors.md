# Experiment: event-driven sparse visibility routing

Hypothesis: hard intra-node routing can sometimes avoid the area/pitch² cost of
fine grids by jumping through empty regions and creating spatial events only
where an exact copper collision requires them. This is an independent portfolio
strategy, not a global increase of cell pitch or an A01 representation patch.

`SparseVisibilityIntraNodeSolver` is registered in the ordinary
`PortfolioSingleIntraNodeSolver` before its expensive grid/native families. It
routes 2–32 explicit tasks at physical coordinate scale 1, using two deterministic
route orders. It accepts explicit port-point pairs or constructs linked/sequential
pairs for each connection. The initial catalog contains both terminals and the
node center, on the available routing layers. A* considers straight visibility
edges and layer transitions at a shared XY event. Failed edges identify actual
blocking capsules/rotated rectangles; failed catalog searches add circumscribed
boundary events around those blockers. Subsequent refinements introduce trace-
width events and finer angular events. There is no uniform grid allocation.

Each planar edge checks exact finite-width copper clearance, with cached AABB
rejection before the narrow phase. Ownership equivalence is frozen per task.
Prior routes become layer-specific trace capsules and full-stack via disks.
Through-vias check every board layer, own-net pads are excluded from via placement,
and drill spacing is checked separately, including within the new path. Endpoint
coordinates and port identities are retained. A completed candidate is checked
with the independent Pipeline9 pairwise copper predicate, board-outline DRC,
and repair04 fixed-obstacle validation. A broader board rule rejection reports
UNKNOWN rather than an internal-invariant exception. Internal disagreement
between exact edge and pair checks still throws.

The strategy deliberately does not run on virtual grow/shrink scenes: those
scale node coordinates while retaining unscaled board obstacles and physical
widths, so passing that scene cannot certify the inverse-scaled physical output.
Established portfolio families retain their own search policies. Sparse failure
is an explicit bounded candidate outcome, not a pipeline exception recovery or
a physical infeasibility certificate.

Work bounds are 128 XY events per task, four refinement rounds, 200,000 exact
geometry tests and 2,000,000 broad-phase tests per candidate, and two route orders.
Catalog construction and geometry checking are charged in diagnostics. The
existing supervisor still selects by its fitness policy; the sparse candidate
uses exact-test work/100,000 as its scheduling G. These units are an experiment,
not a CPU-equivalence theorem. Each selected step routes one task or records a
bounded search outcome.

Counters are emitted live into the shared `priorityDiagnostics` object, which
Pipeline9 exposes as `benchmarkDiagnosticCounters`: `sparseInstances`,
`sparseOrdersAttempted`, `sparseGeometryTests`, `sparseBroadphaseTests`,
`sparseEdgesChecked`, `sparseExpandedStates`, `sparseRefinements`, `sparseEvents`,
`sparseSolvedTasks`, `sparseWins`, `sparseUnknown`, `sparseSearchTimeMs`,
`sparseBoardValidationCalls` and `sparseBoardValidationIssues`. Search time is
elapsed wall time, including catalog setup within steps and final validation;
constructor/import costs remain part of the enclosing stage and whole-board time.
Solved-task and event counts include work discarded by a later ordering.

Validation:

```sh
bun test tests/hd-sparse-corridor-*.test.ts --timeout 9999999
bun node_modules/typescript/bin/tsc --noEmit --pretty false
./benchmark.sh --pipeline 9 --dataset 18 --concurrency 2 --threads 1 --effort 1
./benchmark.sh --pipeline 9 --dataset 24 --concurrency 2 --threads 1 --effort 1
```

Five focused tests cover an open 0.36 mm versus closed 0.34 mm channel with
0.15 mm traces and 0.10 mm edge clearance, event-driven obstacle detours, inner-
layer obstacles under through-vias, retained terminal identities, rotated copper,
a concave board outline, explicit work bounds, and virtual-scene scope. Initial
captured physical cmn_3/cmn_36/cmn_0 probes all returned UNKNOWN within the bounds;
there is no claimed hard-node speedup from these probes. The complete dataset18/
24 evaluation is performed separately and must compare final DRC-clean success,
phase time, attempts, route/via quality, memory, and not just A* expansions.

Limits: this is a bounded greedy multinet strategy. A sparse catalog can miss a
valid channel or useful via portal; bounded failure means UNKNOWN. Through-vias
are conservative even when blind/buried vias are allowed. Fixed endpoint or board
rule conflicts can reject a proposal after search. The independent checker
validates this candidate before the shared portfolio's established same-root
connectivity postprocessing; final board connectivity and DRC remain required.
Different routing objectives and added portfolio effort can alter downstream
repair work, so isolated kernel gains and end-to-end gains must be reported
separately. No completeness, shortest-board-path, or dataset speedup claim follows
from the sparse graph alone.

## Follow-up after broad CI

The first measured version exposed terminal-tag and scheduling-accounting bugs.
Its CI and dataset results remain evidence for that exact head; the corrected
version requires a fresh head-specific comparison.

Search states and output interior points now contain explicit XYZ coordinates,
so a via at a terminal cannot copy that terminal's PCB ID onto another layer.
Only actual route endpoints retain point-level PCB identities. Route-level
start/end tags are applied by HighDensitySolver's existing explicit preservation
policy; the sparse kernel no longer overrides that policy. Node region IDs are
retained, and sparse winners are reported by their concrete solver name instead
of being mislabeled as the native IntraNodeRouteSolver strategy.

Sparse fitness is now computed after common candidate-work accounting. The
existing tracked-versus-scanning scheduling regression passes, including a
candidate that changes its work limit. Exact-XY layer-change tasks explicitly
remain with the native endpoint/nearby-via strategy: a generic sparse center
portal must not replace that established fast path.

The new terminal-via regression verifies unique endpoint IDs, XYZ-only interior
points, the outer route-tag policy, and successful native stitching. Existing
physical-clearance tests are unchanged. No virtual-scene prototype was merged.

The bugreport44 maximum-segment-length assertion remains a separate representation
contract to assess. Its three >2mm stitched segments match original sparse macro
edges after the existing stitcher's 0.001mm coordinate rounding; they are not
new connecting jumps. The HD route type does not specify a maximum segment
length, and copper checks accept continuous segments. No output subdivision or
snapshot change was introduced merely to satisfy that dense-route proxy.

Local follow-up validation passed all nine focused/accounting/native-via tests
(86 assertions), plus the four previously failing Pipeline9 numerical stitching
regressions for SRJ18 samples4,8,9 and11 (27 assertions). These are correctness
checks, not a controlled performance comparison. Full datasets18/24 and broad
CI must be evaluated at the corrected head separately from the first experiment.
