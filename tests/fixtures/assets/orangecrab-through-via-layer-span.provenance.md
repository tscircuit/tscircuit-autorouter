Captured from the OrangeCrab rev 0.2.1 ECP5 / MT41K64M16 DDR3 subsystem.
The board uses six copper layers and prohibits blind/buried vias and via-in-pad.
A signal transition between inner layers therefore still drills through all six layers.

Original board: [orangecrab-hardware, c511d56](https://github.com/orangecrab-fpga/orangecrab-hardware/blob/c511d569fe2af39467041f888bc231020f40c6ac/hardware/orangecrab_r0.2.1/OrangeCrab.kicad_pcb).
This derived fixture retains the source design's CERN-OHL-1.2 license.
Original KiCad board SHA-256: `4597f3ac08e21c09253b27ca1b9e26aaf3c3d3e2147b6c0d79c0dc6aa555e201`.

The [native-net TSX importer and board assets](https://github.com/ShiboSoftwareDev/core-ddr-benchmark/tree/5a2cfa2382097432214ef567a3e1e97144b33f71/circuits)
were rendered with published `tscircuit@0.0.3183`, Core `0.0.2374`, and
capacity-autorouter `0.0.1094`. Pads, placements, terminals and design rules are
unchanged. The two data-byte phases run before the remaining signals.

`inputSrj` is the exact remaining-phase input. Its uncompressed SHA-256 is
`513b027bc5668a377b0e67266080123d1b6ce3a2188005dbafaac6b0458483ea`.
`preloadedConnections` and `preloadedTraces` retain the preceding byte phases for
full-board drawing and DRC; they do not modify the routing input.

Both published autorouter 1087 and 1094 receive this identical input. Version
1087 has zero physical findings; 1094 has 58 physical findings, including three
via holes in pads. The existing relaxed-DRC SVG helper reports 64 errors using
its benchmark checks. DDR timing and impedance are unqualified.
