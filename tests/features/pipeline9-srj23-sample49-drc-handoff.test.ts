import { expect, test } from "bun:test"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 preserves SRJ23 sample 49 copper across its high-density precheck", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj23", 49)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )
  const stageOutputs: Record<string, () => HighDensityRoute[]> = {
    highDensityRepairSolver: () => solver.highDensityRepairSolver!.getOutput(),
    highDensityDrcRepairSolver: () =>
      solver.highDensityDrcRepairSolver!.getOutput(),
    highDensityStitchSolver: () =>
      solver.highDensityStitchSolver!.mergedHdRoutes,
    traceSimplificationSolver: () =>
      solver.traceSimplificationSolver!.simplifiedHdRoutes,
    traceWidthSolver: () => solver.traceWidthSolver!.getHdRoutesWithWidths(),
    globalDrcForceImproveSolver: () =>
      solver.globalDrcForceImproveSolver!.getOutput(),
    pipeline9JointDrcRepairSolver: () =>
      solver.pipeline9JointDrcRepairSolver!.getOutput(),
  }
  const logStageCopper = (
    stage: string,
    hdRoutes: HighDensityRoute[],
  ): void => {
    const routedTraces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
      connections: solver.netToPointPairsSolver!.newConnections,
      originalConnections: solver.originalSrj.connections,
      hdRoutes,
      layerCount: solver.srj.layerCount,
      obstacles: solver.srj.obstacles,
      defaultViaHoleDiameter: solver.viaHoleDiameter,
      connMap: solver.connMap,
    })
    const { errors, errorsWithCenters } = evaluateRelaxedDrc({
      inputSrj: scenario,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
      // Diagnose copper before fragments become terminal-contiguous.
      drcOptions: { includeTraceContinuity: false, includeBoardEdge: false },
    })
    console.info(
      JSON.stringify({
        dataset: "srj23",
        sampleNumber: 49,
        stage,
        copperDrcIssueCount: errors.length,
        copperErrors: errorsWithCenters,
        highDensityStats:
          stage === "highDensityDrcRepairSolver"
            ? solver.highDensityDrcRepairSolver!.stats
            : undefined,
      }),
    )
  }

  while (!solver.solved && !solver.failed) {
    const stage = solver.getCurrentPhase()
    solver.step()
    if (solver.getCurrentPhase() !== stage && stageOutputs[stage]) {
      // A skipped precheck's reported zero is not an official DRC result.
      logStageCopper(stage, stageOutputs[stage]!())
    }
  }

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  console.info(
    JSON.stringify({
      dataset: "srj23",
      sampleNumber: 49,
      stage: "final",
      errors,
    }),
  )
  expect(errors.length).toBeLessThanOrEqual(2)
})
