# Native A64 DDR remaining-signal handoff

This is the unmodified `remaining` phase input emitted by the real A64 TSX
circuit through published `tscircuit@0.0.3155`, Core 0.0.2339 and autorouter
0.0.1076. The preceding four bus phases complete all 32 DQ signals.
The frozen input retains all 43 remaining logical connections, all six native
layers, native placement/pad geometry and the original routing rules. It also
retains Core’s existing copper obstacle representation; the repro does not
change the handoff or simplify the board.

The TSX source is pinned in
[core-ddr-benchmark](https://github.com/ShiboSoftwareDev/core-ddr-benchmark/tree/8ad0e1e2cc4c7069ce8d52e4a7d7e0ccc1cfb67c/circuits).
The manufacturer board is OLIMEX A64-OLinuXino revision H, copyright OLIMEX Ltd.,
licensed CC-BY-SA-3.0-US. The native KiCad board is pinned to
[OLIMEX/OLINUXINO b48543c](https://github.com/OLIMEX/OLINUXINO/blob/b48543c9674439c97a5bfa2024830f22a94d7a35/HARDWARE/A64-OLinuXino/1.%20Latest%20hardware%20revision/A64-OLinuXino%20hardware%20revision%20H/A64-OlinuXino_Rev_H.kicad_pcb).

Decompressed SRJ SHA-256:
`7481413e7c236f7954e71fadcee679f6904f27557e68413bd0a96a4a5cc596d6`.

The test completes graph preparation only: 125,920 capacity nodes and 347,143
ordered edges. Its hash freezes edge IDs and order as well as connectivity.
The SVG shows actual top-layer mesh nodes and edges around a CPU escape area;
only the drawing is cropped. This performance repro does not claim the
remaining DDR signals route successfully, pass physical DRC or meet timing.
The full published run exhausts its port-point planning iteration budget.
