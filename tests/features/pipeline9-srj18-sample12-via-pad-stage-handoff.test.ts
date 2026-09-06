import { expect, test } from "bun:test"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { Pipeline9HighDensityDrcCandidateGate } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcCandidateGate"
import { addAutoroutingViaTraceIds } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { getPipeline9DrcErrorTraceIds } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getBoundsFromNodeWithPortPoints } from "lib/utils/getBoundsFromNodeWithPortPoints"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 repairs SRJ18 sample 12", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 12)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )
  const targetConnectionName = "source_trace_13__source_net_13_mst7"
  let localDiagnosticsInstalled = false
  let candidateDiagnosticTimeMs = 0
  let omittedCandidateDiagnosticCount = 0
  // This is only a log/memory limit, never a candidate or solver-work budget.
  const candidateDiagnosticRecordLimit = 64
  const loggedCandidateGeometry = new Set<string>()
  const installLocalCandidateDiagnostics = (): void => {
    const repair = solver.highDensityDrcRepairSolver
    if (!repair || localDiagnosticsInstalled) return
    const evaluator = repair.params.drcEvaluator
    const evaluateLocalCandidate = evaluator.evaluateLocalCandidate
    if (!evaluateLocalCandidate) {
      throw new Error("Sample12 diagnostics require the production local gate")
    }
    localDiagnosticsInstalled = true
    evaluator.evaluateLocalCandidate = (
      params,
    ): ReturnType<Pipeline9HighDensityDrcCandidateGate> => {
      // Observe the actual production result, never run an extra candidate or
      // checker. Return this exact object so diagnostics cannot alter the gate.
      const result = evaluateLocalCandidate(params)
      const diagnosticStartedAt = performance.now()
      const currentTarget = params.currentRoutes.find(
        (route) =>
          route.connectionName === targetConnectionName &&
          route.regionId === "cmn_244",
      )
      const candidateTarget = params.candidateRoutes.find(
        (route) =>
          route.connectionName === targetConnectionName &&
          route.regionId === "cmn_244",
      )
      if (
        currentTarget &&
        candidateTarget &&
        JSON.stringify(currentTarget) !== JSON.stringify(candidateTarget)
      ) {
        const geometryKey = JSON.stringify([
          repair.stats.acceptedRepairCount,
          currentTarget,
          candidateTarget,
          result.currentErrors,
          result.candidateErrors,
        ])
        if (loggedCandidateGeometry.size >= candidateDiagnosticRecordLimit) {
          omittedCandidateDiagnosticCount++
        } else if (!loggedCandidateGeometry.has(geometryKey)) {
          loggedCandidateGeometry.add(geometryKey)
          const candidateParticipants = new Set(
            result.candidateErrors.flatMap(getPipeline9DrcErrorTraceIds),
          )
          console.info(
            JSON.stringify({
              dataset: "srj18",
              sampleNumber: 12,
              stage: "highDensityDrcRepairSolver",
              event: "pad397-local-candidate",
              activeNodeId: repair.activeNode?.capacityMeshNodeId,
              acceptedRepairCount: repair.stats.acceptedRepairCount,
              nodeRepairAttemptCount: repair.stats.nodeRepairAttemptCount,
              changedTraceIds: [...params.changedTraceIds],
              currentTarget,
              candidateTarget,
              currentLocalErrors: result.currentErrors,
              candidateLocalErrors: result.candidateErrors,
              candidateErrorPairsAreUnambiguous:
                result.candidateErrorPairsAreUnambiguous,
              // A scoped candidate is also compared with the full incumbent's
              // physical pairs. Include its participants' current errors.
              participantCurrentErrors: repair.currentErrors.filter((error) =>
                getPipeline9DrcErrorTraceIds(error).some((traceId) =>
                  candidateParticipants.has(traceId),
                ),
              ),
            }),
          )
        }
      }
      candidateDiagnosticTimeMs += performance.now() - diagnosticStartedAt
      return result
    }
  }
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
        sampleNumber: 12,
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
        excludedCandidateDiagnosticTimeMs: candidateDiagnosticTimeMs,
        candidateDiagnosticRecordCount: loggedCandidateGeometry.size,
        omittedCandidateDiagnosticCount,
        // Stage elapsed excludes observer work. Raw callback/nested reroute
        // timers belong to the solver and include it; do not rewrite stats.
        rawStatsIncludeCandidateDiagnosticTime:
          stage === "highDensityDrcRepairSolver",
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
    const isHighDensityHandoff =
      stage === "highDensityRepairSolver" ||
      stage === "highDensityDrcRepairSolver"
    const targetPads = circuitJson.filter(
      (element) =>
        element.type === "pcb_smtpad" &&
        element.pcb_smtpad_id === "pcb_smtpad_397",
    )
    let targetFragmentIndex = 0
    for (const [globalRouteIndex, route] of hdRoutes.entries()) {
      if (route.connectionName !== targetConnectionName) continue
      const traceId = `${targetConnectionName}_${targetFragmentIndex++}`
      const node = isHighDensityHandoff
        ? solver.highDensityNodePortPoints?.find(
            (candidate) => candidate.capacityMeshNodeId === route.regionId,
          )
        : undefined
      // One target fragment per record avoids oversized all-board geometry
      // logs. Original topology is labeled explicitly: accepted seam moves
      // update the HD repair solver's private nodes, not these caller inputs.
      console.info(
        JSON.stringify({
          dataset: "srj18",
          sampleNumber: 12,
          stage,
          event: "pad397-target-geometry",
          globalRouteIndex,
          traceId,
          hdRoute: route,
          serializedTraces: routedTraces.filter(
            (trace) => trace.pcb_trace_id === traceId,
          ),
          targetPads,
          targetErrors: ownedCopperErrors.filter((error) =>
            getPipeline9DrcErrorTraceIds(error).includes(traceId),
          ),
          originalNode: node
            ? {
                capacityMeshNodeId: node.capacityMeshNodeId,
                center: node.center,
                width: node.width,
                height: node.height,
                availableZ: node.availableZ,
                nativeBounds: getBoundsFromNodeWithPortPoints(node),
                totalPortPointCount: node.portPoints.length,
                targetPortPoints: node.portPoints.filter(
                  (point) => point.connectionName === targetConnectionName,
                ),
                targetPortPointsInPairs: node.portPointsInPairs?.filter(
                  (pair) =>
                    pair.some(
                      (point) => point.connectionName === targetConnectionName,
                    ),
                ),
              }
            : undefined,
        }),
      )
    }
    console.info(
      JSON.stringify({
        dataset: "srj18",
        sampleNumber: 12,
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
    installLocalCandidateDiagnostics()
    const priorCandidateDiagnosticTimeMs = candidateDiagnosticTimeMs
    const stepStartedAt = performance.now()
    solver.step()
    // Diagnostic DRC and logging time are excluded from solver-stage timings.
    stageElapsedTimeMs +=
      performance.now() -
      stepStartedAt -
      (candidateDiagnosticTimeMs - priorCandidateDiagnosticTimeMs)
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
      sampleNumber: 12,
      stage: "final",
      errors,
    }),
  )
  expect(errors).toHaveLength(0)
})
