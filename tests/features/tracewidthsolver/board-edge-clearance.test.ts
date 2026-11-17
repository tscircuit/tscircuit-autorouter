import { expect, test } from "bun:test"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("TraceWidthSolver narrows traces near board bounds to preserve minBoardEdgeClearance", (): void => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "edge_signal",
      traceThickness: 0.1,
      viaDiameter: 0.45,
      route: [
        { x: 1.73, y: -1, z: 0 },
        { x: 1.73, y: 1, z: 0 },
      ],
      vias: [],
    },
  ]
  const connections: SimpleRouteConnection[] = [
    {
      name: "edge_signal",
      nominalTraceWidth: 0.15,
      pointsToConnect: [
        { x: 1.73, y: -1, layer: "top" },
        { x: 1.73, y: 1, layer: "top" },
      ],
    },
  ]
  const solver = new TraceWidthSolver({
    hdRoutes: routes,
    connection: connections,
    minTraceWidth: 0.1,
    obstacleMargin: 0.16,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    minBoardEdgeClearance: 0.2,
    layerCount: 2,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const widened = solver.getHdRoutesWithWidths()[0]!
  expect(widened.traceThickness).toBeLessThanOrEqual(0.14)
  expect(2 - 1.73 - widened.traceThickness / 2).toBeGreaterThanOrEqual(0.2)
})
