# Pipeline 9 weakens T113 HDMI 1.8 V drill spacing

This reproduction comes from a 141-component Allwinner T113-S3 Linux board.
The exact Pipeline 9 input declares 0.20 mm minimum clearance between via drill
edges. Routing completes, but two same-net HDMI 1.8 V vias finish with only
0.175690633 mm drill-edge clearance.

Stage-by-stage replay establishes the producing boundary. Trace simplification,
trace-width expansion, and global DRC contain no same-net drill-spacing error.
`Pipeline9JointDrcRepairSolver` introduces the close pair, and length matching
preserves it unchanged. The final 388 traces are byte-identical to the original
board run.

The parent reproduction asserts the one known violation and snapshots the
routed board beside the exact drill pair. The stacked fix updates the same test
to require zero via-spacing violations. This reproduction does not claim that
the entire Linux board is electrically or fabrication complete.

## Exact fixtures

`t113-linux-hdmi-ddc-via-spacing.srj.json.gz` is the exact Pipeline 9
constructor input. It contains 258 connections, 605 obstacles, no preloaded
traces, and the 0.20 mm via-hole clearance rule. Its SHA-256 after decompression
is `dc19c3abc1788919eea83e1fd7318d072776c3445ddb3208ff5885f66f64b11b`.

`t113-linux-hdmi-ddc-via-spacing-unrouted.circuit.json.gz` is the matching
Circuit JSON before routing. It contains 141 source components, 141 PCB
components, and no PCB traces or vias. Its SHA-256 after decompression is
`b83ca178c2556cbe3950c4c6fe730c8953417a49fc2702415ad31b6684376ecb`.

`pipeline9-t113-hdmi-ddc-joint-vias.json` is extracted from the exact Joint
output. It retains the failing `mst10` and `mst15` routes and their three pad
obstacles at `pcb_port_251`, `pcb_port_293`, and `pcb_port_317`. This small
fixture reproduces the acceptance-policy defect; the full fixture retains the
original generating context.

## Root cause and correction

Joint repair already reads `minTraceToPadEdgeClearance` from the input, but it
previously took via-hole clearance only from the 0.10 mm benchmark preset. That
weakened the explicit `minViaHoleEdgeToViaHoleEdgeClearance` rule in the
baseline, current-output, and candidate reference evaluations. A route could
therefore be accepted as reference-clean while violating the board's
drill-spacing rule.

The fix uses the declared via-hole clearance at every Joint reference boundary,
with the benchmark preset retained as the fallback for inputs that do not
declare a rule. The indexed engine keeps its existing copper-edge spacing
because it measures from via outer diameters rather than drill diameters. The
existing repair portfolio then merges the two same-net transitions onto one
physical drill. No final-output cleanup or silent fallback is added.

Run locally:

```sh
bun test tests/repro/pipeline9-t113-hdmi-ddc-via-spacing.test.ts --timeout 9999999
```
