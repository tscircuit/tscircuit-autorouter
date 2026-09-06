import { expect, test } from "bun:test"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { addAutoroutingViaTraceIds } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { getPipeline9DrcErrorTraceIds } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 bounds SRJ18 sample 13's high-residual precision pass", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 13)
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
  const logStageProgress = (
    stage: string,
    event: string,
    elapsedTimeMs: number,
  ): void => {
    const repairSolver =
      stage === "highDensityDrcRepairSolver"
        ? solver.highDensityDrcRepairSolver
        : stage === "globalDrcForceImproveSolver"
          ? solver.globalDrcForceImproveSolver
          : stage === "pipeline9JointDrcRepairSolver"
            ? solver.pipeline9JointDrcRepairSolver
            : undefined
    console.info(
      JSON.stringify({
        dataset: "srj18",
        sampleNumber: 13,
        stage,
        event,
        elapsedTimeMs,
        iterations: repairSolver?.iterations,
        activeSubSolver:
          solver.activeSubSolver?.activeSubSolver?.getSolverName(),
        activeNodeId:
          stage === "highDensityDrcRepairSolver"
            ? solver.highDensityDrcRepairSolver?.activeNode?.capacityMeshNodeId
            : undefined,
        stats: repairSolver?.stats,
      }),
    )
  }
  const logStageCopper = (
    stage: string,
    hdRoutes: HighDensityRoute[],
  ): void => {
    const diagnosticStartedAt = performance.now()
    const routedTraces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
      connections: solver.netToPointPairsSolver!.newConnections,
      originalConnections: solver.originalSrj.connections,
      hdRoutes,
      layerCount: solver.srj.layerCount,
      obstacles: solver.srj.obstacles,
      defaultViaHoleDiameter: solver.viaHoleDiameter,
      connMap: solver.connMap,
    })
    const { errors, errorsWithCenters, circuitJson } = evaluateRelaxedDrc({
      inputSrj: scenario,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
      // Handoff fragments are not individually terminal-contiguous.
      drcOptions: { includeTraceContinuity: false, includeBoardEdge: false },
    })
    const ownedTraceIds = new Set(
      routedTraces.map((trace) => trace.pcb_trace_id),
    )
    const ownedCopperErrors = addAutoroutingViaTraceIds({
      errors: errorsWithCenters as unknown as Record<string, unknown>[],
      circuitJson,
      evaluatedTraceIds: ownedTraceIds,
    }).filter((error) =>
      getPipeline9DrcErrorTraceIds(error).some((id) => ownedTraceIds.has(id)),
    )
    const errorCountByType: Record<string, number> = {}
    for (const error of errors) {
      errorCountByType[error.type] = (errorCountByType[error.type] ?? 0) + 1
    }
    console.info(
      JSON.stringify({
        dataset: "srj18",
        sampleNumber: 13,
        stage,
        event: "copper-handoff",
        diagnosticElapsedTimeMs: performance.now() - diagnosticStartedAt,
        copperDrcIssueCount: errors.length,
        errorCountByType,
        ownedCopperErrors,
      }),
    )
  }
  let stageElapsedTimeMs = 0
  // Logarithmic pass milestones and sparse elapsed-time reports only log;
  // neither imposes a timeout nor changes solver search or acceptance.
  let nextProgressElapsedTimeMs = 30_000
  let nextNodePassProgress = 1
  logStageProgress(solver.getCurrentPhase(), "start", 0)
  while (!solver.solved && !solver.failed) {
    const stage = solver.getCurrentPhase()
    const stepStartedAt = performance.now()
    solver.step()
    // Diagnostic DRC and logging time are excluded from solver-stage timings.
    stageElapsedTimeMs += performance.now() - stepStartedAt
    if (solver.getCurrentPhase() !== stage) {
      logStageProgress(stage, "complete", stageElapsedTimeMs)
      if (stageOutputs[stage]) logStageCopper(stage, stageOutputs[stage]!())
      stageElapsedTimeMs = 0
      nextProgressElapsedTimeMs = 30_000
      logStageProgress(solver.getCurrentPhase(), "start", 0)
      continue
    }
    const nodePassCount =
      stage === "highDensityDrcRepairSolver"
        ? Number(
            solver.highDensityDrcRepairSolver?.stats.nodeRepairAttemptCount,
          )
        : 0
    if (
      stageElapsedTimeMs >= nextProgressElapsedTimeMs ||
      nodePassCount >= nextNodePassProgress
    ) {
      logStageProgress(stage, "progress", stageElapsedTimeMs)
      nextProgressElapsedTimeMs = stageElapsedTimeMs + 30_000
      while (nextNodePassProgress <= nodePassCount) nextNodePassProgress *= 2
    }
  }
  if (solver.failed) {
    logStageProgress(solver.getCurrentPhase(), "failed", stageElapsedTimeMs)
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
      dataset: "srj18",
      sampleNumber: 13,
      stage: "final",
      errors,
    }),
  )
  const repairStats = solver.pipeline9JointDrcRepairSolver?.stats
  expect(Number(repairStats?.postExactIndexedDrcIssueCount)).toBeGreaterThan(16)
  expect(repairStats).toMatchObject({
    postExactPrecisionPassMaxIndexedIssueCount: 16,
    postExactPrecisionPassAttempted: false,
    postExactReferenceValidationAttempted: false,
    postExactReferenceValidationSkippedForIndexedIssueCount: true,
    postExactReferenceAccepted: false,
    terminalEscapeSkippedForIndexedIssueCount: true,
    terminalEscapeCandidateCount: 0,
    terminalEscapeAcceptedCount: 0,
    regionalB01RepairAttempted: false,
    regionalB01RepairCandidateSearchCount: 0,
  })
  expect(
    Number(repairStats?.regionalB01RepairRemainingDrcIssueCount),
  ).toBeGreaterThan(16)
  expect(errors.length).toBeGreaterThan(0)
}, 300_000)
