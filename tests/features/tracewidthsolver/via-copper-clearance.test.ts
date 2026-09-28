import { expect, test } from "bun:test"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"

test("width selection measures via copper instead of its owning trace width", (): void => {
  const solver = new TraceWidthSolver({
    hdRoutes: [
      {
        connectionName: "signal",
        traceThickness: 0.1,
        viaDiameter: 0.45,
        vias: [],
        route: [
          { x: -1, y: 0.385, z: 0 },
          { x: 1, y: 0.385, z: 0 },
        ],
      },
      {
        connectionName: "via-net",
        traceThickness: 0.1,
        viaDiameter: 0.45,
        vias: [{ x: 0, y: 0 }],
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 0, z: 1 },
          { x: 0, y: -1, z: 1 },
        ],
      },
    ],
    minTraceWidth: 0.1,
    obstacleMargin: 0.1,
    layerCount: 2,
    connection: [
      { name: "signal", nominalTraceWidth: 0.15, pointsToConnect: [] },
    ],
  })
  solver.solve()
  const width = solver.getHdRoutesWithWidths()[0]!.traceThickness
  expect(width).toBe(0.1)
  expect(0.385 - 0.225 - width / 2).toBeGreaterThanOrEqual(0.1)
})
