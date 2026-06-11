# Deep portPoint tiny-hypergraph memory findings

- Runs: 2.
- Average isolated solver duration: 12114.4ms.
- Duplicate congested-port prepass is the dominant retained-heap jump: about +11.5 MiB after GC.
- First `solveGraph` step releases about 0.0 MiB of JS heap on average, which means much of the spike is constructor-era object retention rather than long-lived solver state.
- `optimizeSection` adds only about +5.6 MiB and finishes in about 0.000ms.
- Final retained memory after solve stays near 88.6 MiB heap / 394.4 MiB RSS.
- Duplicate prepass consistently duplicates about 201 ports across 115 source ports.
- Highest average retained-heap checkpoints:
- `solver:stage:optimizeSection`: 88.6 MiB.
- `solver:stage:none`: 88.6 MiB.
- `solver:after-solve`: 88.6 MiB.
- `solver:getOutput:after-buildInputNodesWithPortPoints`: 88.6 MiB.
- `solver:after-getOutput`: 88.6 MiB.
- `solver:constructor:after-duplicateCongestedPortPrepass`: 83.1 MiB.
- `solver:constructor:after-createTinyPipelineInput`: 83.1 MiB.
- `solver:constructor:after-createTinyPipelineSolver`: 83.1 MiB.
- Largest retained-heap jumps per run:
- `run-001`: `solver:constructor:after-duplicateCongestedPortPrepass` (10.9 MiB).
- `run-002`: `solver:constructor:after-duplicateCongestedPortPrepass` (12.1 MiB).

