import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { FinalViaOptimizationSolver } from "lib/solvers/FinalViaOptimizationSolver/FinalViaOptimizationSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("final via optimization rescans an accepted route for another collapse", () => {
  const srj = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -5, minY: -2, maxX: 5, maxY: 2 },
    obstacles: [
      {
        type: "rect" as const,
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["foreign"],
      },
    ],
    connections: [
      {
        name: "trace",
        pointsToConnect: [
          { x: -4, y: 0, layer: "top", pointId: "start" },
          { x: 4, y: 0, layer: "top", pointId: "end" },
        ],
      },
    ],
  }
  const route: HighDensityRoute = {
    connectionName: "trace",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [
      { x: -3, y: 0 },
      { x: -1, y: 0 },
      { x: 1, y: 0 },
      { x: 3, y: 0 },
    ],
    route: [
      { x: -4, y: 0, z: 0 },
      { x: -3, y: 0, z: 0 },
      { x: -3, y: 0, z: 1 },
      { x: -1, y: 0, z: 1 },
      { x: -1, y: 0, z: 0 },
      { x: -0.5, y: 1, z: 0 },
      { x: 0.5, y: 1, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 },
      { x: 3, y: 0, z: 1 },
      { x: 3, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
    ],
  }
  const noErrors = (() => ({ errors: [] })) as DrcEvaluator
  const solver = new FinalViaOptimizationSolver({
    hdRoutes: [route],
    originalSrj: srj,
    obstacles: srj.obstacles,
    layerCount: 2,
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    productionDrcEvaluator: noErrors,
    relaxedDrcEvaluator: noErrors,
    convert: (routes) =>
      routes.map((candidate) => ({
        type: "pcb_trace" as const,
        pcb_trace_id: candidate.connectionName,
        connection_name: candidate.connectionName,
        route: candidate.vias.map((via) => ({
          route_type: "via" as const,
          x: via.x,
          y: via.y,
          from_layer: "top",
          to_layer: "bottom",
        })),
      })),
  })

  solver.solve()

  expect(solver.stats.acceptedCandidateCount).toBe(2)
  expect(solver.stats.rescannedAcceptedRouteCount).toBe(2)
  expect(solver.getOutput()[0]?.vias).toEqual([])
})
