import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("max-effort trace simplification stops after route complexity converges", () => {
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
    effort: 100,
  })

  expect(solver.MAX_SIMPLIFICATION_PIPELINE_LOOPS).toBe(200)
  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.simplificationPipelineLoops).toBe(4)
  expect(solver.stats.simplificationStoppedAfterNoImprovement).toBe(true)
  expect(solver.simplifiedHdRoutes[0]?.route).toHaveLength(3)
})
