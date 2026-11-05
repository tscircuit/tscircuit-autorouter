# STMP157 native DDR preload policy

`stmp157-native-ddr-preloads.srj.json.gz` is derived from the captured STMP157
input and preceding Circuit JSON at `stmp157-remaining-mesh/input.srj.json.gz`
and `fixtures/bug-reports/ddr-topology-validation/stmp157.preloaded.circuit.json.gz`.
Their original source, license and capture versions remain documented beside
those files.

The board is OLIMEX STMP157-OLinuXino-LIME2 rev B1, with STM32MP157CAA3x and two
K4B4G1646D-BYK0 DDR3 chips. Source revision
`85eee9c17ee13af65617d73bdd94de7ec49cfb42`, license CC-BY-SA-3.0-US.

The fixture reconstructs the handoff before existing copper was rasterized: all
710 original pads and all 32 completed native DQ traces remain. Source-port and
PCB-port connectivity is retained. Only the existing remaining DQM0 connection
`source_trace_56` is requested; no placement, width, clearance, layer or route
coordinate changes. The 32 existing traces explicitly request `isFixed: true`.

Exact derivation: retain input obstacles with `componentId`; retain connection
`source_trace_56`; replace `traces` with the 32 Circuit JSON `pcb_trace` records
in source order. Each trace retains its ID and route, uses `source_trace_id` as
`connection_name`, and receives `isFixed: true`. Its `connectsTo` contains the
matching source trace's `connected_source_port_ids`, followed by each wire
point's defined start/end PCB-port IDs in route order. All other input fields
remain unchanged. Compact UTF-8 JSON ends with a newline; gzip uses an empty
filename, timestamp zero and compression level nine.

Decompressed SHA-256:
`a694f7b7fe4b733906b5bc7b08b8113450ba9dae07b34b5d95a04e10e090cac5`.

Source decompressed SHA-256 values:

- Captured SRJ: `783738f1ce719d1aa83faa4a5dccd7ba22cc0ed77768b9e081ff9be568e8d7ac`.
- Preloaded Circuit JSON: `d0bf34fb6a4c1e93dae19d2e5d85b8c54e6ecbed6c879ea640ec628084804dc6`.

The solve stops after native trace graph preloading. The SVG shows actual input
copper and the measured count of graph assignments carrying the fixed policy.
It does not show a completed DQM0 route or claim complete DDR routing, DRC,
length matching, timing or signal-integrity qualification.

On the captured autorouter baseline, all 32 native traces are preloaded, but
none of their 1,836 graph assignments carries the fixed policy. Pipeline9 can
then treat these completed routes as movable during later routing and repair.
The snapshot records that missing policy without inventing topology nodes or
requiring a downstream routing failure.

Run from the repository root:

```sh
bun test tests/repro/pipeline9-stmp157-native-ddr-preloads.test.ts --timeout 9999999
```
