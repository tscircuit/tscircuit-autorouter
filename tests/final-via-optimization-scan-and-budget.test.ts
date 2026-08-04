import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { FinalViaOptimizationSolver } from "lib/solvers/FinalViaOptimizationSolver/FinalViaOptimizationSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

const createSolver = (routeCount: number) => {
  const connectionNames = Array.from(
    { length: routeCount },
    (_, index) => `trace_${String(index).padStart(2, "0")}`,
  )
  const srj = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -50, maxX: 2, maxY: 50 },
    obstacles: [],
    connections: connectionNames.map((name, index) => ({
      name,
      pointsToConnect: [
        { x: -1, y: index, layer: "top", pointId: `${name}_start` },
        { x: 1, y: index, layer: "top", pointId: `${name}_end` },
      ],
    })),
  }
  const hdRoutes: HighDensityRoute[] = connectionNames.map(
    (connectionName, y) => ({
      connectionName,
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [
        { x: -0.5, y },
        { x: 0.5, y },
      ],
      route: [
        { x: -1, y, z: 0 },
        { x: -0.5, y, z: 0 },
        { x: -0.5, y, z: 1 },
        { x: 0.5, y, z: 1 },
        { x: 0.5, y, z: 0 },
        { x: 1, y, z: 0 },
      ],
    }),
  )
  const noErrors = (() => ({ errors: [] })) as DrcEvaluator
  return new FinalViaOptimizationSolver({
    hdRoutes,
    originalSrj: srj,
    obstacles: [],
    layerCount: 2,
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    productionDrcEvaluator: noErrors,
    relaxedDrcEvaluator: noErrors,
    convert: (routes) =>
      routes.map((route) => ({
        type: "pcb_trace" as const,
        pcb_trace_id: route.connectionName,
        connection_name: route.connectionName,
        route: route.vias.map((via) => ({
          route_type: "via" as const,
          x: via.x,
          y: via.y,
          from_layer: "top",
          to_layer: "bottom",
        })),
      })),
  })
}

test("final via optimization scans every eligible route while bounding converted DRC candidates", () => {
  const solver = createSolver(40)

  solver.solve()

  expect(solver.stats.scannedEligibleRouteCount).toBe(40)
  expect(solver.stats.candidateEvaluationCount).toBe(32)
  expect(solver.stats.acceptedCandidateCount).toBe(32)
})

test("final via optimization bounds initial geometry discovery on very large boards", () => {
  const solver = createSolver(513)

  solver.solve()

  expect(solver.stats.initialRouteScanBudget).toBe(512)
  expect(solver.stats.scannedEligibleRouteCount).toBe(512)
  expect(solver.stats.candidateEvaluationCount).toBe(32)
})
