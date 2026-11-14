# Glider DDR width-stage capture

Hardware: Modos Labs Glider mainboard, Spartan-6 `XC6SLX-FTG256` (`U1`)
and `MT41K64M16TW` DDR3 (`U12`). The source is
[`pcb/mainboard/pcb.kicad_pcb` at ed94ef7f](https://github.com/Modos-Labs/Glider/blob/ed94ef7fd95a42cfdcdaf5e5da1dcdd709122763/pcb/mainboard/pcb.kicad_pcb).
The hardware is licensed CERN-OHL-S-2.0; its license is included alongside this file.

The source-derived TSX experiment retains all pads of the controller, RAM and
four DDR resistors, their placements, four copper layers, and 49 selected DDR
signals. Existing source copper is removed for autorouting. Signal widths are
the source board's manufactured 0.11/0.127 mm widths; clearance is 0.11 mm and
vias are 0.45 mm copper with 0.30 mm drills. Timing is not qualified.

`width-input.json.gz` captures the complete remaining-phase width stage using
`tscircuit@0.0.3169`, Core `0.0.2359` and autorouter `0.0.1086`.
Two completed byte phases supply 16 data signals. The remaining phase contains
37 point-paired routes, including branches, and 1,057 obstacles. No pads, routes,
widths, clearance rules, layers or earlier copper were removed for this repro.
It retains the phase SRJ, point-paired SRJ and `TraceWidthSolver` inputs.
Replaying the capture reproduces the original width-stage output exactly.

The SVG is the production width solver's complete native visualization, before
downstream cleanup. Green means requested width; orange means board minimum.
Red rectangles show obstacle bounds, including round pads' bounding boxes.
The full Core render is checked separately for final connectivity and clearance.

Before the fix, four routes (`source_trace_0`, `source_trace_7`,
`source_trace_45`, `source_trace_48`) unnecessarily narrow from 0.127 to 0.11 mm.
Their paths fit the actual round copper and the unchanged clearance.

SHA-256 of the decompressed capture:
`f1309e258362b735c2b95edbf88842fa811a3e24c20b47a64255d3cfebcee45d`.
SHA-256 of the source KiCad PCB:
`aea9094b681b96d6548beff89ca7a6c10484c7a95a29a6819fa34010b17513d3`.

Run `bun test tests/repro/glider-ddr-round-pad-width.test.ts --timeout 9999999`.
