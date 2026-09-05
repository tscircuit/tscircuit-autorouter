import { expect, test } from "bun:test"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("circular terminal pads limit diagonal trace escapes to the pad diameter", () => {
  for (const angle of [0, Math.PI / 8, Math.PI / 4, Math.PI / 2]) {
    const route: HighDensityRoute = {
      connectionName: "signal",
      traceThickness: 0.25,
      viaDiameter: 0.2,
      vias: [],
      route: [
        { x: 0, y: 0, z: 0 },
        { x: Math.cos(angle) * 2, y: Math.sin(angle) * 2, z: 0 },
      ],
    }
    const solver = new TraceWidthSolver({
      hdRoutes: [route],
      connection: [],
      minTraceWidth: 0.1,
      layerCount: 2,
      obstacles: [
        {
          type: "rect",
          shape: "circle",
          layers: ["top"],
          center: { x: 0, y: 0 },
          width: 0.2,
          height: 0.2,
          connectedTo: ["signal"],
        },
      ],
    })
    solver.solve()
    expect(solver.solved).toBe(true)
    const output = solver.getHdRoutesWithWidths()[0]!
    expect(output.route[0]!.traceThickness).toBeCloseTo(0.2)
    expect(output.route.at(-1)!.traceThickness).toBeCloseTo(0.25)
    expect(output.traceThickness).toBe(0.25)
    expect(route.route).toHaveLength(2)
  }
})
