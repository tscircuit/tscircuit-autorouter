import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("baseline simplification keeps its final capped pass", () => {
  const route: HighDensityRoute = {
    connectionName: "connection0",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
    ],
    vias: [],
  }
  const solver = new TraceSimplificationSolver({
    hdRoutes: [route],
    obstacles: [],
    connMap: new ConnectivityMap({ net0: [route.connectionName] }),
    colorMap: {},
    defaultViaDiameter: route.viaDiameter,
    layerCount: 2,
    effort: 1,
  })

  solver.solve()

  expect(solver.simplificationPipelineLoops).toBe(2)
  expect(solver.stats.simplificationStoppedAfterNoImprovement).toBe(false)
  expect(solver.simplifiedHdRoutes[0]?.route).toHaveLength(3)
})

test("zero-loop simplification is an exact no-op", () => {
  const route: HighDensityRoute = {
    connectionName: "connection0",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
    ],
    vias: [],
  }
  const solver = new TraceSimplificationSolver({
    hdRoutes: [route],
    obstacles: [],
    connMap: new ConnectivityMap({ net0: [route.connectionName] }),
    colorMap: {},
    defaultViaDiameter: route.viaDiameter,
    layerCount: 2,
    effort: 1,
    maxSimplificationPipelineLoops: 0,
  })

  solver.solve()

  expect(solver.simplificationPipelineLoops).toBe(0)
  expect(solver.simplifiedHdRoutes).toEqual([route])
})
