import { expect, test } from "bun:test"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 preserves SRJ18 sample 9's reference-clean exact output", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 9)
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
  while (!solver.solved && !solver.failed) {
    const stage = solver.getCurrentPhase()
    solver.step()
    if (solver.getCurrentPhase() === stage || !stageOutputs[stage]) continue
    const routedTraces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
      connections: solver.netToPointPairsSolver!.newConnections,
      originalConnections: solver.originalSrj.connections,
      hdRoutes: stageOutputs[stage]!(),
      layerCount: solver.srj.layerCount,
      obstacles: solver.srj.obstacles,
      defaultViaHoleDiameter: solver.viaHoleDiameter,
      connMap: solver.connMap,
    })
    const { errorsWithCenters } = evaluateRelaxedDrc({
      inputSrj: scenario,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
      drcOptions: { includeTraceContinuity: false, includeBoardEdge: false },
    })
    console.info(
      JSON.stringify({
        dataset: "srj18",
        sampleNumber: 9,
        stage,
        copperErrors: errorsWithCenters,
        highDensityStats:
          stage === "highDensityDrcRepairSolver"
            ? solver.highDensityDrcRepairSolver!.stats
            : undefined,
      }),
    )
  }

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  console.info(
    JSON.stringify({ dataset: "srj18", sampleNumber: 9, stage: "final", errors }),
  )
  // Check the actual final copper before asserting the internal repair path.
  expect(errors).toHaveLength(0)
  const repairStats = solver.pipeline9JointDrcRepairSolver?.stats
  expect(Number(repairStats?.finalDrcIssueCount)).toBeGreaterThan(0)
  expect(repairStats).toMatchObject({
    postExactPrecisionPassAttempted: true,
    postExactReferenceValidationAttempted: true,
    postExactReferenceValidationSkippedForIndexedIssueCount: false,
    postExactReferenceDrcIssueCount: 0,
    postExactReferenceAccepted: true,
    terminalEscapeSkippedForIndexedIssueCount: false,
    terminalEscapeCandidateCount: 0,
    terminalEscapeAcceptedCount: 0,
    regionalB01RepairAttempted: false,
    regionalB01RepairCandidateSearchCount: 0,
  })
})
