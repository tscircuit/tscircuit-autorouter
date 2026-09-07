import { expect, test } from "bun:test"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { assignUniquePcbTraceIdsToNewTraces } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/assignUniquePcbTraceIdsToNewTraces"
import type { Pipeline9HighDensityDrcCandidateGate } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcCandidateGate"
import { isPipeline9HighDensityDrcCandidateBetter } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/isPipeline9HighDensityDrcCandidateBetter"
import { normalizePipeline9DrcErrorsForRepair } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/normalizePipeline9DrcErrorsForRepair"
import {
  getPipeline9DrcErrors,
  getPipeline9DrcErrorTraceIds,
  getPipeline9RouteIndexByTraceId,
  isPipeline9DrcCandidateBetter,
  type Pipeline9DrcError,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import { preparePipeline9DrcRoutedTraces } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/preparePipeline9DrcRoutedTraces"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 diagnoses remaining SRJ23 sample 43 copper by ownership", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj23", 43)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )
  const originalTraceIds = new Set(
    scenario.traces?.map((trace) => trace.pcb_trace_id),
  )
  let localDiagnosticsInstalled = false
  let firstLocalRejectionCaptured = false
  let initialHdCopperCaptured = false
  let candidateDiagnosticTimeMs = 0
  const logCopper = (
    stage: string,
    routedTraces: SimplifiedPcbTrace[],
    elapsedTimeMs: number,
  ): number => {
    const { errors, errorsWithCenters, circuitJson } = evaluateRelaxedDrc({
      inputSrj: scenario,
      srjWithPointPairs:
        stage === "original-preloaded" ? scenario : solver.srjWithPointPairs!,
      routedTraces,
      drcOptions:
        stage === "final"
          ? undefined
          : { includeTraceContinuity: false, includeBoardEdge: false },
    })
    const routedTracesById = new Map(
      routedTraces.map((trace) => [trace.pcb_trace_id, trace]),
    )
    const evaluatedTraceIds = new Set(
      circuitJson.flatMap((element): string[] =>
        element.type === "pcb_trace" ? [element.pcb_trace_id] : [],
      ),
    )
    const normalizedErrors = normalizePipeline9DrcErrorsForRepair({
      errors: errorsWithCenters.map(
        (error): Pipeline9DrcError => ({ ...error }),
      ),
      circuitJson,
      newTraceIds: new Set(routedTracesById.keys()),
    })
    console.info(
      JSON.stringify({
        dataset: "srj23",
        sampleNumber: 43,
        stage,
        event: "copper-handoff",
        evaluationContext:
          stage === "original-preloaded" || stage === "final"
            ? "official-public-output"
            : "public-output-reconstruction-with-current-preloads",
        elapsedTimeMs,
        copperDrcIssueCount: errors.length,
        originalPreloadedTraceCount: originalTraceIds.size,
        stageRoutedTraceCount: routedTraces.length,
        firstLocalRejectionCaptured,
        excludedCandidateDiagnosticTimeMs: candidateDiagnosticTimeMs,
        rawStatsIncludeCandidateDiagnosticTime:
          stage === "highDensityDrcRepairSolver",
        highDensityStats:
          stage === "highDensityDrcRepairSolver"
            ? solver.highDensityDrcRepairSolver!.stats
            : undefined,
      }),
    )
    for (const [errorIndex, error] of errorsWithCenters.entries()) {
      const traceIds = getPipeline9DrcErrorTraceIds(
        normalizedErrors[errorIndex]!,
      ).filter((traceId): boolean => evaluatedTraceIds.has(traceId))
      console.info(
        JSON.stringify({
          dataset: "srj23",
          sampleNumber: 43,
          stage,
          event: "copper-error",
          errorIndex,
          // Preserve the original official error. Normalization is used only
          // to resolve actual trace/via owners for this diagnostic inventory.
          error,
          traceParticipants: traceIds.map((traceId) => ({
            pcbTraceId: traceId,
            presentInOriginalPreloaded: originalTraceIds.has(traceId),
            presentInStageRoutes: routedTracesById.has(traceId),
            replacesOriginalTraceId:
              routedTracesById.get(traceId)?.__replaces_pcb_trace_id,
          })),
        }),
      )
    }
    return errors.length
  }
  const logProductionHdCopper = (
    checkpoint: "initial" | "complete",
    elapsedTimeMs: number,
  ): void => {
    const repair = solver.highDensityDrcRepairSolver!
    // Initialization and every published incumbent already have a full
    // result cached for this exact array. Never reconstruct frozen sections
    // from original preloads while they are still unstitched fragments.
    const errors = getPipeline9DrcErrors(
      repair.params.drcEvaluator,
      repair.outputHdRoutes,
    )
    const ownedRouteIndexByTraceId = getPipeline9RouteIndexByTraceId({
      routes: repair.outputHdRoutes,
      newConnections: repair.params.newConnections,
      syntheticConnectionNames: new Set<string>(),
    })
    console.info(
      JSON.stringify({
        dataset: "srj23",
        sampleNumber: 43,
        stage: "highDensityDrcRepairSolver",
        event: "copper-handoff",
        evaluationContext: "cached-production-pre-stitch-evaluator",
        checkpoint,
        elapsedTimeMs,
        copperDrcIssueCount: errors.length,
        ownedCopperDrcIssueCount: repair.currentErrors.length,
        originalPreloadedTraceCount: originalTraceIds.size,
        fixedHdRouteCount: repair.params.fixedHdRoutes.length,
        highDensityStats: repair.stats,
        excludedCandidateDiagnosticTimeMs: candidateDiagnosticTimeMs,
        rawStatsIncludeCandidateDiagnosticTime: true,
      }),
    )
    for (const [errorIndex, error] of errors.entries()) {
      const traceIds = getPipeline9DrcErrorTraceIds(error).filter(
        (traceId): boolean =>
          !Array.isArray(error.__pad_ids) || !error.__pad_ids.includes(traceId),
      )
      console.info(
        JSON.stringify({
          dataset: "srj23",
          sampleNumber: 43,
          stage: "highDensityDrcRepairSolver",
          event: "copper-error",
          evaluationContext: "cached-production-pre-stitch-evaluator",
          checkpoint,
          errorIndex,
          error,
          // Preserve opaque frozen-fragment IDs; do not guess the original
          // preloaded ID by stripping a suffix or equate unowned with absent.
          traceParticipants: traceIds.map((traceId) => ({
            pcbTraceId: traceId,
            ownedByHighDensity: ownedRouteIndexByTraceId.has(traceId),
            presentInOriginalPreloaded: originalTraceIds.has(traceId),
          })),
        }),
      )
    }
  }
  const installLocalCandidateDiagnostics = (): void => {
    const repair = solver.highDensityDrcRepairSolver
    if (!repair || localDiagnosticsInstalled) return
    const evaluator = repair.params.drcEvaluator
    const evaluateLocalCandidate = evaluator.evaluateLocalCandidate
    if (!evaluateLocalCandidate) {
      throw new Error("SRJ23 diagnostics require the production local gate")
    }
    localDiagnosticsInstalled = true
    evaluator.evaluateLocalCandidate = (
      params,
    ): ReturnType<Pipeline9HighDensityDrcCandidateGate> => {
      const result = evaluateLocalCandidate(params)
      if (firstLocalRejectionCaptured) return result
      const diagnosticStartedAt = performance.now()
      const routeIndexByTraceId = getPipeline9RouteIndexByTraceId({
        routes: params.candidateRoutes,
        newConnections: repair.params.newConnections,
        syntheticConnectionNames: new Set<string>(),
      })
      const isOwnedError = (error: Pipeline9DrcError): boolean =>
        getPipeline9DrcErrorTraceIds(error).some((traceId): boolean =>
          routeIndexByTraceId.has(traceId),
        )
      const ownedCurrentErrors = result.currentErrors.filter(isOwnedError)
      const ownedCandidateErrors = result.candidateErrors.filter(isOwnedError)
      const improvesLocalScore = isPipeline9DrcCandidateBetter(
        ownedCandidateErrors,
        ownedCurrentErrors,
      )
      const passesIncumbentLowerBound =
        !result.candidateErrorPairsAreUnambiguous ||
        isPipeline9HighDensityDrcCandidateBetter(
          ownedCandidateErrors,
          repair.currentErrors,
        )
      if (!improvesLocalScore || !passesIncumbentLowerBound) {
        firstLocalRejectionCaptured = true
        console.info(
          JSON.stringify({
            dataset: "srj23",
            sampleNumber: 43,
            stage: "highDensityDrcRepairSolver",
            event: "first-local-rejection",
            activeNode: repair.activeNode,
            changedTraceIds: [...params.changedTraceIds],
            improvesLocalScore,
            passesIncumbentLowerBound,
            candidateErrorPairsAreUnambiguous:
              result.candidateErrorPairsAreUnambiguous,
            nodeRepairAttemptCount: repair.stats.nodeRepairAttemptCount,
            // This observes the scoped rejection only. It cannot observe
            // pre-yield geometry rejection or replace full-board validation.
          }),
        )
        for (const [state, stateErrors] of [
          ["current-local", result.currentErrors],
          ["candidate-local", result.candidateErrors],
          ["current-board-owned", repair.currentErrors],
        ] as const) {
          for (const [errorIndex, error] of stateErrors.entries()) {
            console.info(
              JSON.stringify({
                dataset: "srj23",
                sampleNumber: 43,
                stage: "highDensityDrcRepairSolver",
                event: "first-local-rejection-error",
                state,
                errorIndex,
                error,
                participantTraceIds: getPipeline9DrcErrorTraceIds(error),
              }),
            )
          }
        }
        for (const [traceId, routeIndex] of routeIndexByTraceId) {
          if (!params.changedTraceIds.has(traceId)) continue
          console.info(
            JSON.stringify({
              dataset: "srj23",
              sampleNumber: 43,
              stage: "highDensityDrcRepairSolver",
              event: "first-local-rejection-route",
              traceId,
              routeIndex,
              currentRoute: params.currentRoutes[routeIndex],
              candidateRoute: params.candidateRoutes[routeIndex],
            }),
          )
        }
      }
      candidateDiagnosticTimeMs += performance.now() - diagnosticStartedAt
      // Return the exact already-computed result; never invoke another
      // evaluator, candidate generator, or repair pass from this observer.
      return result
    }
  }
  const stageOutputs: Record<string, () => HighDensityRoute[]> = {
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
  // One original-copper check distinguishes input defects from new routing.
  logCopper("original-preloaded", [], 0)
  let stageElapsedTimeMs = 0
  while (!solver.solved && !solver.failed) {
    const stage = solver.getCurrentPhase()
    installLocalCandidateDiagnostics()
    const priorDiagnosticTimeMs = candidateDiagnosticTimeMs
    const stepStartedAt = performance.now()
    solver.step()
    stageElapsedTimeMs +=
      performance.now() -
      stepStartedAt -
      (candidateDiagnosticTimeMs - priorDiagnosticTimeMs)
    if (
      stage === "highDensityDrcRepairSolver" &&
      !initialHdCopperCaptured &&
      solver.highDensityDrcRepairSolver!.iterations > 0
    ) {
      // The first HD step only initializes its official error result and
      // returns; no candidate can run before this checkpoint is captured.
      initialHdCopperCaptured = true
      logProductionHdCopper("initial", stageElapsedTimeMs)
    }
    if (solver.getCurrentPhase() === stage) continue
    if (stage === "highDensityDrcRepairSolver") {
      logProductionHdCopper("complete", stageElapsedTimeMs)
    }
    if (stageOutputs[stage]) {
      const routedTraces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
        connections: solver.netToPointPairsSolver!.newConnections,
        originalConnections: solver.originalSrj.connections,
        hdRoutes: stageOutputs[stage]!(),
        layerCount: solver.srj.layerCount,
        obstacles: solver.srj.obstacles,
        defaultViaHoleDiameter: solver.viaHoleDiameter,
        connMap: solver.connMap,
      })
      const preparedTraces = preparePipeline9DrcRoutedTraces({
        originalPreloadedTraces: scenario.traces ?? [],
        mutatedPreloadedTraces: solver.getMutatedPreloadedTraces(),
        newTraces: assignUniquePcbTraceIdsToNewTraces(
          routedTraces,
          scenario.traces ?? [],
        ),
      })
      logCopper(stage, preparedTraces, stageElapsedTimeMs)
    }
    stageElapsedTimeMs = 0
  }
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(initialHdCopperCaptured).toBeTrue()
  const finalErrorCount = logCopper(
    "final",
    solver.getOutputSimplifiedPcbTraces(),
    0,
  )
  // Current e1 same-machine evidence is one, not a claimed new repair.
  expect(finalErrorCount).toBeLessThanOrEqual(1)
})
