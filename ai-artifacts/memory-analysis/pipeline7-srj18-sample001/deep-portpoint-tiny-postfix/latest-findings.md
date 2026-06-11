# Deep portPoint tiny-hypergraph memory findings

- Runs: 1.
- Average isolated solver duration: 10144.1ms.
- Duplicate congested-port prepass is the dominant retained-heap jump: about +706.9 MiB after GC.
- First `solveGraph` step releases about -467.6 MiB of JS heap on average, which means much of the spike is constructor-era object retention rather than long-lived solver state.
- `optimizeSection` adds only about +59.9 MiB and finishes in about 0.830ms.
- Final retained memory after solve stays near 370.9 MiB heap / 741.3 MiB RSS.
- Duplicate prepass consistently duplicates about 201 ports across 115 source ports.
- Highest average retained-heap checkpoints:
- `solver:constructor:after-duplicateCongestedPortPrepass`: 778.6 MiB.
- `solver:constructor:after-createTinyPipelineInput`: 778.6 MiB.
- `solver:constructor:after-createTinyPipelineSolver`: 778.6 MiB.
- `solver:constructor:after-buildInputNodesWithPortPoints`: 778.6 MiB.
- `solver:constructor:end`: 778.6 MiB.
- `solver:constructed`: 778.6 MiB.
- `solver:stage:unstarted`: 778.6 MiB.
- `solver:stage:optimizeSection`: 370.9 MiB.
- Largest retained-heap jumps per run:
- `run-001`: `solver:constructor:after-duplicateCongestedPortPrepass` (706.9 MiB).

