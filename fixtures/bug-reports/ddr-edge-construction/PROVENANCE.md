Replays mesh-edge construction for the real A64 and STM32MP157 DDR boards.
Both inputs follow 32 completed DQ signals rendered through TSX/core.

The unchanged SRJs, native preceding-copper captures and source attribution are
reused from `../ddr-topology-validation/PROVENANCE.md`. The published
`tscircuit@0.0.3097` / core `0.0.2278` rerun produces the same remaining inputs.

Run from the repository root:

```sh
bun fixtures/bug-reports/ddr-edge-construction/repro.ts stmp157
bun fixtures/bug-reports/ddr-edge-construction/repro.ts a64
```

The runner generates the actual input-board SVG, then runs Pipeline9 through
edge construction and reports its duration, edge count and ordered-output hash.
It stops before remaining-signal path planning. The SVGs show preceding DQ
copper; they do not claim that the remaining 40/43 signals have been routed.

Target handling repeatedly scans all existing edges to find an edge between
two nodes. In serialized local CPU-profiled replays, that lookup dominates the
stage. Indexing edges by node preserves the complete edge array and its order,
so unchanged geometry and unchanged SVGs are expected for this performance fix.
