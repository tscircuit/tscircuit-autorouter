# AM3352 DDR layer-routing reproduction

`am3352-ddr-layer-routing.json.gz` captures the real reference board's native
Pipeline9 output immediately before length matching. It is not a synthetic BGA
or a hand-routed replacement. The test replays the layer-routing stage on this
checkpoint; it does not claim to solve the full board's DDR timing constraints.

Source board: [tscircuit/am3352-dev-board at e3d915e3df52023763f1ea85ebe4c20401b52790](https://github.com/tscircuit/am3352-dev-board/tree/e3d915e3df52023763f1ea85ebe4c20401b52790).
The four-layer DDR routing input preserves all 907 board obstacles, including
processor/RAM pads, decoupling capacitors, and peripheral connector pads. All 47
DDR connections, seven buses, and three differential pairs are retained. Only
DDR signals are routed in this fixture; USB and power copper are not part of
this regression.

The original uncached native run reached the checkpoint before subsequently
failing length matching. The checkpoint contains 48 routed fragments for 47
signals (one signal has three terminals). Twenty fragments use excluded inner1.

Fixture extraction:

1. Keep the original four-layer routing input as `srj`, without cropping or
   changing obstacles, connections, or constraints.
2. Convert each emitted trace to a high-density route: wire layers become Z
   indices; vias become coincident entry/exit vertices; remove only consecutive
   identical XYZ vertices. Preserve trace order and connection names. All source
   wires are 0.1 mm and source vias are 0.3 mm diameter.
3. Store `{ srj, routes }` as gzipped JSON. The test pins its uncompressed SHA256.

Source input SHA256:
`4517a554183c1ac21783ee8099cf039805328483bbb6c8a5de8c0592fb851bab`

Source pre-length-matching trace JSON SHA256:
`2f2e7fe0f90e41eef8f7157c4cd2df607fbaec9b2c3ae7d8a0f0979165f870a6`

Uncompressed fixture SHA256:
`77daaa08193bd3b6156fa6558ac4d9bda6237ce844e6556b3f3e708e289026c3`

Reproduce from the repository root:

```sh
bun test --timeout 9999999 tests/repro/pipeline9-am3352-ddr-bus-layers.test.ts
```

The regression checks all 47 source connections against emitted continuous
centerlines/vias, checks unchanged endpoints and input data, and independently
runs relaxed DRC. Before: 20 illegal-layer fragments, zero relaxed DRC errors,
47 connected signals. After: zero illegal-layer fragments, zero relaxed DRC
errors, 47 connected signals. These are layer/geometry checks, not DDR timing,
impedance, or manufacturing sign-off.

Two checked-in SVG snapshots show the repaired full-board geometry and DDR
escape region. They update the reproduction PR's same files for a direct image diff. Only drawing primitives are cropped for the close-up; routing and
DRC always use the full input. The plots show actual pads, emitted traces and vias
with the repository's layer styling. Through-via barrels may cross inner1;
entering, exiting, or routing a wire on inner1 is prohibited by these buses.
