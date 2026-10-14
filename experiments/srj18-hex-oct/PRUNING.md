# Safe layer-change pruning

This extends the independent experimental router, not FreeRouting or a production
tscircuit pipeline. The hex/oct lattices, net ordering, breakout/goal limits,
Euclidean A* lower bound, trace costs, and 2 mm layer-change charge are unchanged.
The experimental default remains `--layer-pruning off` until results justify a
default change. Modes are `off`, `cached`, and `regions`.

`cached` rejects already dominated layer transitions before checking geometry,
then evaluates through-via legality once per physical location per search. It
retains exactly the same graph and costs. `regions` adds the pruning below.

## Certificate and proof scope

Nested, aligned patches cover four grid intervals up to approximately 5 mm.
Hex patches form parallelograms; the enclosing Cartesian box is certified, so
false negatives are possible but an uncertified patch loses no transitions.
The box is expanded by clearance plus the larger of trace/via radii. It must
lie inside the outline and intersect no foreign pad or committed copper on any
layer. Broad-phase bounding boxes are deliberately conservative. Same-net
copper may be touched under the existing router's rules.

For a certified patch:

- Every internal grid edge is legal on every layer, with identical wire cost.
- Every vertex, including the boundary, is a legal through-via location.
- All boundary vertices and all search starts/targets remain layer gateways.
- Interior layer-change edges are removed; ordinary wire edges remain.

Take any complete path segment through the patch. Project its internal wire
steps onto its entry layer. If it leaves on another layer, place a single
layer change at the exit gateway; otherwise remove its layer changes. Wire
length is identical and the layer-change cost cannot increase. A start/target
inside a patch supplies the corresponding gateway. Nested aligned patches keep
the outer boundary of a certified parent, even when a smaller patch is present.
Thus the optimum cost and reachability of a fixed-board individual search are
preserved under the current uniform layer costs and through-via rules.

This is not a guarantee of identical whole-board output or completion under a
wall-clock cap. Moving a via changes copper available to subsequent greedy
connections. Region certificates and via caches are search-local, so no cached
answer survives a copper commit, net change, or trace-width change. Layer-specific
obstacles, tight escapes, concave outline edges, and inner-layer copper cannot
receive a clear certificate. Necessary short two-via bridges remain available.
Directional layer costs, blind vias, or nonuniform via costs would require a
new proof and are not introduced by this experiment.

## Validation and benchmark

Seven added test files cover independent Dijkstra costs on 60 cases across both
grids, 2/4 layers and three via costs; internal starts/targets; necessary bridges;
copper invalidation; concave outlines/inner copper; exact cached-mode paths; and multiple breakout/physical-tree targets with endpoint costs.
The original 26 routing tests also run. Tests do not establish a runtime benefit.

`benchmark_pruning.py` runs all five existing pitches with all three modes on
Blacksmith. Each lane has a fixed CPU, each solve is a fresh process, and mode
order is reversed across two repetitions. The 60-second cap and geometry rules
are shared. Both repetitions are independently checked using Shapely; the bundle
retains inputs, all raw traces, experiment counters, evaluations, source hashes,
CPU assignments, timing, and workflow identity. Errors fail the job rather than
being converted into empty successful outputs.

The gallery displays repetition one, chosen before the experiment, and labels
historical results from the other host. Full-board via totals and expanded states
are reported alongside completion: a faster run can expand more states because
it routes more requests. Matched completed-net quality and uncapped paired timing
must be used before interpreting these totals as quality or speed improvements.

The isolated workflow template is `blacksmith-pruning.example.yml`. For this PR,
it is activated only on the upstream experimental branch as
`.github/workflows/srj18-layer-pruning.yml`; no default-branch workflow or
production routing code changes are needed.
