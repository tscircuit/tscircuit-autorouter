import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("validated simplification retains a clean initial checkpoint", () => {
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
    preserveInitialDrcCheckpoint: true,
    drcEvaluator: ({ routes }) =>
      routes?.[0]?.route.length === route.route.length
        ? []
        : [
            {
              type: "pcb_trace_error",
              message: "synthetic post-processing regression",
            },
          ],
  })

  solver.solve()

  expect(solver.simplifiedHdRoutes).toEqual([route])
  expect(solver.stats.simplificationInitialDrcIssueCount).toBe(0)
  expect(solver.stats.simplificationFinalDrcIssueCount).toBe(0)
  expect(solver.stats.simplificationStoppedAfterNoImprovement).toBe(true)
})

