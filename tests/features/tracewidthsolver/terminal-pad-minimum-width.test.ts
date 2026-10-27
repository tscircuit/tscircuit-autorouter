import { expect, test } from "bun:test"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("a terminal neckdown preserves the board minimum when its pad is narrower", (): void => {
  const route: HighDensityRoute = {
    connectionName: "trace",
    rootConnectionName: "trace",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: -2, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
  }
  const solver = new TraceWidthSolver({
    hdRoutes: [route],
    connection: [
      {
        name: "trace",
        nominalTraceWidth: 0.2,
        pointsToConnect: [
          { x: -2, y: 0, layer: "top", pointId: "start" },
          { x: 2, y: 0, layer: "top", pointId: "end" },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: -2, y: 0 },
        width: 1.5,
        height: 0.1,
        layers: ["top"],
        connectedTo: ["trace"],
      },
    ],
    minTraceWidth: 0.15,
    obstacleMargin: 0.1,
    layerCount: 2,
  })
  solver.solve()
  const [output] = solver.getHdRoutesWithWidths()
  expect(solver.solved).toBeTrue()
  expect(output!.route.length).toBeGreaterThan(route.route.length)
  expect(
    output!.route.every((point): boolean => point.traceThickness! >= 0.15),
  ).toBeTrue()
  expect(output!.route[0]!.traceThickness).toBe(0.15)
  expect(output!.route.at(-1)!.traceThickness).toBe(0.2)
  expect(output!.route[0]!.x).toBe(-2)
  expect(output!.route.at(-1)!.x).toBe(2)
})
