# H3 DDR disconnected planner input

Unchanged remaining-phase SRJ from the real H3 CPU + DDR3 TSX/core run with
`tscircuit@0.0.3099`, `@tscircuit/core@0.0.2280`,
`@tscircuit/capacity-autorouter@0.0.1044` and bus-lanes-solver `0.0.45`.
The preceding two data-byte phases connect all 16 DQ signals. This input has
37 remaining signals, all 445 native pad primitives, and the fixed data copper
represented by core's normal obstacle projection. It has no preloaded SRJ traces.

[Native layout](https://github.com/hvwyl/allwinner-h3-ddr3-16x1-kicad/blob/02e365b21363a17710e0f96072c0844940495567/project/allwinner-h3.kicad_pcb),
revision `02e365b21363a17710e0f96072c0844940495567`.
[TSX board](https://github.com/tscircuit/bus-lanes-solver/blob/e41da8866af38bb7c710064d34f6988dc3385bf9/repros/preloaded-ddr/circuits/h3.tsx).
The pad geometry, two signal layers, 0.1143 mm trace width, 0.0889 mm clearance,
0.45 mm via diameter, and no-via-in-pad rule are unchanged.

Decompressed SHA-256:
`7f7ea2a9cdcc579ad4c1b44392c9e2ba4a40a4af83d489112a6d757cb73268a2`.

The graph has no legal path for DQS1P, DQS1N, DQM1 and A15. The default 16-hop
reachability check misses them and the planner exhausts two million iterations.
The SVG shows the real routing input and measured planner counters. An earlier,
named failure improves diagnosis and avoids wasted search; it does not add copper,
complete the full 53-signal board, or qualify DDR timing.
