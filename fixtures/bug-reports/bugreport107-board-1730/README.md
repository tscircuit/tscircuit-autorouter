# Board #1730 autorouting report

Input supplied as `_board#1730 __-autorouting.json`. Despite the original description as circuit JSON, this file is a SimpleRouteJson autorouter input.

The original file is preserved byte-for-byte in `public/fixtures/bugreport107-board-1730.srj.json`. It is fetched on demand, following the large-board fixture convention, to avoid bundling the 7.8 MB input into the debugger.

## Input

- Board bounds: 57 × 50 mm
- Copper layers: 4
- Obstacles: 1,072
- Connections: 32
- Existing traces: 553 (preserved)
- Blind/buried vias: disabled
- Minimum trace width: 0.095 mm
- Nominal trace width: 0.1524 mm
- Via pad/hole diameters: 0.3 / 0.15 mm
- SHA-256: `28fa97c426618f202c36561031810bfb38aadae1275d2750a5a7f4691f9cffc1`

## Reproduction

1. Run `bun install`, then `bun run start`.
2. Open `bug-reports/bugreport107-board-1730` in React Cosmos.
3. Select Pipeline9 explicitly (the debugger may remember a previous pipeline selection), leave the layer override on Auto, and run the solver.
4. Inspect the pipeline stages and DRC results. Record the selected effort and pipeline when reporting a failure.

Expected behavior: route the remaining connections while respecting the supplied existing copper, four-layer stack, and clearance constraints.

The submitted attachment contains routing input but no failure message, screenshot, pipeline version, or reported symptom. This PR captures the board for investigation; it does not assert a confirmed solver failure or add a speculative failing test.
