# Glider round-pad width regression

The regression replays the original Glider DDR TSX through the shared tscircuit 0.0.3276 width capture. It uses 360 native SMT pad obstacles and carries the two completed byte buses as 16 physical traces. The capture includes the pad shapes, post-repair paths, connectivity map, board limits and clearance rules. [Capture and hardware provenance](../ddr-local-trace-widths/PROVENANCE.md) · [Hardware license](LICENSE.hardware.txt)

DRAM_ADDR5 and one branch of DRAM_CKE both fit at their requested 0.127 mm width. Treating the circular BGA pads as rectangles reduces both to 0.11 mm. The test checks the full wire length of both paths and draws ADDR5 with its neighboring pads.

Run `bun test tests/repro/glider-ddr-round-pad-width.test.ts`.
