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
