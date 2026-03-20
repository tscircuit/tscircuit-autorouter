import { test, expect } from "bun:test"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import { SimpleRouteConnection } from "lib/types"
import { HighDensityRoute } from "lib/types/high-density-types"

test("TraceWidthSolver - uses traceWidthMultiplier for connections without explicit nominalTraceWidth", () => {
  const minTraceWidth = 0.15

  // Create a simple straight route
  const hdRoute: HighDensityRoute = {
    connectionName: "VCC",
    traceThickness: minTraceWidth,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
    vias: [],
  }

  // Connection with traceWidthMultiplier=4 -> effective nominal width = 0.6mm
  const connection: SimpleRouteConnection = {
    name: "VCC",
    traceWidthMultiplier: 4,
    pointsToConnect: [
      { x: 0, y: 0, layer: "top" },
      { x: 2, y: 0, layer: "top" },
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
  // With no obstacles nearby, the solver should use the full nominal width (0.6mm)
  expect(routes[0].traceThickness).toBeCloseTo(0.6)
})
