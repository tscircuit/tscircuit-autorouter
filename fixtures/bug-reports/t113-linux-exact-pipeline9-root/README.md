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

On `v0.0.905`, Pipeline9 gives a generated fixed route a canonical
`rootConnectionName`, while the matching board pad carries the member trace and
port IDs from that net. `ConnectivityMap.areIdsConnected` maps member IDs to a
net; it does not map a net ID back to itself. Passing the canonical route root
to that member-only comparison makes the regional via candidate validator
reject the route's own pad as foreign copper.

The fix resolves the route's net at that Pipeline9 boundary and compares it to
the pad's mapped member IDs. The exact regression uses the captured
`pcb_smtpad_139`, `source_trace_44`, generated fixed-route identity, and
canonical net from this fixture. The connectivity package remains unchanged,
so routing stages that operate only on member IDs retain their existing
behavior. The updated PCB artifact uses the same renderer, viewport, and layer
colors as the reproduction and adds the 42 routes reached after candidate
validation. The full solver then stops at the next independent invariant,
reconnecting
`breakout:pcb_breakout_point_68_fixed_168_1`.
