# Deep portPoint tiny-hypergraph memory findings

- Runs: 1.
- Average isolated solver duration: 10389.5ms.
- Duplicate congested-port prepass is the dominant retained-heap jump: about +12.3 MiB after GC.
- First `solveGraph` step releases about 222.1 MiB of JS heap on average, which means much of the spike is constructor-era object retention rather than long-lived solver state.
- `optimizeSection` adds only about +58.1 MiB and finishes in about 0.000ms.
- Final retained memory after solve stays near 364.2 MiB heap / 727.3 MiB RSS.
- Duplicate prepass consistently duplicates about 201 ports across 115 source ports.
- Highest average retained-heap checkpoints:
- `solver:stage:optimizeSection`: 364.2 MiB.
- `solver:stage:none`: 364.2 MiB.
- `solver:after-solve`: 364.2 MiB.
- `solver:getOutput:after-buildInputNodesWithPortPoints`: 364.2 MiB.
- `solver:after-getOutput`: 364.2 MiB.
- `solver:stage:solveGraph`: 306.1 MiB.
- `solver:constructor:after-duplicateCongestedPortPrepass`: 84.0 MiB.
- `solver:constructor:after-createTinyPipelineInput`: 84.0 MiB.
- Largest retained-heap jumps per run:
- `run-001`: `solver:stage:solveGraph` (222.1 MiB).

