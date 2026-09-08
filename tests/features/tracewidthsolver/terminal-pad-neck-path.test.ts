import { expect, test } from "bun:test"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("terminal necks stay narrow through the pad despite a tiny diagonal endpoint segment", () => {
  for (const angle of [0, 35, 90, 180]) {
    const radians = (angle * Math.PI) / 180
    const cos = Math.cos(radians)
    const sin = Math.sin(radians)
    const route: HighDensityRoute = {
      connectionName: "power",
      traceThickness: 0.5,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: 2, y: 0 },
        { x: 0.0002, y: 0.0002 },
        { x: 0, y: 0 },
      ].map(({ x, y }) => ({
        x: 7 + x * cos - y * sin,
        y: -3 + x * sin + y * cos,
        z: 0,
      })),
    }
    const original = structuredClone(route)
    const solver = new TraceWidthSolver({
      hdRoutes: [route],
      minTraceWidth: 0.5,
      layerCount: 2,
      connection: [{ name: "power", pointsToConnect: [] }],
      obstacles: [
        {
          type: "rect",
          center: { x: 7, y: -3 },
          width: 1.1,
          height: 0.3,
          layers: ["top"],
          ccwRotationDegrees: angle,
          connectedTo: ["power"],
        },
      ],
    })
    solver.solve()
    expect(solver.solved).toBeTrue()
    expect(route).toEqual(original)
    const output = solver.getHdRoutesWithWidths()[0]!
    expect(output.route[0]!.traceThickness).toBe(0.5)
    for (const point of output.route) {
      const localX = (point.x - 7) * cos + (point.y + 3) * sin
      if (localX > 0.55 + 1e-9) continue
      expect(point.traceThickness).toBeCloseTo(0.3, 12)
    }
    expect(output.route.at(-1)).toMatchObject(original.route.at(-1)!)
  }
})
