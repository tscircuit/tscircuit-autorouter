import { expect, test } from "bun:test"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("terminal neckdown follows the pad escape beyond tiny interior corrections", (): void => {
  for (const rotation of [0, 45, 90]) {
    const angle = rotation * Math.PI / 180
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const points = [[2, 0], [0.0002, 0.0002], [0, 0]].map(
      ([x, y]): HighDensityRoute["route"][number] => ({
        x: x! * cos - y! * sin,
        y: x! * sin + y! * cos,
        z: 0,
      }),
    )
    const solver = new TraceWidthSolver({
      minTraceWidth: 0.5,
      layerCount: 2,
      connection: [{ name: "signal", pointsToConnect: [] }],
      obstacles: [{
        type: "rect",
        center: { x: 0, y: 0 },
        width: 1.1,
        height: 0.3,
        ccwRotationDegrees: rotation,
        layers: ["top"],
        connectedTo: ["signal"],
      }],
      hdRoutes: [{
        connectionName: "signal",
        traceThickness: 0.5,
        viaDiameter: 0.3,
        route: points,
        vias: [],
      }],
    })
    solver.solve()
    expect(solver.solved).toBe(true)
    const output = solver.getHdRoutesWithWidths()[0]!
    const inPad = output.route.filter((point): boolean =>
      Math.abs(point.x * cos + point.y * sin) <= 0.55 + 1e-6 &&
      Math.abs(-point.x * sin + point.y * cos) <= 0.15 + 1e-6,
    )
    expect(inPad.length).toBeGreaterThan(0)
    for (const point of inPad) {
      expect(point.traceThickness).toBeLessThanOrEqual(0.3 + 1e-6)
    }
  }
})
