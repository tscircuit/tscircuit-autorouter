# Deep portPoint tiny-hypergraph memory findings

- Runs: 3.
- Average isolated solver duration: 10554.9ms.
- Duplicate congested-port prepass is the dominant retained-heap jump: about +9.5 MiB after GC.
- First `solveGraph` step releases about 0.0 MiB of JS heap on average, which means much of the spike is constructor-era object retention rather than long-lived solver state.
- `optimizeSection` adds only about +32.5 MiB and finishes in about 0.000ms.
- Final retained memory after solve stays near 114.0 MiB heap / 400.5 MiB RSS.
- Duplicate prepass consistently duplicates about 201 ports across 115 source ports.
- Highest average retained-heap checkpoints:
- `solver:stage:optimizeSection`: 114.0 MiB.
- `solver:stage:none`: 114.0 MiB.
- `solver:after-solve`: 114.0 MiB.
- `solver:getOutput:after-buildInputNodesWithPortPoints`: 114.0 MiB.
- `solver:after-getOutput`: 114.0 MiB.
- `solver:constructor:after-duplicateCongestedPortPrepass`: 81.5 MiB.
- `solver:constructor:after-createTinyPipelineInput`: 81.5 MiB.
- `solver:constructor:after-createTinyPipelineSolver`: 81.5 MiB.
- Largest retained-heap jumps per run:
- `run-001`: `solver:stage:optimizeSection` (31.7 MiB).
- `run-002`: `solver:stage:optimizeSection` (33.4 MiB).
- `run-003`: `solver:stage:optimizeSection` (32.4 MiB).

