import { expect, test } from "bun:test"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("width selection includes pads throughout the required clearance envelope", (): void => {
  const route: HighDensityRoute = {
    connectionName: "supply",
    traceThickness: 0.1,
    viaDiameter: 0.45,
    vias: [],
    route: [
      { x: -1, y: 0.150001, z: 0 },
      { x: 1, y: 0.150001, z: 0 },
    ],
  }
  const solver = new TraceWidthSolver({
    hdRoutes: [route],
    minTraceWidth: 0.1,
    obstacleMargin: 0.1,
    layerCount: 2,
    connection: [
      { name: "supply", nominalTraceWidth: 0.15, pointsToConnect: [] },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: -0.32 },
        width: 0.54,
        height: 0.64,
        layers: ["top"],
        connectedTo: ["other"],
      },
    ],
  })
  solver.solve()
  const width = solver.getHdRoutesWithWidths()[0]!.traceThickness
  expect(width).toBe(0.1)
  expect(0.150001 - width / 2).toBeGreaterThanOrEqual(0.1)
})
