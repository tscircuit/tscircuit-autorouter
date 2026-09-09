# T113-S3 USB terminal-via clearance reproduction

This fixture is a native capture from the real T113-S3 board's
`UsbPowerFrontend` TSX subcircuit, rendered with tscircuit 0.0.2468. It is the
unchanged input to USB routing phase 3 of 35. The active connection is CC2;
the two preloaded routes are the real A- and B-side USB VBUS connections
between the TYPE-C-31-M-12 receptacle and MF-MSMF150-2 fuse.

The component Circuit JSON is the same native TSX render with only final
routed copper, diagnostics, CAD, paste, and courtyard records removed. It
retains all 12 source components and their real PCB components, pads, plated
slots, holes, ports, silkscreen, nets, source traces, board, and ground pour.
The test adds only the copper returned by Pipeline 9 and uses the captured SRJ
bounds as the scoped board outline so the component group is visible. It then
snapshots the ordinary `convertCircuitJsonToPcbSvg` output without annotations
or hand-edited SVG.

With high-density-repair03 commit
`37d2b7af008c3a79c1a794e2ca307583a0f19c98`, joint DRC repair moves the
`USB_VBUS_A_IN` route to an inner layer and places its two terminal vias only
0.000001529 mm and 0.000001079 mm from their connected pads. The 0.1 mm rule
is present in the captured SRJ but is not honored.

With commit `8ba89b6edd5f3befa1c473d35f723cd5677964de`, the identical input solves and
places those vias 0.100001277 mm and 0.100001190 mm from the connector and fuse
pads. The test measures the native polygon/rectangle pad outlines directly.

This is a scoped regression for the observed terminal-via defect. It is not a
claim that the complete Stage 4 board or every USB routing phase is DRC-clean.
