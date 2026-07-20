import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { PostDrcTraceSimplificationSolver } from "lib/solvers/PostDrcTraceSimplificationSolver/post-drc-trace-simplification-solver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("post-DRC simplification has a visible zero-work baseline stage", () => {
  const route: HighDensityRoute = {
    connectionName: "route",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: -1, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
  }
  const solver = new PostDrcTraceSimplificationSolver({
    hdRoutes: [route],
    obstacles: [],
    connMap: new ConnectivityMap({ net: [route.connectionName] }),
    colorMap: {},
    defaultViaDiameter: route.viaDiameter,
    layerCount: 2,
    effort: 1,
    drcEvaluator: () => [],
    preserveInitialDrcCheckpoint: true,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.iterations).toBe(0)
  expect(solver.simplifiedHdRoutes).toEqual([route])
  expect(solver.stats.postDrcSimplificationEffortBudget).toBe(0)
})
