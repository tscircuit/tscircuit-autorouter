# OrangeCrab complete native remaining-phase input

`orangecrab-native-remaining.srj.json.gz` contains the complete remaining routing
phase derived from the real OrangeCrab rev 0.2.1 circuit. Its board source is
[`OrangeCrab.kicad_pcb` at c511d569](https://github.com/orangecrab-fpga/orangecrab-hardware/blob/c511d569fe2af39467041f888bc231020f40c6ac/hardware/orangecrab_r0.2.1/OrangeCrab.kicad_pcb),
licensed CERN-OHL-1.2. The extracted source circuit is retained in
[`source-data.json`](../../repro/orangecrab-via-roundoff/source-data.json).

This is the complete evaluated DDR subsystem, not every signal on the original
hardware board. The source has 50 DDR connections. Two completed eight-signal DQ bus phases
provide the 16 prior native traces. This fixture retains all 34 remaining
connections, 385 original pad/hole obstacles, six layers, original terminal
identities, bounds, widths and rules, including the 0.089 mm declared clearance.
It has no `defaultObstacleMargin` override.

This is a source-derived native handoff replay, not a fresh Core render. The
captured Core remaining-phase input rasterized prior copper into obstacles.
Native handoff preparation used the companion Core change
[`core#5190`](https://github.com/tscircuit/core/pull/5190):

1. Restore each completed bus trace's physical terminal ownership using
   `getBusLanesTracesWithPhysicalConnections`, retaining every route coordinate.
2. Keep the original 385 obstacle objects and mark the 16 completed traces
   `isFixed: true`, replacing the 939 rectangles generated from that copper.
3. Verify that replaying `withFixedTraces` reproduces the captured rasterized
   remaining-phase input exactly, with zero numerical tolerance. All connection
   lists, rules, bounds, keepouts and holes remain unchanged.

The companion Core runtime is needed for a fresh end-to-end native capture. The
test instead replays these exact preserved native input bytes through the
normal `AutoroutingPipelineSolver9_PreloadedTraceGraph(input)` constructor with
one argument. It supplies no regional input, clearance, effort, routing strategy
or fallback override. It steps naturally until the B01 child for
`topology_merge_7827` completes or fails, retains that actual child and snapshots
its native `visualize()` output without drawing or filtering additional shapes.

This is a regional B01 stage snapshot from the complete input, taken before
regional fallback routing executes. Fallback remains enabled. The snapshot does
not show the full phase outcome or a completed circuit. Separate complete-phase
runs found that the before revision's fallback generates UDQS but its candidate
is rejected for fixed-copper conflicts; the fix accepts 15 B01 pieces here and
then fails at a later region.

SHA-256 checksums:

| Artifact | SHA-256 |
| --- | --- |
| Decompressed native fixture | `bd6eee9e2c4127e103e318d0e3187405daf54d832eb46b42a4e3a5534221f516` |
| Extracted source circuit | `4d07675f1fef41b23d703dab467681b716a32f0400c5a0c9171be39b4c6ccdb2` |
| Captured raster remaining input | `cb945eab780cd3c61d54dcf74d7fcfe74fc3ae805b9140d20d0daf20661d547b` |
| Physical ownership helper source | `42ac0fbd6123eb66743b5fd18374f9b653c9514de61f6dcceecab66a66780d69` |
| Rasterizer helper source | `c9741ab993334f74d8cedefc616b0f3acb6b3babdcfcfb330f958a9f67fe555a` |

Regenerate the native stage SVG:

```sh
BUN_UPDATE_SNAPSHOTS=1 bun test tests/repro/pipeline9-orangecrab-native-clearance.test.ts --timeout 9999999
```
