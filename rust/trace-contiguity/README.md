# Trace continuity

Direct port of the trace-continuity checker used by `lib/testing/getDrcErrors.ts`.
The reference is the installed `@tscircuit/checks` 0.0.163 and
`circuit-json-to-connectivity-map` 0.0.19, as retained in the frozen TypeScript
comparison checkout.

| Rust file | TypeScript source |
| --- | --- |
| `check_traces_are_contiguous.rs` | `check-traces-are-contiguous.ts` |
| `pcb_connectivity_map.rs` | `PcbConnectivityMap.ts` (construction and trace lookup) |
| `connectivity_map.rs` | `ConnectivityMap.ts` (construction and lookup) |
| `find_connected_networks.rs` | `findConnectedNetworks.ts` |
| `get_pcb_port_ids_connected_to_traces.rs` | `getPcbPortIdsConnectedToTraces.ts` (point and trace helpers) |
| `line_intersections.rs` | `@tscircuit/math-utils` `line-intersections.ts` (checker dependencies) |
| `is_point_in_pad.rs` | `is-point-in-pad.ts` |
| `segment_to_polygon_clearance.rs` | `segment-to-polygon-clearance.ts` (pad geometry helpers) |

The pairwise connectivity checks, network merge order, geometric expressions,
and tolerances follow the source. `types.rs` holds the prepared numeric fields
used by these loops. Trigonometry and `Math.hypot` call the JavaScript functions.

The binding receives only fields read by the checker. Error descriptors refer
to indices in the original circuit array; the TypeScript adapter retains the
existing readable-name helpers, numeric formatting, and error property order.
Caller metadata stays in TypeScript. The frozen-reference oracle is
`rust/autorouter-bindings/integration/trace-contiguity-parity.ts`.
