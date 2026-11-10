# Real MIDI keyboard terminal taper

The regression reuses the complete captured MIDI keyboard routing phase in
[`../bug-reports/usb-dp-phase-detour/input.json`](../bug-reports/usb-dp-phase-detour/input.json),
also exercised by `tests/bugs/usb-dp-phase-detour.test.ts`. Its file SHA-256 is
`78966edc3a39e56ee1253022012c5da28b8dae0a7921d5d3ffde4382c9ebe5af`.
The original capture was added in
[#2923](https://github.com/tscircuit/tscircuit-autorouter/pull/2923), commit
`bec03cfcf812d7d971cae89576e67a74f04a27f9`.

All 59 connections, 1,112 obstacles, 21 existing USB traces, placements, two
copper layers, and original rules are passed unchanged to Pipeline 9 at effort
1 without a cache. No pad geometry, endpoints, widths, clearance, or via policy
is replaced. This circuit's board minimum is 0.15 mm.

The test routes the complete phase input through the live `traceWidthSolver`
stage. It exports that stage's actual routed traces and updated prior copper.
The full-board SVG retains the complete circuit; the second SVG crops only the
drawing around `pcb_port_9` and its real `source_net_7_mst2` escape to
`pcb_port_36`. Pad 9 is represented by ten original 0.1 mm-high rectangles.

Before the fix, choosing the narrowest rectangle as the terminal width limit
emits nine 0.1 mm wire points, including the point on the pad's exit edge. The
trace then continues to its next route point outside that pad. The fix clamps
the taper's limit to the board minimum; the emitted minimum becomes 0.15 mm and
the count below the minimum becomes zero. Both the trace geometry and the
computed SVG summary change. Counts and minimum widths are measured from the
exported routes, rather than hard-coded into the drawing.

This is a live routing-stage reproduction. Subsequent DRC repair and power
expansion are outside this snapshot's scope. The board is a MIDI keyboard; the
existing DDR fixtures are separate integration coverage for the shared solver.

Regenerate the SVGs on each branch:

```sh
BUN_UPDATE_SNAPSHOTS=1 bun test tests/repro/pipeline9-midi-keyboard-terminal-taper.test.ts --timeout 9999999
```

The repro branch stores the observed narrow traces. The stacked fix updates
those same SVGs and asserts that no emitted wire point is below the minimum.
