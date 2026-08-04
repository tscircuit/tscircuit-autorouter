import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { FinalViaOptimizationSolver } from "lib/solvers/FinalViaOptimizationSolver/FinalViaOptimizationSolver"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("final via optimization accepts only a DRC-safe converted via reduction", () => {
  const srj = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "trace",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top", pointId: "start" },
          { x: 1, y: 0, layer: "top", pointId: "end" },
        ],
      },
    ],
  }
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "trace",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [
        { x: -0.5, y: 0 },
        { x: 0.5, y: 0 },
      ],
      route: [
        { x: -1, y: 0, z: 0 },
        { x: -0.5, y: 0, z: 0 },
        { x: -0.5, y: 0, z: 1 },
        { x: 0.5, y: 0, z: 1 },
        { x: 0.5, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
    },
  ]
  const noErrors = (() => ({ errors: [] })) as DrcEvaluator
  const solver = new FinalViaOptimizationSolver({
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

  solver.solve()

  expect(solver.getOutput()[0]?.vias).toEqual([])
  expect(solver.stats.removedViaCount).toBe(2)
  expect(hdRoutes[0]?.vias).toHaveLength(2)
})
