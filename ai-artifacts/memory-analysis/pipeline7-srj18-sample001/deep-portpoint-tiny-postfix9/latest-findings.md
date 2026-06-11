# Deep portPoint tiny-hypergraph memory findings

- Runs: 1.
- Average isolated solver duration: 11187.5ms.
- Duplicate congested-port prepass is the dominant retained-heap jump: about +12.2 MiB after GC.
- First `solveGraph` step releases about 225.9 MiB of JS heap on average, which means much of the spike is constructor-era object retention rather than long-lived solver state.
- `optimizeSection` adds only about +54.9 MiB and finishes in about 0.000ms.
- Final retained memory after solve stays near 364.1 MiB heap / 741.4 MiB RSS.
- Duplicate prepass consistently duplicates about 201 ports across 115 source ports.
- Highest average retained-heap checkpoints:
- `solver:stage:optimizeSection`: 364.1 MiB.
- `solver:stage:none`: 364.1 MiB.
- `solver:after-solve`: 364.1 MiB.
- `solver:getOutput:after-buildInputNodesWithPortPoints`: 364.1 MiB.
- `solver:after-getOutput`: 364.1 MiB.
- `solver:stage:solveGraph`: 309.2 MiB.
- `solver:constructor:after-duplicateCongestedPortPrepass`: 83.3 MiB.
- `solver:constructor:after-createTinyPipelineInput`: 83.3 MiB.
- Largest retained-heap jumps per run:
- `run-001`: `solver:stage:solveGraph` (225.9 MiB).

