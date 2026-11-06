# H3 DQS1+ escape beside routed data

Native DDR geometry from [hvwyl/allwinner-h3-ddr3-16x1-kicad](https://github.com/hvwyl/allwinner-h3-ddr3-16x1-kicad/blob/02e365b21363a17710e0f96072c0844940495567/project/allwinner-h3.kicad_pcb).
`source.json` retains all 445 pads of DU1, DU2 and R1, their placements,
pin aliases and all 53 source traces. R1 is on the bottom layer.

The TSX requests 16 DQ signals in two bus-lane phases, followed by DQS1+.
It keeps two layers, 0.1143 mm traces, 0.0889 mm clearance,
0.45/0.20 mm vias and no via-in-pad. It does not qualify DDR timing.

On autorouter 0.0.1051, the DQ phases produce sixteen clean routes, but
DQS1+ fails path planning. Core buffers phase results, so the final circuit
has 0/17 accepted signals. `board.snap.svg` shows that native Core result.
The root SVG test retains the sixteen routed DQ traces to show the blocked
DQS1+ escape alongside the actual earlier copper.

To regenerate the native board with this checkout's Pipeline9:

```sh
cd tests/repro/h3-ddr-strobe-via-access
bun install
bun run render
```

The standalone runtime is pinned to tscircuit 0.0.3110. Only the final
`auto_local` phase uses the checkout's solver; the DQ bus phases use the
published runtime. `result.json` records actual connectivity and nine physical
checks. Generated compressed SRJs can be compared with the canonical inputs
in `fixtures/features/h3-ddr-strobe-via-access`.

From the repository root, regenerate the routing SVG with:

```sh
BUN_UPDATE_SNAPSHOTS=1 bun test --timeout 9999999 tests/repro/pipeline9-h3-ddr-strobe-via-access.test.ts
```

The fixtures are Core's captured final-phase request (one connection and
1,957 obstacles, including earlier copper), plus its sixteen prior DQ routes
and original pads. The snapshot uses the board's 0.0889 mm clearances.
The same test and TSX run unchanged on the stacked fix.
