Captured from the real OLIMEX A64-OLinuXino rev H DDR subsystem using
`tscircuit@0.0.3183`, `@tscircuit/core@0.0.2374`, and
`@tscircuit/capacity-autorouter@0.0.1094`.

Native board: [OLIMEX/OLINUXINO, revision 85eee9c](https://github.com/OLIMEX/OLINUXINO/tree/85eee9c17ee13af65617d73bdd94de7ec49cfb42/HARDWARE/A64-OLinuXino).
Attribution: OLIMEX Ltd. This derived routing fixture retains
[CC-BY-SA-3.0-US](https://creativecommons.org/licenses/by-sa/3.0/us/).

The [TSX importer](https://github.com/ShiboSoftwareDev/core-ddr-benchmark/blob/5a2cfa2382097432214ef567a3e1e97144b33f71/circuits/native-ddr-board.tsx)
uses unordered native net membership. The
[native placements, pads, terminals and rules](https://github.com/ShiboSoftwareDev/core-ddr-benchmark/blob/5a2cfa2382097432214ef567a3e1e97144b33f71/circuits/a64.json.gz)
are unchanged. The remaining phase requests 43 nets after the four data-byte
phases have emitted 32 routes. No additional timing constraints are invented.

Uncompressed remaining-phase SRJ SHA-256:
`54ddf4727e24e486ca71bc9ef856057ca1858a9390b384da7341ceb2891142ce`.

The generated SVG overlays the first global search's own preview on the captured
board. Its colored lines are coarse path plans, not completed PCB copper.

Reverified with `tscircuit@0.0.3191`, `@tscircuit/core@0.0.2383`, and
`@tscircuit/capacity-autorouter@0.0.1100`: the remaining-phase SRJ has the
same SHA-256 above. The real board and its 43 remaining nets are unchanged.
