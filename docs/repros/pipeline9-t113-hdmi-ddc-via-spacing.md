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

Run locally:

```sh
bun test tests/repro/pipeline9-t113-hdmi-ddc-via-spacing.test.ts --timeout 9999999
```
