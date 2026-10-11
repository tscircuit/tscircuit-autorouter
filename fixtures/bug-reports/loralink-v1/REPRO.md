# Full LoRaLink V1 reproduction

This is the actual 60 × 35 mm, four-layer LoRaLink board: 52 components,
29 nets, seven saved part definitions, four schematic sheets, two MCU USB
links, the named `02-signals-power-and-ground` routing phase, and ground pours.
`index.circuit.tsx` and every file in `imports/` are copies, with only formatting changes, of the
board that exposed the bug.

## Run

From the autorouter repository root on the repro or fix branch:

```sh
bun install
bun run build
bun pm pack --filename loralink-autorouter.tgz --quiet
cd fixtures/bug-reports/loralink-v1
bun install
bun test loralink-v1.test.tsx --timeout 9999999
bun run shorts
```

The fixture-only package override installs the built repository tarball into
core's normal dependency graph. The test verifies the loaded autorouter bundle
against the repository's built bundle before rendering. This is necessary
because `tscircuit@0.0.2815` requests `^0.0.965`, which excludes `0.0.969`.
If reinstalling after rebuilding on another branch, remove the fixture's
`node_modules/@tscircuit/capacity-autorouter` directory before `bun install`.

The real saved footprints are used with the board's original
`partsEngineDisabled` setting. Core performs the routing and copper pours.
The test saves native Circuit JSON, the routing phase input, and DRC records in
`dist/`, and checks a full PCB SVG snapshot. Error labels are omitted from the
image for readability; the DRC records and numeric assertions retain them.
The snapshot uses the repository's `getBugReportSnapshotSvg` helper,
with the native solver drawing and its `Relaxed DRC errors` badge. Core's public
`solver:started` event supplies the exact routing input and options for replay.
The test verifies every replayed trace against the actual rendered board,
accounting for core's reversal of source-port traversal direction.
The evaluator receives the actual finalized copper-pour elements from the same
native rendering, including their cutouts and islands. No errors are filtered,
and no clearance or continuity checks are disabled. The native Gerber checker
also runs on all four copper layers.

## Before and after

| Measurement | Repro | Fix |
| --- | ---: | ---: |
| Components / nets | 52 / 29 | 52 / 29 |
| Traces / vias / pour polygons | 121 / 113 / 7 | 121 / 113–114 / 4 |
| Emitted DRC errors | 8–9 | 10 |
| Additional via-pad violations at the configured 0.25 mm clearance | 2 | 0 |
| Verified strict board violations | 10–11 | 10 |
| Gerber shorts | 4–5 | 0 |
| Relaxed DRC errors in the SVG, with the actual pours | 1 | 0 |

Shorts are included in the verified violations and must not be added again.
The explicit via-pad audit uses the board's configured clearance because the
current default checker reads a different clearance field.
The original relaxed violation is VBUS's 0.117721 mm gap to a USB non-plated
hole, below the required 0.2 mm. The fix clears that violation.
The previous 32/42 counts omitted the finalized pours and reported missing
GND connections. Both branches now evaluate the actual poured board under the
same default relaxed rules. Ten stricter board violations still require work
before fabrication.

Linux and macOS can choose different valid route variants. Via count is an
optimization metric: the fix may use fewer than 114 drills. The fix requires
exactly zero shorts and zero relaxed DRC errors on both platforms. The repro
requires at least four shorts; every measured count is logged.

The single committed SVG is the native Linux CI rendering. Non-Linux routing
can produce a visually different valid route; the same numeric DRC, shorts and
trace-parity checks still run unchanged. No separate platform SVG is added.
