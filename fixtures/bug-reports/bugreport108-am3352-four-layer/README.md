# AM3352 four-layer board

Open `bug-reports/bugreport108-am3352-four-layer` in React Cosmos (`bun run start`)
to inspect and route the board with the standard autorouting pipeline debugger.
All 138 connections are submitted together; there are no routing phases.

The input comes from the four-layer, no-via-in-pad
[AM3352 board v0.1.5](https://tscircuit.com/seveibar/am3352-dev-board-4layer-dogbone),
with source at [commit e3d915e](https://github.com/tscircuit/am3352-dev-board/tree/e3d915e3df52023763f1ea85ebe4c20401b52790).
The compiled circuit JSON SHA-256 is
`b10e79416833f007032dec15b583d94cab49ce88abab25395065dba4cdea0c54`.

The SRJ preserves the 70 × 60 mm board bounds, four layers, 774 terminals,
907 obstacles, connection names, port selectors, and six bus skew constraints.
Via-in-pad and blind/buried vias are disabled. Minimum via pad/hole diameters
are 0.3/0.15 mm.

Saved traces, vias, copper pours, trace hints, breakout points, and routing-phase
settings are removed before conversion. This deliberately removes preconnected
copper and saved fanout escapes. Ground and power are ordinary connections;
all four layers are available to the router, including the original ground-plane
layer. This fixture is a routing workload, not an electrically qualified layout.
The bus constraints preserve length skew, but do not encode differential-pair
polarity, coupled spacing, or impedance requirements.

## Regeneration

Build the source board and pass its compiled circuit JSON and installed core
module to the converter. The checked-in input was generated using
`@tscircuit/core@0.0.1956` (from `tscircuit@0.0.2615`). The autorouter repository's
older core dev dependency does not support all of these SRJ fields.

```sh
bun fixtures/bug-reports/bugreport108-am3352-four-layer/convert-circuit-json.ts \
  /path/to/board/dist/index/circuit.json \
  /path/to/board/node_modules/@tscircuit/core/dist/index.js \
  fixtures/bug-reports/bugreport108-am3352-four-layer/am3352-four-layer.srj.json

bun test tests/fixtures/am3352-four-layer.test.ts --timeout 9999999
```

The converter reconstructs bus membership from `source_bus` records because the
core converter exports buses from live components rather than static circuit JSON.
The fixture-integrity test checks completeness and absence of saved routing.

## Full solve and failure snapshot

A fresh Pipeline 9 solve with caching disabled terminates unsuccessfully after
about 187 seconds locally. `highDensityRouteSolver` cannot solve
`topology_merge_3012`, even after growing the region to 8x; the regular and regional
routing attempts both fail. This is a solver failure, not a test timeout.

The full-solve regression test asserts this known failure and snapshots the failed
high-density stage, with an explicit incomplete-routing label. It will need to be
changed to assert success and snapshot the final board when the solver is fixed.

```sh
bun test tests/bugs/bugreport108-am3352-four-layer.test.ts --timeout 9999999

# Regenerate only this snapshot:
BUN_UPDATE_SNAPSHOTS=1 bun test tests/bugs/bugreport108-am3352-four-layer.test.ts --timeout 9999999
```
