# Handoff: Gibbs

Latest findings:
- Simplest reliable `srj18 sample001` access path is `dataset-srj18`, or the repo helper `loadScenarioBySampleNumber("srj18", 1)`.
- `scripts/run-sample.ts` does not support pipeline 7, so a dedicated script is required.
- Pipeline 7 already exposes `pipelineDef`, `currentPipelineStepIndex`, `solveUntilPhase`, and `getCurrentPhase`, which are enough for phase-by-phase analysis.

References:
- [fixtures/benchmarks/dataset-srj18.fixture.tsx](/home/ohmx/Documents/tscircuit-autorouter/fixtures/benchmarks/dataset-srj18.fixture.tsx:5)
- [scripts/benchmark/scenarios.ts](/home/ohmx/Documents/tscircuit-autorouter/scripts/benchmark/scenarios.ts:170)
- [scripts/benchmark/scenarios.ts](/home/ohmx/Documents/tscircuit-autorouter/scripts/benchmark/scenarios.ts:271)
- [scripts/run-sample.ts](/home/ohmx/Documents/tscircuit-autorouter/scripts/run-sample.ts:86)
- [lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph.ts](/home/ohmx/Documents/tscircuit-autorouter/lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph.ts:654)
- [lib/testing/PipelineStageDebugRunner.ts](/home/ohmx/Documents/tscircuit-autorouter/lib/testing/PipelineStageDebugRunner.ts:17)
