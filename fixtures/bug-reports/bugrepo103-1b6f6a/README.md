# bugrepo103-1b6f6a: voltage-divider routing around R2

Repro input for the reported angled pad entries/exits around R2. The saved benchmark PCB render matches the supplied screenshots: J1/J2 at x = -12/12, R1 at (-4, 3), R2 at (4, -2), TP1 at (2, 4), and TP2 at (2, -5). This fixture records the routing case; it does not assert that the trace shape is an electrical DRC violation.

## Source

Benchmark artifact (relative to the supplied pcb-generation-benchmark directory):

`data/runs/2026-09-05-codegen-pilot-01/voltage-divider/tscircuit-codegen/replicate-1/artifacts/attempt-03`

- `bugrepo103-1b6f6a.circuit.tsx`: unchanged original TSX (benchmark dependency: tscircuit 0.0.2462).
- `bugrepo103-1b6f6a.routed.circuit.json`: unchanged saved output, preserving the reported routing for comparison.
- `bugrepo103-1b6f6a.srj.json`: fresh routing input extracted from that saved output using @tscircuit/core 0.0.1837.
- `bugrepo103-1b6f6a.fixture.tsx`: interactive autorouting pipeline debugger.

## SRJ extraction

Applied core's `unrouteCircuitJson` to remove generated PCB traces/errors, then removed generated `pcb_via` elements (this board has no source-defined vias). Passed the result to `getSimpleRouteJsonFromCircuitJson` with `minTraceWidth`, `nominalTraceWidth`, `minTraceToPadEdgeClearance`, `minPadEdgeToPadEdgeClearance`, and `minBoardEdgeClearance` all set to 0.25 mm, matching the TSX. Pads, holes, connectivity, and the 30 × 20 mm two-layer board are preserved.

The suffix is the first six characters of SHA-256 over the committed SRJ file bytes. Number 103 follows the existing highest report number (102); the prefix uses the requested `bugrepoNN-hash` spelling.

## Open the repro

Run `bun run start` from the repository root and select `bug-reports/bugrepo103-1b6f6a` in Cosmos. Use the pipeline selector to compare routing stages and final output around R2. The saved routed circuit JSON preserves the original result independently of changes to the current solver.
