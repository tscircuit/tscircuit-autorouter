import { expect, test } from "bun:test"
import {
  AutoroutingPipelineSolver7_MultiGraph,
  getPipeline7PostProcessingEffortConfig,
} from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("pipeline7 scales post-processing effort for selected srj18 samples", async () => {
  for (const sampleNumber of [1, 10, 13]) {
    const { scenario } = await loadScenarioBySampleNumber("srj18", sampleNumber)
    const baselineSolver = new AutoroutingPipelineSolver7_MultiGraph(scenario, {
      effort: 1,
      cacheProvider: null,
    })
    const maxEffortSolver = new AutoroutingPipelineSolver7_MultiGraph(
      scenario,
      { effort: 100, cacheProvider: null },
    )

    expect(baselineSolver.postProcessingEffortConfig).toEqual({
      traceSimplificationPipelineLoops: 2,
      globalDrcMaxIterations: 16,
      exactGeometryDrcMaxIterations: 32,
      exactGeometryDrcBroadMaxIterations: 8,
      residualLocalRerouteMaxCandidateAttempts: 0,
      residualLocalRerouteMaxAcceptedMoves: 0,
    })
    expect(maxEffortSolver.postProcessingEffortConfig).toEqual({
      traceSimplificationPipelineLoops: 200,
      globalDrcMaxIterations: 1600,
      exactGeometryDrcMaxIterations: 3200,
      exactGeometryDrcBroadMaxIterations: 800,
      residualLocalRerouteMaxCandidateAttempts: 638,
      residualLocalRerouteMaxAcceptedMoves: 16,
    })
    expect(baselineSolver.baselineEffortConfig).toEqual({
      routingEffort: 1,
      highDensityForceStepsPerNode: 20,
      traceSimplificationPipelineLoops: 2,
      globalDrcMaxIterations: 16,
      exactGeometryDrcMaxIterations: 32,
      exactGeometryDrcBroadMaxIterations: 8,
    })
    expect(maxEffortSolver.baselineEffortConfig).toEqual(
      baselineSolver.baselineEffortConfig,
    )
  }

  expect(
    getPipeline7PostProcessingEffortConfig(1e9)
      .residualLocalRerouteMaxCandidateAttempts,
  ).toBe(768)
})
