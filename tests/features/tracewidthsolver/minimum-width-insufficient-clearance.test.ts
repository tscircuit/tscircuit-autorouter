import { expect, test } from "bun:test"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"

test("explicit connection minimum fails when the route has insufficient clearance", (): void => {
  const solver = new TraceWidthSolver({
    hdRoutes: [
      {
        connectionName: "motor",
        traceThickness: 0.1,
        viaDiameter: 0.45,
        vias: [],
        route: [
          { x: -1, y: 0.2, z: 0 },
          { x: 1, y: 0.2, z: 0 },
        ],
      },
    ],
    minTraceWidth: 0.1,
    obstacleMargin: 0.1,
    layerCount: 2,
    connection: [
      {
        name: "motor",
        nominalTraceWidth: 0.4,
        minTraceWidth: 0.4,
        pointsToConnect: [],
      },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: -0.1 },
        width: 0.5,
        height: 0.2,
        layers: ["top"],
        connectedTo: ["other"],
      },
    ],
  })

  solver.solve()

  expect(solver.failed).toBe(true)
  expect(solver.error).toContain('"motor"')
  expect(solver.error).toContain("0.4 mm")
  expect(solver.getHdRoutesWithWidths()).toEqual([])
})
