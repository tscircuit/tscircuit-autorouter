# Exact A64 byte-zero routing input

`a64-byte0-source-rules.srj.json.gz` contains the byte-exact frozen SRJ used to
discover the DDR foreign-pad drill collision. Decompressing it produces 982,581
bytes with SHA-256:

```
1966c316d2223d5c9f5a162dd00f3fdf61b811ab7ef707cac160a42fe1a4c01e
```

The file keeps all 2,122 board pad obstacles, six native copper layers, eleven
byte-zero signals and their 22 original endpoints. It keeps the A64 and DDR
packages at their actual placed coordinates, including circular RAM pad U2.D3
and the DQ4 escape area. No synthetic package placement or reduced obstacle set
is substituted in the real-input snapshot test. The separate small escape
fixture remains a faster isolated regression.

The source is OLIMEX A64-OLinuXino hardware revision H, copyright OLIMEX Ltd.,
published under CC-BY-SA-3.0-US. The original KiCad PCB is pinned to commit
`b48543c9674439c97a5bfa2024830f22a94d7a35` in
[OLIMEX/OLINUXINO](https://github.com/OLIMEX/OLINUXINO/blob/b48543c9674439c97a5bfa2024830f22a94d7a35/HARDWARE/A64-OLinuXino/1.%20Latest%20hardware%20revision/A64-OLinuXino%20hardware%20revision%20H/A64-OlinuXino_Rev_H.kicad_pcb).
Its source-board SHA-256 is
`3acf7af7d39d54ba87343845d78851b0245a6290841cb463c42c7e41696404f4`.
See the manufacturer's
[licensing statement](https://github.com/OLIMEX/OLINUXINO/blob/b48543c9674439c97a5bfa2024830f22a94d7a35/README.md).

The original extraction removes all tracks, vias and zones, uses the board-edge
bounding box, and exposes all native layers without original power/ground plane
reservations. It selects DQ0–7, DM0 and both DQS0 wires; it is not the complete
75-net named DDR interface. Manufacturer timing, coupling, controlled impedance
and electrical signoff constraints are not encoded. These limitations are
properties of the original frozen workload, not changes made for this test.

The test routes this original input from scratch with Pipeline 9 at effort 1 and
no pipeline cache. A separate evaluation clone adds only PCB pad/port identities
so foreign pads remain visible even to the old DRC converter. Geometry, layer
roles, net membership and routing constraints are not changed by that clone.
The full-board SVG retains all pad context; the focused SVG crops the drawing
around the original RAM escape and reports whole-sample checker findings and
direct drill/pad overlap counts.

Checker DRC and the direct drill test are separate. The baseline DRC converter
exports circle pads as bounding rectangles, while the fix preserves true circles;
that affects aggregate checker counts. The independent drill test uses native
source circles and rectangles in both versions. Native debug drawings still use
rectangular pad proxies; the direct drill check does not use those proxies.
The original offending drill
has center `(132.404, -85.4)` and radius `0.1` mm; U2.D3 has center
`(132.6, -85.4)` and radius `0.2` mm. Their 0.196 mm center separation is less
than the 0.3 mm sum of radii, so this is an actual circular-pad collision, not a
rectangle-corner artifact.
