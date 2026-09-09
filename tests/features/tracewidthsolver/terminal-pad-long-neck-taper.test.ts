import { expect, test } from "bun:test"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("a long curved route inside a pad retains a complete taper after exiting", () => {
  const route: HighDensityRoute = {
    connectionName: "power",
    traceThickness: 0.5,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: 5, y: 0, z: 0 },
      { x: 1.5, y: 0, z: 0 },
      { x: -1.5, y: 0, z: 0 },
      { x: -1.5, y: 0.1, z: 0 },
      { x: 1.5, y: 0.1, z: 0 },
      { x: 0, y: 0, z: 0 },
    ],
  }
  const solver = new TraceWidthSolver({
    hdRoutes: [route],
    minTraceWidth: 0.5,
    layerCount: 2,
    connection: [{ name: "power", pointsToConnect: [] }],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 4,
        height: 0.3,
        layers: ["top"],
        connectedTo: ["power"],
      },
    ],
  })
  solver.solve()
  expect(solver.solved).toBeTrue()
  const output = solver.getHdRoutesWithWidths()[0]!
  expect(output.route[0]!.traceThickness).toBe(0.5)
  const transition = output.route.filter((point) => point.x > 2 && point.x < 3)
  expect(transition.length).toBeGreaterThan(3)
  for (const point of output.route) {
    if (point.x <= 2 + 1e-9) {
      expect(point.traceThickness).toBeCloseTo(0.3, 12)
    } else if (point.x < 3) {
      expect(point.traceThickness).toBeCloseTo(0.3 + (point.x - 2) * 0.2, 12)
    }
  }
})
