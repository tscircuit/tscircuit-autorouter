import { expect, spyOn, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { applyPipeline9RegionalB01Repairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9RegionalB01Repairs"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("an exhausted regional candidate cannot consume the board's iteration budget", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -5, maxX: 5, minY: -2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "route",
        pointsToConnect: [
          { x: -4, y: 0, layer: "top" },
          { x: 4, y: 0, layer: "top" },
        ],
      },
    ],
  }
  const routes: HighDensityRoute[] = [
    {
      connectionName: "route",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -4, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
      ],
      vias: [],
    },
  ]
  const errors = [
    {
      type: "pcb_via_trace_clearance_error",
      pcb_trace_id: "route_0",
      center: { x: 0, y: 0 },
    },
  ]
  const drcEvaluator: DrcEvaluator = () => ({ errors })
  const singleRouteSolve = spyOn(
    Pipeline9HighDensitySolver.prototype,
    "solve",
  ).mockImplementation(function (this: Pipeline9HighDensitySolver): void {
    this.failed = true
    this.error = "No single-route candidate"
  })
  let stepCount = 0
  const exhaustedRegion = spyOn(
    Pipeline9RegionalFallbackSolver.prototype,
    "_step",
  ).mockImplementation(function (this: Pipeline9RegionalFallbackSolver): void {
    stepCount++
    // Fail fast on the parent instead of running its 100-million-step budget.
    if (this.iterations > 100_001) {
      throw new Error("Regional candidate exceeded its work budget")
    }
  })
  try {
    const result = applyPipeline9RegionalB01Repairs({
      srj,
      routes,
      fixedObstacleRoutes: [],
      newConnections: srj.connections,
      syntheticConnectionNames: new Set(),
      preloadRepairTraceIds: new Set(),
      drcEvaluator,
      connMap: getConnectivityMapFromSimpleRouteJson(srj),
      colorMap: {},
      viaDiameter: 0.3,
      traceWidth: 0.1,
      obstacleMargin: 0.15,
      effort: 1,
    })
    expect(stepCount).toBe(100_001)
    expect(result.routes).toBe(routes)
    expect(result.acceptedCandidateCount).toBe(0)
    expect(result.remainingDrcIssueCount).toBe(1)
    expect(result.candidateSearchCount).toBe(6)
  } finally {
    singleRouteSolve.mockRestore()
    exhaustedRegion.mockRestore()
  }
})
