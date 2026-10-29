import { expect, test } from "bun:test"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"

test("routes shorter than a cursor step still validate their full segment", (): void => {
  const solver = new TraceWidthSolver({
    hdRoutes: [
      {
        connectionName: "signal",
        traceThickness: 0.1,
        viaDiameter: 0.45,
        vias: [],
        route: [
          { x: 0, y: 0.150001, z: 0 },
          { x: 0.08, y: 0.150001, z: 0 },
        ],
      },
    ],
    minTraceWidth: 0.1,
    obstacleMargin: 0.1,
    layerCount: 2,
    connection: [
      { name: "signal", nominalTraceWidth: 0.15, pointsToConnect: [] },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: 0.04, y: -0.1 },
        width: 0.02,
        height: 0.2,
        layers: ["top"],
        connectedTo: ["other"],
      },
    ],
  })
  solver.solve()
  expect(solver.getHdRoutesWithWidths()[0]!.traceThickness).toBe(0.1)
})
