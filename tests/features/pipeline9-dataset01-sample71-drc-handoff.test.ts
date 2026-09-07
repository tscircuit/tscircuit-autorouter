import { expect, test } from "bun:test"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 preserves repaired copper through dataset01 sample 71", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("dataset01", 71)
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
    lengthMatchingPostProcessingSolver: () =>
      solver.lengthMatchingPostProcessingSolver!.getOutput().hdRoutes,
  }
  const logStageDrc = (stage: string, hdRoutes: HighDensityRoute[]): void => {
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
      // Unstitched fragments are not individually terminal-contiguous.
      drcOptions: {
        includeTraceContinuity: false,
        includeBoardEdge: false,
      },
    })
    const errorCountByType: Record<string, number> = {}
    for (const error of errors) {
      const previousCount = errorCountByType[error.type] ?? 0
      errorCountByType[error.type] = previousCount + 1
    }
    console.info(
      JSON.stringify({
        sampleNumber: 71,
        stage,
        copperDrcIssueCount: errors.length,
        errorCountByType,
        traceErrors: errorsWithCenters.filter(
          (error) => error.type === "pcb_trace_error",
        ),
      }),
    )
  }

  while (!solver.solved && !solver.failed) {
    const stage = solver.getCurrentPhase()
    solver.step()
    if (solver.getCurrentPhase() !== stage && stageOutputs[stage]) {
      // Snapshot at the handoff, before downstream solvers can mutate routes.
      logStageDrc(stage, stageOutputs[stage]!())
    }
  }

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  console.info(JSON.stringify({ sampleNumber: 71, stage: "final", errors }))
  expect(errors).toHaveLength(0)
})
