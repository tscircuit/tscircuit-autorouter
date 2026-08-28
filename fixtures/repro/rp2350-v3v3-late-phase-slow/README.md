# RP2350 V3V3 late-phase Pipeline9 repro

This is the standalone SimpleRouteJson input for routing the RP2350 board's
`V3V3` net after its 61 BGA fanout traces have already been routed.

It was captured from `@tsci/abse.rp2350-mcu-board` version `0.0.6` using
`tscircuit` `0.0.2460` and `@tscircuit/capacity-autorouter` `0.0.845`.

Observed behavior in the published package:

- input: 1 connection, 123 obstacles, 61 preloaded traces, 4 layers
- Pipeline9 reaches `highDensityRouteSolver`
- progress remains at 0%
- the phase times out after 60.3 seconds and 147 solver steps

A bounded check against upstream `main` at version `0.0.855` also remained in
`highDensityRouteSolver` at 0% after 15 seconds, unsolved and without an error.

Expected behavior: Pipeline9 routes the single power-net connection in a
bounded amount of time without changing the 61 preloaded fanout traces.

The skipped test records the desired outcome. Unskip it while working on the
solver performance issue. The adjacent Cosmos fixture provides an interactive
debugger for the captured input.
