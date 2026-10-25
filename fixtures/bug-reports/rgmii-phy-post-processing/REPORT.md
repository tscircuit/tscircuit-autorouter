# Real RGMII PHY board: ignored MDI post-processing failures

This is the authored 90 × 70 mm, four-layer DP83867IRPAP companion board with
the FPGA header, MagJack, power supplies, crystal, decoupling and mounting holes.
`board/` contains its TSX source and pinned tscircuit project configuration.

The original board SRJ contains 45 logical connections, 496 routing obstacles,
four MDI differential pairs and both six-signal RGMII buses. The original pair
limits are unchanged: 0.127 mm skew, 0.2 mm edge gap and 3 mm uncoupled length.

## Capture and scope

`board.srj.json.gz` is the original complete routing input. Pipeline9 at
`06498e9` reaches `lengthMatchingPostProcessingSolver` in about 47 seconds;
`stage-input.json.gz` is its exact constructor input, including 199 real route
fragments. `point-pairs.srj.json.gz` is the corresponding resolved SRJ.
`placement.circuit.json.gz` is the real placed board, including footprints and
silkscreen. All 226 named physical obstacles and all 196 connected port
coordinates match that placement; `provenance.json` records hashes.

The regression replays **all four MDI pairs** with every route, obstacle and
connection retained. It sets only `buses: []` to isolate MDI post-processing
from subsequent RGMII bus tuning. The stored complete input still includes
both buses. This is a board-derived stage regression, not a claim that the
complete board finished routing.

The original complete adapter remained unfinished after 183 seconds. Its
producer independently completes with five diagnostics: terminal layer
mismatches for MDI_A and MDI_D, no valid candidate for MDI_B and MDI_C, and
exhausted meander search for MDI_A. Before the reporting fix, the isolated MDI
adapter discards those diagnostics and exposes its candidate copper as output.

## Visual evidence

`tests/bugs/rgmii-phy-post-processing.test.ts` regenerates the actual producer
result and adapter status. Its snapshot shows the real board and copper,
human-readable pair names, original constraint values, every producer
diagnostic, the adapter error and whether routing output is available.

The stacked fix must report failure and reject `getOutput()`. The copper is
shown only as a rejected diagnostic candidate. Identical copper before and
after is expected: this change fixes reporting, not the routing geometry.
The separate four-pad integration test also checks parent Pipeline9 propagation.

```sh
BUN_UPDATE_SNAPSHOTS=1 bun test tests/bugs/rgmii-phy-post-processing.test.ts --timeout 9999999
```

The Cosmos fixture loads the same full-board checkpoint and explicitly replays
the MDI stage. Gzip keeps the original geometry compact; use `gzip -dc` to
inspect any saved JSON. This engineering board remains unrouted as a complete
design and is not ready for fabrication.
