# A64 DDR clock through-via space

Native OLIMEX A64-OLinuXino rev H CPU, two DDR3 RAMs and termination resistors:
[hardware source](https://github.com/OLIMEX/OLINUXINO/blob/85eee9c17ee13af65617d73bdd94de7ec49cfb42/HARDWARE/A64-OLinuXino/1.%20Latest%20hardware%20revision/A64-OLinuXino%20hardware%20revision%20H/A64-OlinuXino_Rev_H.kicad_pcb).
Hardware by OLIMEX, licensed CC-BY-SA-3.0-US. These derived routing fixtures
retain that license: https://creativecommons.org/licenses/by-sa/3.0/us/.

The TSX board was rendered through tscircuit 0.0.3115 / Core 0.0.2297,
capacity-autorouter 0.0.1059 and bus-lanes-solver 0.0.48. All 607 native pads,
six copper layers, placement and board rules are retained: 0.127 mm traces,
0.10668 mm clearance, 0.327 mm through-vias, 0.2 mm drills, no via-in-pad.
The four data-byte phases finish before the clock phase.

`input.srj.json.gz` retains the captured remaining-phase obstacles and selects
only clock-positive (`source_trace_23`): two RAM pads and both resistor pads.
The other 32 completed data signals remain fixed copper obstacles.
Decompressed SHA-256: `9d46149dbcf29db7f6161a54a3973390ba80f09c4c96073b11ab3e5538850778`.

`physical-reference.srj.json.gz` is used only for drawing and DRC. It replaces
fixed-copper raster obstacles with the actual 32 completed data routes and
retains all native pads and the 33 requested connection identities. It is never
passed to the solver.

Baseline: the clock cannot reach R3 pin 2 on bottom. Its escape crosses six
mesh edges before reaching through-via space. The cramped-port filter retains
only a local prefix, leaving the terminal disconnected from the clock's other
endpoints. The SVG shows the existing data copper; a successful clock solve
adds its three branches without changing the data routing.
