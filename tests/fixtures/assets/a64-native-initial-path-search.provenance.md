The fixture captures the remaining DDR routing phase on the OLIMEX
A64-OLinuXino rev H. It comes from `autorouting:start` on the original TSX
rendered by `tscircuit@0.0.3242`, `@tscircuit/core@0.0.2424` and
`@tscircuit/capacity-autorouter@0.0.1132`.

The four byte phases have already routed 32 nets. The remaining request
has 43 nets, 3,922 obstacles and 77 point-to-point paths after pairing.
The snapshot overlays the initial global search's own preview on this board.
The colored paths show the plan before detailed routing generates copper.

The uncompressed SRJ has SHA-256
`f9c9a11e10aca9c9fa9874078a6e005b0864add1a4c1bbaa4f8b4475c852ef4d`.

- [TSX importer](https://github.com/ShiboSoftwareDev/core-ddr-benchmark/blob/24dc44c166d4258c3538f8b1f66953f1b6f58690/circuits/native-ddr-board.tsx)
- [Native placements, pads, terminals and board rules](https://github.com/ShiboSoftwareDev/core-ddr-benchmark/blob/24dc44c166d4258c3538f8b1f66953f1b6f58690/circuits/a64.json.gz)
- [Original board by OLIMEX Ltd.](https://github.com/OLIMEX/OLINUXINO/tree/85eee9c17ee13af65617d73bdd94de7ec49cfb42/HARDWARE/A64-OLinuXino)
- [License for the derived fixture, CC BY-SA 3.0 US](https://creativecommons.org/licenses/by-sa/3.0/us/)
