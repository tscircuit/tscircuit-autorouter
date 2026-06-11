# Deep portPoint tiny-hypergraph memory findings

- Runs: 1.
- Average isolated solver duration: 10517.2ms.
- Duplicate congested-port prepass is the dominant retained-heap jump: about +704.8 MiB after GC.
- First `solveGraph` step releases about -470.4 MiB of JS heap on average, which means much of the spike is constructor-era object retention rather than long-lived solver state.
- `optimizeSection` adds only about +58.2 MiB and finishes in about 0.000ms.
- Final retained memory after solve stays near 364.3 MiB heap / 729.0 MiB RSS.
- Duplicate prepass consistently duplicates about 201 ports across 115 source ports.
- Highest average retained-heap checkpoints:
- `solver:constructor:after-duplicateCongestedPortPrepass`: 776.6 MiB.
- `solver:constructor:after-createTinyPipelineInput`: 776.6 MiB.
- `solver:constructor:after-createTinyPipelineSolver`: 776.6 MiB.
- `solver:constructor:after-buildInputNodesWithPortPoints`: 776.6 MiB.
- `solver:constructor:end`: 776.6 MiB.
- `solver:constructed`: 776.6 MiB.
- `solver:stage:unstarted`: 776.6 MiB.
- `solver:stage:optimizeSection`: 364.3 MiB.
- Largest retained-heap jumps per run:
- `run-001`: `solver:constructor:after-duplicateCongestedPortPrepass` (704.8 MiB).

