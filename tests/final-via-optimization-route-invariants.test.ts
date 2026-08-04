import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import {
  FinalViaOptimizationSolver,
  hasSameIdentityAndTerminals,
} from "lib/solvers/FinalViaOptimizationSolver/FinalViaOptimizationSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("final via optimization preserves endpoint metadata and protected routes", () => {
  const srj = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    differentialPairs: [
      {
        connectionNames: ["protected", "other"] as [string, string],
        lengthTolerance: 0.1,
      },
    ],
    connections: [
      {
        name: "protected",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top", pointId: "protected_start" },
          { x: 1, y: 0, layer: "top", pointId: "protected_end" },
        ],
      },
      {
        name: "other",
        pointsToConnect: [
          { x: -1, y: 1, layer: "top", pointId: "other_start" },
          { x: 1, y: 1, layer: "top", pointId: "other_end" },
        ],
      },
    ],
  }
  const protectedRoute: HighDensityRoute = {
    connectionName: "protected",
    rootConnectionName: "protected",
    startPcbPortId: "pcb_port_start",
    endPcbPortId: "pcb_port_end",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [
      { x: -0.5, y: 0 },
      { x: 0.5, y: 0 },
    ],
    route: [
      { x: -1, y: 0, z: 0, pcb_port_id: "pcb_port_start" },
      { x: -0.5, y: 0, z: 0 },
      { x: -0.5, y: 0, z: 1 },
      { x: 0.5, y: 0, z: 1 },
      { x: 0.5, y: 0, z: 0 },
      { x: 1, y: 0, z: 0, pcb_port_id: "pcb_port_end" },
    ],
  }
  const endpointLayerChanged: HighDensityRoute = {
    ...structuredClone(protectedRoute),
    route: protectedRoute.route.map((point, index) =>
      index === 0 ? { ...point, z: 1 } : point,
    ),
  }
  const noErrors = (() => ({ errors: [] })) as DrcEvaluator
  const solver = new FinalViaOptimizationSolver({
    hdRoutes: [protectedRoute],
    originalSrj: srj,
    obstacles: [],
    layerCount: 2,
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    convert: () => [],
    productionDrcEvaluator: noErrors,
    relaxedDrcEvaluator: noErrors,
  })

  solver.solve()

  expect(
    hasSameIdentityAndTerminals(protectedRoute, endpointLayerChanged),
  ).toBe(false)
  expect(solver.getOutput()).toEqual([protectedRoute])
  expect(solver.stats.scannedEligibleRouteCount).toBe(0)
})
