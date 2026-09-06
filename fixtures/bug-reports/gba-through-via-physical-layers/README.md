# GBA physical through-via layers

This is the complete, unedited routing input from the local Game Boy Advance
storage-board experiment. It includes the RP2350, flash, PSRAM, SD connector,
power, audio, buttons, and peripheral connections. It is not a hand-drawn route
or a cropped, synthetic obstacle problem.

## Input provenance

- Captured file: `gameboy-advance/dist/storage-top-spread-v2-debug/phase-0.input.simple-route.json`.
- Capture file timestamp: `2026-09-05T17:04:19.077Z`.
- The later `storage-top-spread-v2-true-effort5-debug` capture is byte-identical.
- SHA-256: `aa8aae92f1f829a02d808d7590cf276882619dfa90693eb7c18094a060a7ac6b`.
- Size: 1,536,018 bytes; 145 connections; 411 obstacles; four layers.
- No preloaded traces: this captures the complete global routing problem, not
  child-before-parent scheduling.
- `allowBlindAndBuriedVias: false`, via diameter 0.45 mm, hole 0.2 mm,
  via-to-pad copper-edge clearance 0.1 mm.
- Capturing project: tscircuit 0.0.2463, Core 0.0.1837, autorouter 0.0.866.
- Repro prepared against autorouter main
  `fb6c6d77c091a56c9e1d4648bbac40a7cccd0def` (0.0.885).

No input coordinates, obstacles, connections, identities, widths, layer rules,
or routing hints are changed. No precomputed routed output is injected. The
test constructs Pipeline 9 from repository source and reroutes the full input.

## Observed issue and scope

In the saved board output, the QSPI_SD0 via at approximately
`(-1.0878428, -0.7796887)` logically changes from bottom to inner2. Its 0.45 mm
copper pad overlaps the top-layer U1 GND exposed pad by about 0.04518 mm.
Core correctly materializes it on all four physical layers because blind and
buried vias are disabled. The GND obstacle already has the correct position,
dimensions, and distinct-net identity in the input.

Autorouter 0.0.885's bundled repair03 expands the logical from/to layer span,
but that still excludes top for a bottom-to-inner2 transition. Its repair
movement code and Pipeline 9 regional copper model similarly use logical
layers rather than the physical through-via span. A top-pad collision can
therefore escape those checks. This is distinct from the recently fixed
endpoint-only-versus-inclusive-span issue.

The test uses the repository's Circuit JSON conversion and
`@tscircuit/checks.checkViaPadClearance` oracle. It first checks the logical-span
view, then changes only each converted via's occupied layers to all board layers,
matching Core's physical through-hole construction. No trace coordinates, via
coordinates, widths, diameters, pads, or nets are changed. It reports both views
and asserts that no additional foreign-pad violations exist in the physical
view. It does not claim
that every other GBA DRC has this cause, or identify the stage that first created
the collision without evidence from a fresh run.

## Remote CI and artifacts

The dedicated `GBA Through-Via Repro` PR workflow runs:

```sh
RUN_GBA_THROUGH_VIA_REPRO=1 bun test tests/bugs/gba-through-via-physical-layers.test.ts --timeout 3600000
```

Normal short test shards skip this expensive full-board solve. The dedicated
job uses `ubuntu-latest`; no local routing or tests are required. Routing must
complete in `beforeAll`; crashes/timeouts do not satisfy the expected-failure
assertion. Once the blind spot is fixed and this board clears those pads,
`test.failing` will report an unexpected pass and can become a normal test.

The uploaded artifact contains the actual final `routed-traces.json`,
`routed.svg`, `physical-circuit.json`, `physical-via-pad-report.json`, run status, and
`PipelineStageDebugRunner` stage PNG/SVG/GraphicsObject JSON files and logs.
No snapshots are invented or manually altered. Stage graphics are diagnostic
outputs; this repro does not change any solver visualization code.
