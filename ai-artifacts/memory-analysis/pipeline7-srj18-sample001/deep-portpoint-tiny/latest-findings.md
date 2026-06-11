# Deep portPoint tiny-hypergraph memory findings

- Runs: 3.
- Average isolated solver duration: 10338.4ms.
- Duplicate congested-port prepass is the dominant retained-heap jump: about +680.0 MiB after GC.
- First `solveGraph` step releases about -440.5 MiB of JS heap on average, which means much of the spike is constructor-era object retention rather than long-lived solver state.
- `optimizeSection` adds only about +59.4 MiB and finishes in about 0.907ms.
- Final retained memory after solve stays near 371.0 MiB heap / 742.2 MiB RSS.
- Duplicate prepass consistently duplicates about 201 ports across 115 source ports.
- Highest average retained-heap checkpoints:
- `solver:constructor:after-duplicateCongestedPortPrepass`: 752.1 MiB.
- `solver:constructor:after-createTinyPipelineInput`: 752.1 MiB.
- `solver:constructor:after-createTinyPipelineSolver`: 752.1 MiB.
- `solver:constructor:after-buildInputNodesWithPortPoints`: 752.1 MiB.
- `solver:constructor:end`: 752.1 MiB.
- `solver:constructed`: 752.1 MiB.
- `solver:stage:unstarted`: 752.1 MiB.
- `solver:stage:optimizeSection`: 371.0 MiB.
- Largest retained-heap jumps per run:
- `run-001`: `solver:constructor:after-duplicateCongestedPortPrepass` (706.7 MiB).
- `run-002`: `solver:constructor:after-duplicateCongestedPortPrepass` (626.3 MiB).
- `run-003`: `solver:constructor:after-duplicateCongestedPortPrepass` (706.9 MiB).

