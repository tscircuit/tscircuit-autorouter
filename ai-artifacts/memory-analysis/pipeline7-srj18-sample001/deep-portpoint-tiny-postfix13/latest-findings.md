# Deep portPoint tiny-hypergraph memory findings

- Runs: 2.
- Average isolated solver duration: 12376.7ms.
- Duplicate congested-port prepass is the dominant retained-heap jump: about +9.4 MiB after GC.
- First `solveGraph` step releases about 0.0 MiB of JS heap on average, which means much of the spike is constructor-era object retention rather than long-lived solver state.
- `optimizeSection` adds only about +3.1 MiB and finishes in about 0.000ms.
- Final retained memory after solve stays near 84.9 MiB heap / 395.0 MiB RSS.
- Duplicate prepass consistently duplicates about 201 ports across 115 source ports.
- Highest average retained-heap checkpoints:
- `solver:stage:optimizeSection`: 84.9 MiB.
- `solver:stage:none`: 84.9 MiB.
- `solver:after-solve`: 84.9 MiB.
- `solver:getOutput:after-buildInputNodesWithPortPoints`: 84.9 MiB.
- `solver:after-getOutput`: 84.9 MiB.
- `solver:constructor:after-duplicateCongestedPortPrepass`: 81.9 MiB.
- `solver:constructor:after-createTinyPipelineInput`: 81.9 MiB.
- `solver:constructor:after-createTinyPipelineSolver`: 81.9 MiB.
- Largest retained-heap jumps per run:
- `run-001`: `solver:constructor:after-duplicateCongestedPortPrepass` (10.5 MiB).
- `run-002`: `solver:constructor:after-duplicateCongestedPortPrepass` (8.3 MiB).

