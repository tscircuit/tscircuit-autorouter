# H3 bank address beside routed data

Native geometry comes from [hvwyl/allwinner-h3-ddr3-16x1-kicad](https://github.com/hvwyl/allwinner-h3-ddr3-16x1-kicad/blob/02e365b21363a17710e0f96072c0844940495567/project/allwinner-h3.kicad_pcb).
The TSX reuses the adjacent H3 fixture's source data: all 445 pads of U1,
DU1 and R1, native placements, pin aliases and all 53 source traces.
R1 is on the bottom layer.

The requested section routes sixteen DQ signals in two bus-lane phases,
then BA1. It retains two layers, 0.1143 mm traces, 0.0889 mm clearance,
0.45/0.20 mm vias and no via-in-pad. DDR timing is not qualified.

The baseline connects 17/17 signals but leaves two physical findings:
one via-to-trace clearance error and one via-to-pad clearance error.
`board.snap.svg` is generated from Core's actual Circuit JSON.

To regenerate the native board using this checkout's Pipeline9:

```sh
cd tests/repro/h3-ddr-bank-address
bun install
bun run render
```

The standalone runtime is pinned to tscircuit 0.0.3122. The DQ phases use
its published bus-lanes solver; only the final phase uses this checkout.
`result.json` records connectivity, native pad count and nine physical checks.
The renderer also captures compressed SRJs for the root SVG test:

```sh
BUN_UPDATE_SNAPSHOTS=1 bun test --timeout 9999999 tests/repro/pipeline9-h3-ddr-bank-address.test.ts
```

The test uses the captured final-phase request and the actual preceding DQ
copper. Its SVG includes the board's physical DRC findings. The same TSX,
input and test run unchanged on the stacked fix.
