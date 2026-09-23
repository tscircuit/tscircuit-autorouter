# SOT-23 breakout loses a via during global routing

This reproduction comes from `tscircuit/core` PR #4121, where upgrading the autorouter from 0.0.919 to 0.0.928 breaks `breakout-sot23-regulator-power-rail.test.tsx`. The board contains a SOT-23 regulator, two decoupling capacitors, input/output headers, and a resistor. The JSON captures the global routing input after the breakout phase has produced seven valid traces.

The affected preserved trace connects `pcb_breakout_point_2` to `pcb_port_0`. Its input is entirely on the top layer. Pipeline 9 repairs this trace onto the bottom layer, but the emitted route contains consecutive top and bottom wire points near (0.200, 3.080) mm without a via. A later bottom-to-top transition still has its via. Length-matching post-processing rejects the malformed route with `changes layer without a transition`; core receives no completed routes.

The parent reproduction PR shows the valid input beside the preserved copper at failure, with a red circle identifying the missing transition. Solid red copper is on top; dashed blue copper is on the bottom. The fixed test replaces the failure assertion with successful routing and explicit transition checks; its updated snapshots are described below.

Run on Linux:

```sh
bun test tests/repro/pipeline9-sot23-missing-via.test.ts --timeout 9999999
```

## Corrected export

The second PR restores the missing via during HD-route serialization. The route itself explicitly changes layers at two pairs of coincident points, but the repair output's separate `vias` list contains only the second via. Pipeline 9's copper geometry already interprets coincident points on different layers as a via. The SRJ exporter now follows that same convention, preserving the first transition instead of emitting disconnected copper. Explicit through-obstacle transitions still use their existing conversion path.

The full-board regression now requires the solver to finish, both transitions in the affected trace to export vias, and the benchmark relaxed DRC check to report zero errors. The comparison snapshot marks the two transitions in green; the additional routed-board snapshot includes the computed DRC count. A small exporter regression shows the same two-transition path with its first via omitted from the separate list and checks both emitted vias and their drill/pad dimensions.
