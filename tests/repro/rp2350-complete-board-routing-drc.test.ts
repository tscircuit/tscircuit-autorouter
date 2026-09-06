import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import type { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { BaseSolver } from "lib/solvers/BaseSolver"
import {
  combinePreloadedAndRoutedTraces,
  evaluateRelaxedDrc,
  type EvaluateRelaxedDrcResult,
} from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import srj from "../../fixtures/repro/rp2350-complete-board-drc/rp2350-normal-core-phase.srj.json" with {
  type: "json",
}

type DiagnosticSolver = Pick<BaseSolver, "getSolverName" | "iterations">

test("Pipeline9 routes the normal RP2350 core phase without DRC errors", (): void => {
  const input: SimpleRouteJson = structuredClone(srj) as SimpleRouteJson
  const solver: AutoroutingPipelineSolver9_PreloadedTraceGraph =
    new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
      cacheProvider: null,
      effort: 1,
    })

  const startedAt: number = Date.now()
  let loggedPhase: string | null = null
  let loggedNode: NodeWithPortPoints | null = null
  let loggedHdSolver: DiagnosticSolver | null = null
  let loggedRegionalStage: DiagnosticSolver | null = null

  // Match BaseSolver.solve, logging transitions before potentially long steps.
  while (!solver.solved && !solver.failed) {
    const phase: string = solver.getCurrentPhase()
    if (phase !== loggedPhase) {
      console.info("RP2350 phase-start", {
        phase,
        previousPhase: loggedPhase,
        previousPhaseMs:
          loggedPhase === null
            ? undefined
            : solver.timeSpentOnPhase[loggedPhase],
        elapsedMs: Date.now() - startedAt,
        iterations: solver.iterations,
      })
      loggedPhase = phase
    }

    const hdSolver: Pipeline9HighDensitySolver | undefined =
      solver.highDensityRouteSolver
    if (hdSolver && solver.activeSubSolver === hdSolver) {
      const activeHdSolver: DiagnosticSolver | null =
        hdSolver.activeFallbackSolver ??
        hdSolver.activeRegularSolver ??
        hdSolver.activeB01Solver
      const node: NodeWithPortPoints | null =
        hdSolver.activeNode ??
        (activeHdSolver === null
          ? (hdSolver.unsolvedNodePortPoints.at(-1) ?? null)
          : null)
      if (node !== null && node !== loggedNode) {
        const nodeDiagnostic: string = JSON.stringify({
          nodeId: node.capacityMeshNodeId,
          portCount: node.portPoints.length,
          nodeWithPortPoints: node,
          traceWidth: hdSolver.traceWidth,
          viaDiameter: hdSolver.viaDiameter,
          obstacleMargin: hdSolver.obstacleMargin,
          viaToPadClearance: hdSolver.viaToPadClearance,
          layerCount: hdSolver.layerCount,
          effort: hdSolver.effort,
          nodePf: hdSolver.nodePfById.get(node.capacityMeshNodeId),
          fixedRouteCount: hdSolver.fixedHdRoutes.length,
          boardObstacleCount: hdSolver.obstacles.length,
          elapsedMs: Date.now() - startedAt,
          iterations: hdSolver.iterations,
        })
        console.info("RP2350 node-start", nodeDiagnostic)
        loggedNode = node
      }

      const regionalStage: DiagnosticSolver | null =
        hdSolver.activeFallbackSolver?.activeSubSolver ?? null
      if (
        activeHdSolver !== loggedHdSolver ||
        regionalStage !== loggedRegionalStage
      ) {
        if (activeHdSolver !== null) {
          const solverDiagnostic: string = JSON.stringify({
            nodeId: node?.capacityMeshNodeId,
            solver: activeHdSolver.getSolverName(),
            regionalStage: regionalStage?.getSolverName(),
            regionalReason: hdSolver.activeFallbackReason,
            regionalNodeWithPortPoints:
              hdSolver.activeFallbackSolver !== loggedHdSolver
                ? hdSolver.activeFallbackSolver?.params.nodeWithPortPoints
                : undefined,
            elapsedMs: Date.now() - startedAt,
            iterations: activeHdSolver.iterations,
          })
          console.info("RP2350 node-solver-start", solverDiagnostic)
        }
        loggedHdSolver = activeHdSolver
        loggedRegionalStage = regionalStage
      }
    }

    solver.step()
  }
  solver.timeToSolve = Date.now() - startedAt
  console.info("RP2350 solve-end", {
    solved: solver.solved,
    failed: solver.failed,
    phase: solver.getCurrentPhase(),
    elapsedMs: solver.timeToSolve,
    iterations: solver.iterations,
  })

  expect(solver.error).toBeNull()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  if (!solver.srjWithPointPairs) {
    throw new Error("Pipeline9 did not produce point-pair SRJ")
  }

  console.info(
    "RP2350 repair stats",
    JSON.stringify({
      joint: solver.pipeline9JointDrcRepairSolver?.stats,
      postRepairPointCount:
        solver.postRepairTraceSimplificationSolver?.simplifiedHdRoutes.reduce(
          (sum, route): number => sum + route.route.length,
          0,
        ),
    }),
  )
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const { errors, circuitJson }: EvaluateRelaxedDrcResult = evaluateRelaxedDrc({
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs,
    routedTraces,
    drcOptions: {
      traceClearance: 0.1,
      viaClearance: 0.1,
    },
  })

  for (const error of errors) {
    const errorDiagnostic: string = JSON.stringify(error)
    console.error("RP2350 DRC", errorDiagnostic)
  }
  const geometricErrors = errors.filter(
    (error): boolean => !error.message.includes("disconnected endpoint"),
  )
  const affectedViaIds: Set<string> = new Set(
    geometricErrors.flatMap((error): string[] =>
      "pcb_via_id" in error && typeof error.pcb_via_id === "string"
        ? [error.pcb_via_id]
        : [],
    ),
  )
  const affectedTraceIds: Set<string> = new Set(
    geometricErrors.flatMap((error): string[] =>
      "pcb_trace_id" in error && typeof error.pcb_trace_id === "string"
        ? [error.pcb_trace_id]
        : [],
    ),
  )
  for (const element of circuitJson) {
    if (element.type !== "pcb_via" || !affectedViaIds.has(element.pcb_via_id)) {
      continue
    }
    console.error("RP2350 affected via", JSON.stringify(element))
    if ("pcb_trace_id" in element && typeof element.pcb_trace_id === "string") {
      affectedTraceIds.add(element.pcb_trace_id)
    }
  }
  for (const trace of combinePreloadedAndRoutedTraces(
    input.traces ?? [],
    routedTraces,
  )) {
    const appearsInTracePairError: boolean = geometricErrors.some(
      (error): boolean =>
        "pcb_trace_error_id" in error &&
        typeof error.pcb_trace_error_id === "string" &&
        error.pcb_trace_error_id.includes(trace.pcb_trace_id),
    )
    if (!appearsInTracePairError && !affectedTraceIds.has(trace.pcb_trace_id)) {
      continue
    }
    console.error("RP2350 affected trace", JSON.stringify(trace))
  }
  expect(errors).toHaveLength(0)
})
