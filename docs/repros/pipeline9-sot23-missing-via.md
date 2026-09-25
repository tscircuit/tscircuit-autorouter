# SOT-23 breakout loses a via during global routing

This reproduction comes from `tscircuit/core` PR #4121, where upgrading the autorouter from 0.0.919 to 0.0.928 breaks `breakout-sot23-regulator-power-rail.test.tsx`. The board contains a SOT-23 regulator, two decoupling capacitors, input/output headers, and a resistor. The JSON captures the global routing input after the breakout phase has produced seven valid traces.

The affected preserved trace connects `pcb_breakout_point_2` to `pcb_port_0`. Its input is entirely on the top layer. Pipeline 9 repairs this trace onto the bottom layer, but the emitted route contains consecutive top and bottom wire points near (0.200, 3.080) mm without a via. A later bottom-to-top transition still has its via. Length-matching post-processing rejects the malformed route with `changes layer without a transition`; core receives no completed routes.

The snapshot shows the valid input beside the preserved copper at failure. The red circle identifies the missing transition. Solid red copper is on top; dashed blue copper is on the bottom. This first PR intentionally asserts the known failure so the reproduction can be reviewed independently. The stacked fix will replace those assertions with successful routing and explicit transition checks.

Run on Linux:

```sh
bun test tests/repro/pipeline9-sot23-missing-via.test.ts --timeout 9999999
```
