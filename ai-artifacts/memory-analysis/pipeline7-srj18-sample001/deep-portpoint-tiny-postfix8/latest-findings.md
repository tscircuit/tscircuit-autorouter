# Deep portPoint tiny-hypergraph memory findings

- Runs: 1.
- Average isolated solver duration: 9803.1ms.
- Duplicate congested-port prepass is the dominant retained-heap jump: about +16.7 MiB after GC.
- First `solveGraph` step releases about 217.8 MiB of JS heap on average, which means much of the spike is constructor-era object retention rather than long-lived solver state.
- `optimizeSection` adds only about +58.9 MiB and finishes in about 0.000ms.
- Final retained memory after solve stays near 365.0 MiB heap / 729.8 MiB RSS.
- Duplicate prepass consistently duplicates about 201 ports across 115 source ports.
- Highest average retained-heap checkpoints:
- `solver:stage:optimizeSection`: 365.0 MiB.
- `solver:stage:none`: 365.0 MiB.
- `solver:after-solve`: 365.0 MiB.
- `solver:getOutput:after-buildInputNodesWithPortPoints`: 365.0 MiB.
- `solver:after-getOutput`: 365.0 MiB.
- `solver:stage:solveGraph`: 306.2 MiB.
- `solver:constructor:after-duplicateCongestedPortPrepass`: 88.3 MiB.
- `solver:constructor:after-createTinyPipelineInput`: 88.3 MiB.
- Largest retained-heap jumps per run:
- `run-001`: `solver:stage:solveGraph` (217.8 MiB).

