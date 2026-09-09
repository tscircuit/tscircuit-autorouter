import { expect, test } from "bun:test"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"

test("routes at the connection minimum when no nominal width is specified", () => {
  const requiredWidth = 1.2
  const solver = new TraceWidthSolver({
    connection: [
      {
        name: "motor",
        minTraceWidth: requiredWidth,
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 10, y: 0, layer: "top" },
        ],
      },
    ],
    hdRoutes: [
      {
        connectionName: "branch",
        rootConnectionName: "motor",
        traceThickness: 0.15,
        viaDiameter: 0.6,
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 10, y: 0, z: 0 },
        ],
        vias: [],
      },
    ],
    minTraceWidth: 0.15,
    layerCount: 2,
  })
  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.error).toBeNull()
  const [route] = solver.getHdRoutesWithWidths()
  expect(route!.traceThickness).toBe(requiredWidth)
  expect(
    route!.route.every((point) => point.traceThickness === requiredWidth),
  ).toBe(true)
})
