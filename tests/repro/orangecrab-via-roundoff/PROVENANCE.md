# OrangeCrab DDR via-coordinate regression

This TSX fixture routes the native OrangeCrab rev 0.2.1 ECP5/DDR3 subsystem
through `tscircuit@0.0.3060` / core `0.0.2257`, using this checkout's Pipeline 9
for the final phase. Both data bytes still use core's published bus-lanes router.
It retains all 385 pads on U3, U4, R5 and R13 and requests all 50 extracted DDR
signal nets. Power, VREF, ZQ, unrelated board circuitry and timing qualification
remain outside this reproduction.

Source: [OrangeCrab.kicad_pcb](https://github.com/orangecrab-fpga/orangecrab-hardware/blob/c511d569fe2af39467041f888bc231020f40c6ac/hardware/orangecrab_r0.2.1/OrangeCrab.kicad_pcb).
PCB SHA-256: `4597f3ac08e21c09253b27ca1b9e26aaf3c3d3e2147b6c0d79c0dc6aa555e201`.
The captured geometry comes from
[`dataset-srj36-real-ddr`](https://github.com/ShiboSoftwareDev/dataset-srj36-real-ddr),
reconstructed as native components and pads before core generates routing input.
The hardware is licensed under CERN-OHL-1.2; see `LICENSE.hardware.txt`.

The fixture preserves the native placement, pad geometry, six copper layers,
trace widths, 0.089 mm clearance and 0.28/0.15 mm vias. Via-in-pad remains
forbidden. Routing order stays byte 0, byte 1, then the remaining DDR signals.

RAM_A6 contains a tiny planar segment ending at an exact via site. Layer repair
and regional splicing removed its last wire point using approximate equality,
leaving the layer transition about 1e-14 mm apart. The strict physical via guard
then aborted the phase, and core published no copper.

The regression requires all 50 source nets to connect through final PCB copper
without moving either completed data byte. It also records the remaining
physical limitations: 32 findings, including four via-in-pad findings. Routing
completion does not imply a DRC-clean or manufacturing-ready DDR interface.

Run `bun tests/repro/orangecrab-via-roundoff/render.tsx` from the repository root.
The renderer emits Circuit JSON, its SVG, captured byte routes and independent
physical findings as JSON. The test snapshots that actual core-rendered SVG.
The snapshot omits error overlays; the assertions retain the physical findings.
