import { expect, test } from "bun:test"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

const makeRoute = (connectionName: string, y = 0): HighDensityRoute => ({
  connectionName,
  traceThickness: 0.15,
  viaDiameter: 0.6,
  route: [
    { x: 0, y, z: 0 },
    { x: 2, y, z: 0 },
  ],
  vias: [],
})

const makeConnection = (
  name: string,
  nominalTraceWidth?: number,
): SimpleRouteConnection => ({
  name,
  ...(nominalTraceWidth !== undefined ? { nominalTraceWidth } : {}),
  pointsToConnect: [
    { x: 0, y: 0, layer: "top" },
    { x: 2, y: 0, layer: "top" },
  ],
})

test("TraceWidthSolver uses top-level nominalTraceWidth as the default width", () => {
  const solver = new TraceWidthSolver({
    hdRoutes: [makeRoute("source_net_1")],
    connection: [makeConnection("source_net_1")],
    minTraceWidth: 0.15,
    nominalTraceWidth: 0.6,
    layerCount: 2,
  })

  solver.solve()

  expect(solver.getHdRoutesWithWidths()[0]?.traceThickness).toBe(0.6)
})

test("TraceWidthSolver lets per-connection nominalTraceWidth override the top-level default", () => {
  const solver = new TraceWidthSolver({
    hdRoutes: [makeRoute("source_net_1"), makeRoute("source_net_2", 5)],
    connection: [
      makeConnection("source_net_1"),
      makeConnection("source_net_2", 0.3),
    ],
    minTraceWidth: 0.15,
    nominalTraceWidth: 0.6,
    layerCount: 2,
  })

  solver.solve()

  const routeWidths = new Map(
    solver
      .getHdRoutesWithWidths()
      .map((route) => [route.connectionName, route.traceThickness]),
  )
  expect(routeWidths.get("source_net_1")).toBe(0.6)
  expect(routeWidths.get("source_net_2")).toBe(0.3)
})

test("TraceWidthSolver ignores null nominalTraceWidth values", () => {
  const route = makeRoute("source_net_1")
  const connection = {
    ...makeConnection("source_net_1"),
    nominalTraceWidth: null,
  } as unknown as SimpleRouteConnection

  const solver = new TraceWidthSolver({
    hdRoutes: [route],
    connection: [connection],
    minTraceWidth: 0.15,
    nominalTraceWidth: null,
    layerCount: 2,
  } as unknown as ConstructorParameters<typeof TraceWidthSolver>[0])

  solver.solve()

  expect(solver.getHdRoutesWithWidths()[0]?.traceThickness).toBe(
    route.traceThickness,
  )
})
