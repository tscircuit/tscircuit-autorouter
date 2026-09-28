# SOT-23 breakout loses a via during global routing

This reproduction comes from `tscircuit/core` PR #4121, where upgrading the autorouter from 0.0.919 to 0.0.928 breaks `breakout-sot23-regulator-power-rail.test.tsx`. The board contains a SOT-23 regulator, two decoupling capacitors, input/output headers, and a resistor. The JSON captures the global routing input after the breakout phase has produced seven valid traces.

The affected preserved trace connects `pcb_breakout_point_2` to `pcb_port_0`. Its input is entirely on the top layer. Pipeline 9 repairs this trace onto the bottom layer, but the emitted route contains consecutive top and bottom wire points near (0.200, 3.080) mm without a via. A later bottom-to-top transition still has its via. Length-matching post-processing rejects the malformed route with `changes layer without a transition`; core receives no completed routes.

The parent reproduction PR shows the valid input beside the preserved copper at failure, with a red circle identifying the missing transition. Solid red copper is on top; dashed blue copper is on the bottom. The fixed test replaces the failure assertion with successful routing and explicit transition checks; its updated snapshots are described below.

Run on Linux:

```sh
bun test tests/repro/pipeline9-sot23-missing-via.test.ts --timeout 9999999
```

## Root cause and correction

`SameNetViaMergerSolver` moves a route's layer transition onto an existing same-net via in an immutable route. It correctly moves both path endpoints, but previously deleted the moved route's via entry when the destination was immutable. The route still crossed layers while its `vias` list no longer described that transition. Export then omitted the via and post-processing rejected the route.

The producer fix lives in `@tscircuit/trace-simplification-solver`: retain the destination coordinate in the moved route's via list and treat already-coincident vias as an already-completed merge. Fixed copper stays fixed, and every attached route continues to describe its layer transition. Physical-hole deduplication remains the job of the existing output consumers.

This PR updates the pinned dependency containing that fix. The exporter is unchanged. The full-board test requires successful routing, both vias on the affected trace, and zero relaxed DRC errors. The comparison snapshot marks both transitions in green, and the routed-board snapshot displays the computed DRC count.
