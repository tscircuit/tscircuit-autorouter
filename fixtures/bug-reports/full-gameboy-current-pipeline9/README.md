# Full current Game Boy Advance Pipeline 9 repro

This is the complete, unrouted Simple Route JSON generated from the current
RP2350 Game Boy Advance board. It contains:

- 145 connections
- 411 component and pad obstacles
- four copper layers
- the production board outline and clearances
- no manual paths, breakout points, or preloaded traces

The matching Core repro starts from the full source-and-PCB Circuit JSON. This
fixture is the exact global Pipeline 9 problem derived from that board, so an
autorouter fix can be verified without reducing away the real congestion.

The test requires Pipeline 9 to finish normally, records the routed board as an
SVG with the benchmark relaxed-DRC count, and keeps only the zero-DRC assertion
as the expected failure.
