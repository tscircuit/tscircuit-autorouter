# RP2350 complete-board Pipeline9 DRC repro

This repro comes from the normal, successfully completed route of
`@tsci/abse.rp2350-mcu-board` version `0.0.6`. It does not use the later
experimental V3V3-only routing phase.

The route was generated with `tscircuit` `0.0.2460` and
`@tscircuit/capacity-autorouter` `0.0.845`. Its three routing phases completed:

- MCU fanout: 61 connections in 17.262 seconds
- remaining MCU core: 22 connections in 588.350 seconds
- parent board: 62 connections in 56.272 seconds

The completed board contains 232 routed traces, no autorouter errors, and no
jumpers. Downstream board checks report 13 DRC errors:

- 3 `pcb_trace_error`
- 2 `pcb_pad_trace_clearance_error`
- 4 `pcb_via_trace_clearance_error`
- 4 `pcb_pad_pad_clearance_error`

The Gerber short checker also reports one short, corresponding to accidental
contact between the V3V3 C15/C18 route and a GPIO10 breakout via.

`rp2350-normal-core-phase.srj.json` is the real second-phase Pipeline9 input:
22 connections, 123 obstacles, 61 preloaded fanout traces, and four layers.
The adjacent Cosmos fixture opens it in the interactive Pipeline9 debugger.

`rp2350-completed-board.circuit.json` preserves the complete routed board and
its 13 generated DRC diagnostics. The active test verifies that exact error
breakdown. The skipped routing test records the desired solver outcome for the
normal core phase; enable it while improving this case because the captured
route takes about ten minutes.
