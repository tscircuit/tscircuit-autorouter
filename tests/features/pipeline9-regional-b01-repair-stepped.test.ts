import { expect, spyOn, test } from "bun:test"
import {
  GlobalDrcForceImproveSolver,
  type DrcEvaluator,
} from "high-density-repair03/lib"
import type { Pipeline9RegionalB01RepairParams } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9RegionalB01Repairs"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { Pipeline9RegionalB01RepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalB01RepairSolver"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("regional B01 repair stages each child without draining candidate searches", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -3, minY: -3, maxX: 3, maxY: 3 },
    obstacles: [],
    connections: [
      {
        name: "route",
        pointsToConnect: [
          { x: -2, y: 0, layer: "top" },
          { x: 2, y: 0, layer: "top" },
        ],
      },
    ],
  }
  const routes: HighDensityRoute[] = [
    {
      connectionName: "route",
      rootConnectionName: "route",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: -2, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
    },
  ]
  const errors = [
    {
      type: "pcb_trace_error",
      pcb_trace_id: "route_0",
      center: { x: 0, y: 0 },
    },
  ]
  const drcEvaluator: DrcEvaluator = (): ReturnType<DrcEvaluator> => ({
    errors,
    errorsWithCenters: errors,
  })
  const params: Pipeline9RegionalB01RepairParams = {
    srj,
    routes,
    fixedObstacleRoutes: [],
    newConnections: srj.connections,
    syntheticConnectionNames: new Set(),
    drcEvaluator,
    preloadRepairTraceIds: new Set(["route_0"]),
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    colorMap: {},
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 1,
  }
  const childPrototypes = [
    Pipeline9HighDensitySolver.prototype,
    Pipeline9RegionalFallbackSolver.prototype,
    GlobalDrcForceImproveSolver.prototype,
  ]
  const solveSpies = childPrototypes.map((prototype) =>
    spyOn(prototype, "solve").mockImplementation((): never => {
      throw new Error("Regional orchestration must step its child solvers")
    }),
  )
  const stepSpies = childPrototypes.map((prototype) => spyOn(prototype, "step"))
  try {
    const solver = new Pipeline9RegionalB01RepairSolver(params)
    expect(() => solver.getResult()).toThrow("not complete")
    solver.step()
    expect(solver.solved).toBeFalse()
    expect(solver.activeSubSolver).toBeUndefined()
    while (!solver.activeSubSolver && !solver.solved && !solver.failed)
      solver.step()
    expect(solver.activeSubSolver).toBeInstanceOf(Pipeline9HighDensitySolver)
    expect(solver.activeSubSolver!.iterations).toBe(0)
    expect(Number.isSafeInteger(solver.MAX_ITERATIONS)).toBeTrue()
    solver.step()
    expect(solver.activeSubSolver!.iterations).toBe(1)
    while (!solver.solved && !solver.failed) {
      const before = stepSpies.reduce(
        (count, spy) => count + spy.mock.calls.length,
        0,
      )
      const previousProgress = solver.progress
      solver.step()
      const after = stepSpies.reduce(
        (count, spy) => count + spy.mock.calls.length,
        0,
      )
      expect(after - before).toBeLessThanOrEqual(1)
      expect(solver.progress).toBeGreaterThanOrEqual(previousProgress)
    }
    expect(solver.failed, solver.error ?? "").toBeFalse()
    expect(solver.activeSubSolver).toBeNull()
    expect(solver.progress).toBe(1)
    expect(stepSpies.every((spy) => spy.mock.calls.length > 0)).toBeTrue()
    expect(solver.getResult()).toMatchObject({
      routes,
      attemptedCandidateCount: 6,
      acceptedCandidateCount: 0,
      fallbackCandidateCount: 1,
      candidateSearchCount: 6,
      candidateSearchBudgetExhausted: false,
      safeTraceLayerRepairSkippedForBudget: false,
      remainingDrcIssueCount: 1,
    })
    expect(solveSpies.every((spy) => spy.mock.calls.length === 0)).toBeTrue()
  } finally {
    for (const spy of [...stepSpies, ...solveSpies]) spy.mockRestore()
  }
})
