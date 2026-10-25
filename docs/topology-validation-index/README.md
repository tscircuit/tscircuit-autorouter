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
