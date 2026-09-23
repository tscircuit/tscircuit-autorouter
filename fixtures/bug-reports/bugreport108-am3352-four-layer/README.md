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

## Full solve and snapshot

This board exercises three routing bottlenecks:

- Crowded high-density nodes need a growth budget based on terminal spacing as
  well as via diameter. The original failure was `topology_merge_3012`.
- Dense grid routes contain thousands of redundant collinear points. Removing
  those points before force improvement preserves copper geometry while reducing
  segment-pair work.
- Shared vias must move with every attached route. Moving only some branches can
  make the via merger oscillate indefinitely between two occupied sites.

Small extracted regressions run in normal CI. The complete, uncached Pipeline 9
solve is opt-in because it takes about 21.5 minutes locally. It now passes routing,
stitching, simplification, and joint DRC repair, then fails in length matching:
`source_net_70` needs 5.1637 mm of added length and exhausts the matcher candidates.
The test asserts this specific remaining failure and snapshots repaired routing
with a failure header and the benchmark's relaxed-DRC count.

The captured repaired output contains 637 traces and 3,413 relaxed-DRC errors:
1,874 trace errors, 1,008 via/trace clearance errors, 314 pad/trace clearance
errors, and 217 via clearance errors. No length constraints were removed.
An isolated experiment with 0.1 mm meander spacing still failed (66 candidates).
This output is not suitable for fabrication; congestion must be addressed before
post-processing can produce clean, length-matched routing.

Before length matching, planar routed skew is 14.0323 mm for DDR_BYTE0 and
7.1412 mm for DDR_BYTE1 (both limited to 0.635 mm). DQS0, DQS1, and CK skew are
4.7384, 2.9099, and 3.1275 mm respectively (limited to 0.127 mm). These are
geometric route lengths, not electrical delay measurements.

```sh
RUN_AM3352_FULL_SOLVE=1 bun test tests/bugs/bugreport108-am3352-four-layer.test.ts --timeout 9999999

# Regenerate only this snapshot:
RUN_AM3352_FULL_SOLVE=1 BUN_UPDATE_SNAPSHOTS=1 bun test tests/bugs/bugreport108-am3352-four-layer.test.ts --timeout 9999999
```
