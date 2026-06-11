# Deep portPoint tiny-hypergraph memory findings

- Runs: 1.
- Average isolated solver duration: 10337.7ms.
- Duplicate congested-port prepass is the dominant retained-heap jump: about +18.9 MiB after GC.
- First `solveGraph` step releases about 0.0 MiB of JS heap on average, which means much of the spike is constructor-era object retention rather than long-lived solver state.
- `optimizeSection` adds only about +23.3 MiB and finishes in about 0.000ms.
- Final retained memory after solve stays near 113.1 MiB heap / 401.6 MiB RSS.
- Duplicate prepass consistently duplicates about 201 ports across 115 source ports.
- Highest average retained-heap checkpoints:
- `solver:stage:optimizeSection`: 113.1 MiB.
- `solver:stage:none`: 113.1 MiB.
- `solver:after-solve`: 113.1 MiB.
- `solver:getOutput:after-buildInputNodesWithPortPoints`: 113.1 MiB.
- `solver:after-getOutput`: 113.1 MiB.
- `solver:constructor:after-duplicateCongestedPortPrepass`: 89.8 MiB.
- `solver:constructor:after-createTinyPipelineInput`: 89.8 MiB.
- `solver:constructor:after-createTinyPipelineSolver`: 89.8 MiB.
- Largest retained-heap jumps per run:
- `run-001`: `solver:stage:optimizeSection` (23.3 MiB).

