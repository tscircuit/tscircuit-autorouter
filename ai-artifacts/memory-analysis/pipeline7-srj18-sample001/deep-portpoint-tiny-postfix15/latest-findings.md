# Deep portPoint tiny-hypergraph memory findings

- Runs: 2.
- Average isolated solver duration: 11324.1ms.
- Duplicate congested-port prepass is the dominant retained-heap jump: about +15.3 MiB after GC.
- First `solveGraph` step releases about 0.0 MiB of JS heap on average, which means much of the spike is constructor-era object retention rather than long-lived solver state.
- `optimizeSection` adds only about +27.5 MiB and finishes in about 0.000ms.
- Final retained memory after solve stays near 115.2 MiB heap / 401.6 MiB RSS.
- Duplicate prepass consistently duplicates about 201 ports across 115 source ports.
- Highest average retained-heap checkpoints:
- `solver:stage:optimizeSection`: 115.2 MiB.
- `solver:stage:none`: 115.2 MiB.
- `solver:after-solve`: 115.2 MiB.
- `solver:getOutput:after-buildInputNodesWithPortPoints`: 115.2 MiB.
- `solver:after-getOutput`: 115.2 MiB.
- `solver:constructor:after-duplicateCongestedPortPrepass`: 87.7 MiB.
- `solver:constructor:after-createTinyPipelineInput`: 87.7 MiB.
- `solver:constructor:after-createTinyPipelineSolver`: 87.7 MiB.
- Largest retained-heap jumps per run:
- `run-001`: `solver:stage:optimizeSection` (25.8 MiB).
- `run-002`: `solver:stage:optimizeSection` (29.2 MiB).

