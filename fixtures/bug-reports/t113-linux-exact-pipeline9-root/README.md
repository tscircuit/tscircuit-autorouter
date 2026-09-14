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
PCB traces or vias. `t113-linux-exact-pipeline9-state.svg` renders that Circuit
JSON together with the SRJ's 342 preloaded traces. The routing-focused view
keeps the board outline, component pads, holes, vias, and routed copper while
omitting the source ratsnest, copper pour, silkscreen, and fabrication notes
from both sides. The stacked fix uses the same renderer, viewport, and style
after adding the routes Pipeline9 completes before its next failure, so
GitHub's image diff compares like with like without making CI depend on a
platform-sensitive solver path.

On `v0.0.905`, `source_trace_44` belongs to `connectivity_net57`, but
`areIdsConnected("connectivity_net57", "source_trace_44")` returns false. The
regional candidate validator can therefore reject the trace's own pad as
foreign copper. The later full-solver failure varies by runtime and platform,
so the test asserts this ownership defect directly and verifies that the PCB
review artifact is present.
