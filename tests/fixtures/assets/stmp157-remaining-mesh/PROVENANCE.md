# STMP157 remaining-routing mesh

`input.srj.json.gz` is the unchanged Pipeline9 input captured from the real
STMP157 CPU + DDR3 TSX board after all four data bytes (32 signals) route.
It contains 40 remaining connections, 137 terminals, 710 original pad
rectangles and 2,739 existing-copper rectangles on eight layers.

Source: [OLIMEX STMP157-OLinuXino-LIME2 rev B1](https://github.com/OLIMEX/OLINUXINO/blob/85eee9c17ee13af65617d73bdd94de7ec49cfb42/HARDWARE/STMP157-OLinuXino-LIME2/1.%20Latest%20hardware%20revision/STMP157-OLinuXino-LIME2_Rev_B1/STMP157-OLinuXino-LIME2_Rev_B1.kicad_pcb).
Layout revision `85eee9c17ee13af65617d73bdd94de7ec49cfb42`, license
`CC-BY-SA-3.0-US`. CPU: STM32MP157CAA3x; RAM: two K4B4G1646D-BYK0.

Captured with published `tscircuit@0.0.3071`, `@tscircuit/core@0.0.2264`,
`@tscircuit/bus-lanes-solver@0.0.41` and
`@tscircuit/capacity-autorouter@0.0.1035`. No pad, clearance, trace width,
layer or connection was changed for this regression.

Decompressed SHA-256:
`783738f1ce719d1aa83faa4a5dccd7ba22cc0ed77768b9e081ff9be568e8d7ac`.

The topology planner produces 35,785 input nodes and 4,122 X coordinates.
Before the fix, an isolated published-autorouter replay retained over
4.55 million temporary regions and exceeded a 6-GiB process limit before
final compaction. This also happens without retaining earlier core/bus stages.

The test uses the full Pipeline9 preparation from this SRJ. It stops at
250,000 retained regions to reproduce the bug safely in CI and still requires
the mesh merger to finish. The stop is deterministic and is not a timeout or
an alternative successful result. The SVG renders the native routing input
with actual stage status/counts; it does not claim that the remaining nets
have been routed or that timing/DRC has been satisfied.
