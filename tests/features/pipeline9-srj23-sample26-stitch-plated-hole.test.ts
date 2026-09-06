import { expect, test } from "bun:test"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { assignUniquePcbTraceIdsToNewTraces } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/assignUniquePcbTraceIdsToNewTraces"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { preparePipeline9DrcRoutedTraces } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/preparePipeline9DrcRoutedTraces"
import {
  evaluateRelaxedDrc,
  type EvaluateRelaxedDrcResult,
} from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteConnection, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

type DrcError = EvaluateRelaxedDrcResult["errors"][number]
type StageObservation = {
  stage: string
  drcCount: number
  platedHoleContactCount: number
  solverStageTimeMs: number
  diagnosticTimeMs: number
}

const isPlatedHoleContact = (error: DrcError): boolean => {
  // Match the benchmark's error-kind classification, not diagnostic ID text.
  return (
    error.type === "pcb_trace_error" &&
    error.message.includes("overlaps with pcb_plated_hole") &&
    error.message.includes("accidental contact")
  )
}

test("Pipeline9 SRJ23 sample26 does not introduce a plated-hole contact after stitching", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj23", 26)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )
  const terminalIds: string[] = ["pcb_port_76", "pcb_port_96"]
  const observations: StageObservation[] = []
  const originalPreloadedTraces: SimplifiedPcbTrace[] = scenario.traces ?? []
  let solverStageTimeMs: number = 0
  let totalSolverTimeMs: number = 0
  let totalDiagnosticTimeMs: number = 0

  const getTargetConnection = (): SimpleRouteConnection => {
    const connection = solver.netToPointPairsSolver!.newConnections.find(
      (candidate): boolean =>
        terminalIds.every((terminalId): boolean =>
          candidate.pointsToConnect.some(
            (point): boolean =>
              point.pcb_port_id === terminalId ||
              point.pointId === terminalId,
          ),
        ),
    )
    if (!connection) {
      throw new Error("Sample26 must retain the pcb_port_76/96 point pair")
    }
    return connection
  }

  const observeOutput = (
    stage: string,
    hdRoutes: HighDensityRoute[],
    finalTraces?: SimplifiedPcbTrace[],
  ): EvaluateRelaxedDrcResult => {
    const diagnosticStart = performance.now()
    const targetConnection = getTargetConnection()
    const routedTraces =
      finalTraces ??
      preparePipeline9DrcRoutedTraces({
        originalPreloadedTraces,
        mutatedPreloadedTraces: solver.getMutatedPreloadedTraces(),
        newTraces: assignUniquePcbTraceIdsToNewTraces(
          convertPipeline7HdRoutesToSimplifiedPcbTraces({
            connections: solver.netToPointPairsSolver!.newConnections,
            originalConnections: solver.originalSrj.connections,
            hdRoutes,
            layerCount: solver.srj.layerCount,
            obstacles: solver.srj.obstacles,
            defaultViaHoleDiameter: solver.viaHoleDiameter,
            connMap: solver.connMap,
          }),
          originalPreloadedTraces,
        ),
      })
    const result = evaluateRelaxedDrc({
      inputSrj: scenario,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
    })
    const targetTraces = routedTraces.filter((trace): boolean =>
      terminalIds.every(
        (terminalId): boolean =>
          trace.connectsTo?.includes(terminalId) === true,
      ),
    )
    const diagnosticTraceIds = new Set<string>(
      targetTraces.map((trace): string => trace.pcb_trace_id),
    )
    for (const error of result.errors) {
      if ("pcb_trace_id" in error && typeof error.pcb_trace_id === "string") {
        diagnosticTraceIds.add(error.pcb_trace_id)
      }
    }
    const platedHoleContactCount = result.errors.filter(
      isPlatedHoleContact,
    ).length
    console.info(
      JSON.stringify({
        diagnostic: "pipeline9-srj23-sample26-stage-drc",
        stage,
        context: finalTraces
          ? "official-final-output"
          : "public-output-reconstruction-with-current-preloads",
        drcCount: result.errors.length,
        platedHoleContactCount,
        errors: result.errors,
        errorsWithCenters: result.errorsWithCenters,
        targetConnection,
        targetHdRoutes: hdRoutes.filter(
          (route): boolean => route.connectionName === targetConnection.name,
        ),
        targetTraces,
        relevantCircuitElements: result.circuitJson.filter(
          (element): boolean => {
            if (element.type === "pcb_trace") {
              return diagnosticTraceIds.has(element.pcb_trace_id)
            }
            if (element.type === "pcb_plated_hole") {
              return element.pcb_plated_hole_id === "pcb_plated_hole_24"
            }
            return (
              element.type === "pcb_smtpad" &&
              element.pcb_smtpad_id === "pcb_smtpad_38"
            )
          },
        ),
        jointStats: solver.pipeline9JointDrcRepairSolver?.stats,
        inheritedStats: solver.pipeline9InheritedDrcRepairSolver?.stats,
      }),
    )
    const diagnosticTimeMs = performance.now() - diagnosticStart
    totalDiagnosticTimeMs += diagnosticTimeMs
    observations.push({
      stage,
      drcCount: result.errors.length,
      platedHoleContactCount,
      solverStageTimeMs,
      diagnosticTimeMs,
    })
    return result
  }

  // Advance one real pipeline only. Diagnostic conversion/checking is outside
  // the timed steps and never supplies geometry back to a routing stage.
  while (!solver.solved && !solver.failed) {
    const stage = solver.getCurrentPhase()
    const stepStart = performance.now()
    solver.step()
    const stepTimeMs = performance.now() - stepStart
    solverStageTimeMs += stepTimeMs
    totalSolverTimeMs += stepTimeMs
    if (solver.getCurrentPhase() === stage) continue

    switch (stage) {
      case "highDensityRepairSolver": {
        const diagnosticStart = performance.now()
        const targetConnection = getTargetConnection()
        // These are unstitched fragments, not complete terminal-to-terminal
        // traces. Do not convert each fragment into a fabricated full trace.
        console.info(
          JSON.stringify({
            diagnostic: "pipeline9-srj23-sample26-pre-stitch-geometry",
            stage,
            targetConnection,
            targetHdFragments: solver.highDensityRepairSolver!
              .getOutput()
              .filter(
                (route): boolean =>
                  route.connectionName === targetConnection.name,
              ),
            solverStageTimeMs,
          }),
        )
        totalDiagnosticTimeMs += performance.now() - diagnosticStart
        break
      }
      case "highDensityStitchSolver":
        observeOutput(stage, solver.highDensityStitchSolver!.mergedHdRoutes)
        break
      case "traceSimplificationSolver":
      case "mutatedPreloadedTraceSimplificationSolver":
        observeOutput(
          stage,
          solver.traceSimplificationSolver!.simplifiedHdRoutes,
        )
        break
      case "traceWidthSolver":
        observeOutput(stage, solver.traceWidthSolver!.getHdRoutesWithWidths())
        break
      case "globalDrcForceImproveSolver":
        observeOutput(stage, solver.globalDrcForceImproveSolver!.getOutput())
        break
      case "pipeline9JointDrcRepairSolver":
        observeOutput(stage, solver.pipeline9JointDrcRepairSolver!.getOutput())
        break
      case "pipeline9InheritedDrcRepairSolver":
        observeOutput(
          stage,
          solver.pipeline9InheritedDrcRepairSolver!.getOutput(),
        )
        break
      case "lengthMatchingPostProcessingSolver":
        observeOutput(stage, solver._getOutputHdRoutes())
        break
    }
    solverStageTimeMs = 0
  }

  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  const finalResult = observeOutput(
    "final",
    solver._getOutputHdRoutes(),
    solver.getOutputSimplifiedPcbTraces(),
  )
  console.info(
    JSON.stringify({
      diagnostic: "pipeline9-srj23-sample26-stage-summary",
      observations,
      firstOfficialCheckpointWithPlatedHoleContact: observations.find(
        (observation): boolean => observation.platedHoleContactCount > 0,
      )?.stage,
      totalSolverTimeMs,
      totalDiagnosticTimeMs,
    }),
  )
  expect(observations.map((observation): string => observation.stage)).toEqual([
    "highDensityStitchSolver",
    "traceSimplificationSolver",
    "mutatedPreloadedTraceSimplificationSolver",
    "traceWidthSolver",
    "globalDrcForceImproveSolver",
    "pipeline9JointDrcRepairSolver",
    "pipeline9InheritedDrcRepairSolver",
    "lengthMatchingPostProcessingSolver",
    "final",
  ])
  // The matched main benchmark has one pad-clearance error, no plated-hole
  // contact. Keep both assertions even if the diagnostic experiment regresses.
  expect(finalResult.errors.length).toBeLessThanOrEqual(1)
  expect(finalResult.errors.filter(isPlatedHoleContact)).toHaveLength(0)
})
