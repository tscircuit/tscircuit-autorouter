import { expect, test } from "bun:test"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("interior widening preserves space for a complete nominal-width route", (): void => {
  const signals: HighDensityRoute[] = [0, 0.27].map((y, index) => ({
    connectionName: `signal${index}`,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: Array.from({ length: 10 }, (_, x) => ({ x, y, z: 0 })),
  }))
  const fixed: HighDensityRoute = {
    connectionName: "fixed",
    traceThickness: 0.14,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: 2.25, y: -0.23, z: 0 },
      { x: 2.75, y: -0.23, z: 0 },
    ],
  }
  const solver = new TraceWidthSolver({
    hdRoutes: signals,
    connection: signals.map(({ connectionName }) => ({
      name: connectionName,
      pointsToConnect: [],
      nominalTraceWidth: 0.22,
    })),
    minTraceWidth: 0.1,
    obstacleMargin: 0.1,
    layerCount: 2,
  })
  solver.solve()
  const [first, second] = solver.refineWidths({
    hdRoutes: signals,
    otherHdRoutes: [fixed],
  })
  expect(first).toBe(signals[0])
  const widths = second!.route.map(
    (point) => point.traceThickness ?? second!.traceThickness,
  )
  expect(widths).toEqual(Array(10).fill(0.22))
})
