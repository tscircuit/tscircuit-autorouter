# Exact T113-S3 Pipeline9 root reproduction

These fixtures were captured directly from the final autorouting phase of the
96-component Allwinner T113-S3 Linux PCB. The source board uses the default
Pipeline9 autorouter, four copper layers, and Core fanout phases. It contains no
manual routes, vias, or route hints.

`t113-linux-exact.srj.json.gz` is the unmodified final-phase SimpleRouteJson:

- 29 connections remaining after fanout phases
- 397 obstacles
- 342 preloaded traces
- SHA-256: `fd6a9156391178e258dc8cb4b1523e609b8587119f1a9302579b4600bba1aa63`

`t113-linux-exact-unrouted.circuit.json.gz` is the matching Circuit JSON before
the final autorouter phase. It contains all 96 source and PCB components and no
PCB traces or vias.

On `v0.0.905`, Pipeline9 throws while serializing same-port route 201 because
the route has no segments from which to infer endpoint regions. The snapshot is
rendered from the exact unrouted Circuit JSON so the stacked fix changes the
same real PCB SVG from unrouted to routed.

On current `main`, the closed-route serialization fix lets the exact solver
advance to `No path found for source_trace_194`. The checked-in
`t113-linux-exact-pipeline9-state.svg` renders the complete board and its 342
preloaded fanout traces at that failure boundary. The stacked canonical-net fix
updates this same file with the 42 routes Pipeline9 reaches after accepting the
previously rejected same-net candidate.

After the closed-route serialization fix, Pipeline9 reaches a second ownership
case in regional via validation. Generated fixed routes carry a canonical
`rootConnectionName`, while board obstacles carry member trace and port IDs.
Passing those two forms directly to `ConnectivityMap.areIdsConnected` makes the
exact route `source_trace_44_fixed_262_13` treat its own `pcb_smtpad_139` as
foreign copper.

The Pipeline9 fix maps the route and obstacle identities to their canonical
nets at that validation boundary. The connectivity package keeps its existing
member-ID semantics. `t113-linux-exact-pipeline9-state.svg` is a full-board PCB
render of the 42 routes reached after the candidate is accepted, using the same
viewport and layer colors as the reproduction.

This layer retains the zero-length `1..2` fanout span in the regional
section that replaces positions `0..3`. The exact solver then completes with
`solved=true`, `failed=false`, and materializes all 42 routed or mutated traces
in the updated SVG. This is routing progress rather than a clean board: the
strict repository DRC reports 69 errors, and `tsci check shorts` reports 47
physical shorts. Those downstream violations require separate reproductions
and root fixes.

`t113-post-repair-via-overlap.json` captures the last DRC error after the
focused uniform-distribution, terminal-metadata, and promoted-via clearance
fixes. A repaired preloaded via and a new same-net via are only 0.0077 mm apart,
which leaves their 0.2 mm drill holes overlapping by 0.1923 mm before the
final same-net via merge. The board requires another 0.1 mm between drill
edges.
