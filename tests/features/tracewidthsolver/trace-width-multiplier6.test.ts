import { test, expect } from "bun:test"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import { SimpleRouteConnection } from "lib/types"
import { HighDensityRoute } from "lib/types/high-density-types"

test("TraceWidthSolver - passes through routes without multiplier or nominalTraceWidth unchanged", () => {
  const minTraceWidth = 0.15

  const hdRoute: HighDensityRoute = {
    connectionName: "DATA",
    traceThickness: minTraceWidth,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
    vias: [],
  }

  const connection: SimpleRouteConnection = {
    name: "DATA",
    pointsToConnect: [
      { x: 0, y: 0, layer: "top" },
      { x: 1, y: 0, layer: "top" },
    ],
  }

  const solver = new TraceWidthSolver({
    hdRoutes: [hdRoute],
    connection: [connection],
    minTraceWidth,
    layerCount: 2,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  const routes = solver.getHdRoutesWithWidths()
  expect(routes.length).toBe(1)
  // Route without any width override should be passed through unchanged
  expect(routes[0].traceThickness).toBe(minTraceWidth)
})
