import { expect, test } from "bun:test"
import type { PcbVia } from "circuit-json"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { Pipeline9HighDensityDrcCandidateGate } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcCandidateGate"
import { addAutoroutingViaTraceIds } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import {
  getPipeline9DrcErrorTraceIds,
  getPipeline9RouteIndexByTraceId,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
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
  const getDiagnosticCircuitJson = (
    hdRoutes: HighDensityRoute[],
  ): ReturnType<typeof convertToCircuitJson> => {
    const routedTraces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
      connections: solver.netToPointPairsSolver!.newConnections,
      originalConnections: solver.originalSrj.connections,
      hdRoutes,
      layerCount: solver.srj.layerCount,
      obstacles: solver.srj.obstacles,
      defaultViaHoleDiameter: solver.viaHoleDiameter,
      connMap: solver.connMap,
    })
    // Match evaluateRelaxedDrc's public conversion, without calling a checker.
    // The wrapper verifies this fixture has no original or frozen preload.
    return convertToCircuitJson(solver.srjWithPointPairs!, routedTraces, {
      minTraceWidth: scenario.minTraceWidth,
      minViaDiameter: scenario.minViaDiameter,
      originalSrj: scenario,
      includeOriginalConnections: true,
    })
  }
  const installLocalCandidateDiagnostics = (): void => {
    const repair = solver.highDensityDrcRepairSolver
    if (!repair || localDiagnosticsInstalled) return
    if (
      (scenario.traces?.length ?? 0) !== 0 ||
      repair.params.fixedHdRoutes.length !== 0
    ) {
      throw new Error("Sample12 diagnostics require no preloaded traces")
    }
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
          const candidateRecordIndex = loggedCandidateGeometry.size - 1
          const candidateParticipants = new Set(
            result.candidateErrors.flatMap(getPipeline9DrcErrorTraceIds),
          )
          console.info(
            JSON.stringify({
              dataset: "srj18",
              sampleNumber: 12,
              stage: "highDensityDrcRepairSolver",
              event: "pad397-local-candidate",
              candidateRecordIndex,
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
          const reportedViaIds = new Set<string>()
          for (const error of [
            ...result.currentErrors,
            ...result.candidateErrors,
          ]) {
            if (typeof error.pcb_via_id === "string") {
              reportedViaIds.add(error.pcb_via_id)
            }
            if (!Array.isArray(error.pcb_via_ids)) continue
            for (const viaId of error.pcb_via_ids) {
              if (typeof viaId === "string") reportedViaIds.add(viaId)
            }
          }
          for (const [state, routes, targetRoute] of [
            ["current", params.currentRoutes, currentTarget],
            ["candidate", params.candidateRoutes, candidateTarget],
          ] as const) {
            const circuitJson = getDiagnosticCircuitJson(routes)
            const routeIndexByTraceId = getPipeline9RouteIndexByTraceId({
              routes,
              newConnections: solver.netToPointPairsSolver!.newConnections,
              syntheticConnectionNames: new Set<string>(),
            })
            const targetRouteIndex = routes.indexOf(targetRoute)
            const targetTraces = circuitJson.filter(
              (element): boolean =>
                element.type === "pcb_trace" &&
                routeIndexByTraceId.get(element.pcb_trace_id) ===
                  targetRouteIndex,
            )
            if (targetTraces.length !== 1) {
              throw new Error(
                "Sample12 target must map to one serialized trace",
              )
            }
            const viasByOwnerTraceId = new Map<string, PcbVia[]>()
            const missingViaIds = new Set(reportedViaIds)
            for (const element of circuitJson) {
              if (
                element.type !== "pcb_via" ||
                !reportedViaIds.has(element.pcb_via_id)
              ) {
                continue
              }
              missingViaIds.delete(element.pcb_via_id)
              if (
                !("pcb_trace_id" in element) ||
                typeof element.pcb_trace_id !== "string"
              ) {
                throw new Error("Sample12 reported via must have a trace owner")
              }
              const ownerVias = viasByOwnerTraceId.get(element.pcb_trace_id)
              if (ownerVias) ownerVias.push(element)
              else viasByOwnerTraceId.set(element.pcb_trace_id, [element])
            }
            console.info(
              JSON.stringify({
                dataset: "srj18",
                sampleNumber: 12,
                stage: "highDensityDrcRepairSolver",
                event: "pad397-local-candidate-target-copper",
                candidateRecordIndex,
                state,
                serializedTargetTrace: targetTraces[0],
                reportedViaIds: [...reportedViaIds],
                missingReportedViaIds: [...missingViaIds],
              }),
            )
            // One exact owner fragment per record keeps related-copper context
            // bounded in line size. Via IDs are looked up, never decoded.
            for (const [ownerTraceId, vias] of viasByOwnerTraceId) {
              const ownerRouteIndex = routeIndexByTraceId.get(ownerTraceId)
              const ownerTrace = circuitJson.find(
                (element): boolean =>
                  element.type === "pcb_trace" &&
                  element.pcb_trace_id === ownerTraceId,
              )
              if (ownerRouteIndex === undefined || !ownerTrace) {
                throw new Error(
                  "Sample12 via owner must map to its HD fragment",
                )
              }
              console.info(
                JSON.stringify({
                  dataset: "srj18",
                  sampleNumber: 12,
                  stage: "highDensityDrcRepairSolver",
                  event: "pad397-local-candidate-via-owner-copper",
                  candidateRecordIndex,
                  state,
                  ownerTraceId,
                  ownerRouteIndex,
                  hdRoute: routes[ownerRouteIndex],
                  serializedOwnerTrace: ownerTrace,
                  vias,
                }),
              )
            }
          }
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
