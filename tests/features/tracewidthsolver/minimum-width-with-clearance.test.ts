import { expect, test } from "bun:test"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"

test("explicit connection minimum is used when the route has room", (): void => {
  const solver = new TraceWidthSolver({
    hdRoutes: [
      {
        connectionName: "motor",
        traceThickness: 0.1,
        viaDiameter: 0.45,
        vias: [],
        route: [
          { x: -1, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
      },
    ],
    minTraceWidth: 0.1,
    obstacleMargin: 0.1,
    layerCount: 2,
    connection: [
      {
        name: "motor",
        minTraceWidth: 0.4,
        pointsToConnect: [],
      },
    ],
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.getHdRoutesWithWidths()[0]?.traceThickness).toBe(0.4)
})
