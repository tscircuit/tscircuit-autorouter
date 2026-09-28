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

The parent reproduction intentionally asserts the one known violation and
snapshots the routed board beside the exact drill pair. The stacked fix will
make joint repair honor the input's declared via-hole clearance and will update
the same test to require zero violations. This reproduction does not claim that
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

Run locally:

```sh
bun test tests/repro/pipeline9-t113-hdmi-ddc-via-spacing.test.ts --timeout 9999999
```
