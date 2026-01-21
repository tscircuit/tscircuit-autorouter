import { test, expect } from "bun:test"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import { SimpleRouteConnection } from "lib/types"
import input from "../../../fixtures/features/tracewidthsolver/tracewidthsolver02-input.json" with {
  type: "json",
}

test("TraceWidthSolver02 - trace width with jumpers", () => {
  const data = (input as any)[0]
  const nominalTraceWidth = data.nominalTraceWidth ?? data.minTraceWidth * 2
  const connectionByName = new Map<string, SimpleRouteConnection>()
  for (const route of data.hdRoutes) {
    if (connectionByName.has(route.connectionName)) {
      continue
    }
    const start = route.route[0]
    const end = route.route[route.route.length - 1]
    connectionByName.set(route.connectionName, {
      name: route.connectionName,
      nominalTraceWidth,
      pointsToConnect: [
        { x: start.x, y: start.y, layer: "top" },
        { x: end.x, y: end.y, layer: "top" },
      ],
    })
  }

  const solver = new TraceWidthSolver({
    hdRoutes: data.hdRoutes,
    minTraceWidth: data.minTraceWidth,
    connection: Array.from(connectionByName.values()),
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.getHdRoutesWithWidths().length).toBeGreaterThan(0)
  expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
})
