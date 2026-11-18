import { expect, test } from "bun:test"
import { TraceSimplificationSolver } from "@tscircuit/trace-simplification-solver"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { canonicalizePipeline9HdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/canonicalizePipeline9HdRoutes"
import inputRoute from "../fixtures/orangecrab-start-via.json"

test("OrangeCrab start via survives simplification and Pipeline 9 validation", (): void => {
  const solver = new TraceSimplificationSolver({
    hdRoutes: [structuredClone(inputRoute)],
    obstacles: [],
    connMap: new ConnectivityMap({
      GND: [inputRoute.connectionName, inputRoute.rootConnectionName],
    }),
    netByConnectionName: new Map([[inputRoute.connectionName, "GND"]]),
    colorMap: {},
    defaultViaDiameter: 0.28,
    layerCount: 6,
    preserveRouteEndpoints: true,
    enableCrossingViaReduction: true,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const routes = canonicalizePipeline9HdRoutes(solver.simplifiedHdRoutes)
  expect(routes).toHaveLength(1)
  expect(routes[0]!.vias).toHaveLength(1)
  expect(routes[0]!.route[0]).toEqual(inputRoute.route[0])
  expect(routes[0]!.route.at(-1)).toEqual(inputRoute.route.at(-1))
})
