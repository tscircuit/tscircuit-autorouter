import { expect, test } from "bun:test"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("only restores copper with an explicit nominal trace width", (): void => {
  const routes: HighDensityRoute[] = ["ddr", "clock"].map(
    (connectionName, index) => ({
      connectionName,
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: Array.from({ length: 12 }, (_, x) => ({ x, y: index, z: 0 })),
    }),
  )
  const solver = new TraceWidthSolver({
    hdRoutes: routes,
    connection: [
      { name: "ddr", pointsToConnect: [], nominalTraceWidth: 0.2 },
      { name: "clock", pointsToConnect: [] },
    ],
    minTraceWidth: 0.1,
    layerCount: 2,
  })
  solver.solve()
  const [ddr, clock] = solver.refineWidths({ hdRoutes: routes })
  expect(ddr!.traceThickness).toBe(0.2)
  expect(clock).toBe(routes[1])
})
