# Deep portPoint tiny-hypergraph memory findings

- Runs: 2.
- Average isolated solver duration: 10262.6ms.
- Duplicate congested-port prepass is the dominant retained-heap jump: about +10.0 MiB after GC.
- First `solveGraph` step releases about 0.0 MiB of JS heap on average, which means much of the spike is constructor-era object retention rather than long-lived solver state.
- `optimizeSection` adds only about +31.2 MiB and finishes in about 0.000ms.
- Final retained memory after solve stays near 113.0 MiB heap / 402.4 MiB RSS.
- Duplicate prepass consistently duplicates about 201 ports across 115 source ports.
- Highest average retained-heap checkpoints:
- `solver:stage:optimizeSection`: 113.0 MiB.
- `solver:stage:none`: 113.0 MiB.
- `solver:after-solve`: 113.0 MiB.
- `solver:getOutput:after-buildInputNodesWithPortPoints`: 113.0 MiB.
- `solver:after-getOutput`: 113.0 MiB.
- `solver:constructor:after-duplicateCongestedPortPrepass`: 81.9 MiB.
- `solver:constructor:after-createTinyPipelineInput`: 81.9 MiB.
- `solver:constructor:after-createTinyPipelineSolver`: 81.9 MiB.
- Largest retained-heap jumps per run:
- `run-001`: `solver:stage:optimizeSection` (32.1 MiB).
- `run-002`: `solver:stage:optimizeSection` (30.2 MiB).

