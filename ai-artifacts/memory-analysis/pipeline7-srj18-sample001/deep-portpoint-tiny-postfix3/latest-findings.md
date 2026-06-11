# Deep portPoint tiny-hypergraph memory findings

- Runs: 1.
- Average isolated solver duration: 11518.2ms.
- Duplicate congested-port prepass is the dominant retained-heap jump: about +706.7 MiB after GC.
- First `solveGraph` step releases about -467.5 MiB of JS heap on average, which means much of the spike is constructor-era object retention rather than long-lived solver state.
- `optimizeSection` adds only about +59.6 MiB and finishes in about 0.000ms.
- Final retained memory after solve stays near 370.6 MiB heap / 746.6 MiB RSS.
- Duplicate prepass consistently duplicates about 201 ports across 115 source ports.
- Highest average retained-heap checkpoints:
- `solver:constructor:after-duplicateCongestedPortPrepass`: 778.5 MiB.
- `solver:constructor:after-createTinyPipelineInput`: 778.5 MiB.
- `solver:constructor:after-createTinyPipelineSolver`: 778.5 MiB.
- `solver:constructor:after-buildInputNodesWithPortPoints`: 778.5 MiB.
- `solver:constructor:end`: 778.5 MiB.
- `solver:constructed`: 778.5 MiB.
- `solver:stage:unstarted`: 778.5 MiB.
- `solver:stage:optimizeSection`: 370.6 MiB.
- Largest retained-heap jumps per run:
- `run-001`: `solver:constructor:after-duplicateCongestedPortPrepass` (706.7 MiB).

