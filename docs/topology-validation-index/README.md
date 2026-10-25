# Quadratic topology overlap validation

After accepting all 46 DDR signals, the AM3352 support stage spends tens of
minutes in topology validation. The validator scans every output-node pair,
including distant rectangles. This generated disjoint-grid reproduction has
no captured board data. Its geometry-read budget fails on the original scan.

![Inspected valid native regions](completed.png)

The stacked fix indexes validated bounds, sorts intersecting candidates in
original input order, and applies the unchanged overlap/provenance checks.
Existing first-error and invalid-node ordering must remain intact. The benchmark
compares ordinary-node timings separately from instrumented geometry reads.

Local paired measurements, Bun 1.4.0 on a shared 4-CPU host while the board
runs; one warm-up and three measured runs, unchanged native nodes and identical
input hashes:

- 4,096 nodes: 30.498 → 4.807 ms; separate instrumented geometry reads 12,721,152 → 8,192.
- 16,384 nodes: 620.676 → 23.112 ms; separate instrumented geometry reads 202,403,840 → 32,768.

All 13 focused topology tests pass (62 assertions), including original error
ordering, without changing existing snapshots. Every-PR Blacksmith repeats the
validation comparison and the inherited full canonical routing benchmark.
These are validator costs, not proof of a completed AM3352 board.
