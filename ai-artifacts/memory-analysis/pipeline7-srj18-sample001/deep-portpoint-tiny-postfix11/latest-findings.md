# Deep portPoint tiny-hypergraph memory findings

- Runs: 1.
- Average isolated solver duration: 10522.0ms.
- Duplicate congested-port prepass is the dominant retained-heap jump: about +10.4 MiB after GC.
- First `solveGraph` step releases about 0.0 MiB of JS heap on average, which means much of the spike is constructor-era object retention rather than long-lived solver state.
- `optimizeSection` adds only about +31.4 MiB and finishes in about 0.000ms.
- Final retained memory after solve stays near 114.4 MiB heap / 409.1 MiB RSS.
- Duplicate prepass consistently duplicates about 201 ports across 115 source ports.
- Highest average retained-heap checkpoints:
- `solver:stage:optimizeSection`: 114.4 MiB.
- `solver:stage:none`: 114.4 MiB.
- `solver:after-solve`: 114.4 MiB.
- `solver:getOutput:after-buildInputNodesWithPortPoints`: 114.4 MiB.
- `solver:after-getOutput`: 114.4 MiB.
- `solver:constructor:after-duplicateCongestedPortPrepass`: 83.0 MiB.
- `solver:constructor:after-createTinyPipelineInput`: 83.0 MiB.
- `solver:constructor:after-createTinyPipelineSolver`: 83.0 MiB.
- Largest retained-heap jumps per run:
- `run-001`: `solver:stage:optimizeSection` (31.4 MiB).

