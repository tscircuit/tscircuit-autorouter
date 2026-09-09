import { expect, test } from "bun:test"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("later width choices respect copper already widened by the solver", (): void => {
  const hdRoutes: HighDensityRoute[] = [0, 0.23].map((y, index) => ({
    connectionName: `net${index}`, traceThickness: 0.1, viaDiameter: 0.45, vias: [],
    route: [{ x: -1, y, z: 0 }, { x: 1, y, z: 0 }],
  }))
  const solver = new TraceWidthSolver({
    hdRoutes, minTraceWidth: 0.1, obstacleMargin: 0.1, layerCount: 2,
    connection: hdRoutes.map(route => ({ name: route.connectionName,
      nominalTraceWidth: 0.15, pointsToConnect: [] })),
  })
  solver.solve()
  const widths = solver.getHdRoutesWithWidths().map(route => route.traceThickness)
  expect(widths).toEqual([0.15, 0.1])
  expect(0.23 - (widths[0]! + widths[1]!) / 2).toBeGreaterThanOrEqual(0.1)
})
