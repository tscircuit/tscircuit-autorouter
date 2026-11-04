# OrangeCrab through-via contacts

Unmodified remaining-phase Pipeline9 input captured while rendering the real
OrangeCrab rev 0.2.1 DDR3 TSX circuit through tscircuit 0.0.3074, core
0.0.2266, capacity-autorouter 0.0.1037 and bus-lanes-solver 0.0.41.
Both eight-bit data buses are completed before the remaining 34 connections.
The board has six copper layers, 0.28 mm through-vias, 0.15 mm drills,
0.0889 mm minimum traces and 0.089 mm clearance.

Hardware: [OrangeCrab](https://github.com/orangecrab-fpga/orangecrab-hardware/blob/c511d569fe2af39467041f888bc231020f40c6ac/hardware/orangecrab_r0.2.1/OrangeCrab.kicad_pcb),
CERN-OHL-1.2. Native ECP5 and MT41K64M16 footprints, placement and DDR nets
are retained; existing hardware copper is removed before routing.

`input.srj.json.gz` is the exact solver input (SHA-256 cb945eab780cd3c61d54dcf74d7fcfe74fc3ae805b9140d20d0daf20661d547b).
`physical-reference.srj.json.gz` is only used for checking and drawing: it
replaces the fixed-copper raster obstacles with the actual 16 completed byte
routes, retaining the native pads and all 50 connection identities. It is not
passed to the solver.

Baseline: RAM_UDQS+ shorts RAM_D10 on bottom; RAM_ODT shorts RAM_UDM on
bottom. Both vias electrically change between top and an inner layer, but
physically span all six layers. Full-board routing completes all 50 nets.
