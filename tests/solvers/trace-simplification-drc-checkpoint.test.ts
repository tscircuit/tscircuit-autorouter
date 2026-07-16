import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("higher effort never replaces the 1x checkpoint with a dirtier route", () => {
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
  const createSolver = (
    effort: number,
    drcEvaluator?: ConstructorParameters<
      typeof TraceSimplificationSolver
    >[0]["drcEvaluator"],
  ) =>
    new TraceSimplificationSolver({
      hdRoutes: [route],
      obstacles: [],
      connMap: new ConnectivityMap({ net0: [route.connectionName] }),
      colorMap: {},
      defaultViaDiameter: route.viaDiameter,
      layerCount: 2,
      effort,
      drcEvaluator,
    })

  const oneX = createSolver(1)
  oneX.solve()
  const checkpointJson = JSON.stringify(oneX.simplifiedHdRoutes)
  const maxEffort = createSolver(100, ({ routes }) =>
    JSON.stringify(routes) === checkpointJson
      ? []
      : [
          {
            type: "pcb_trace_error",
            message: "synthetic simplification regression",
          },
        ],
  )
  maxEffort.solve()

  expect(maxEffort.simplifiedHdRoutes).toEqual(oneX.simplifiedHdRoutes)
  expect(maxEffort.stats.simplificationFinalDrcIssueCount).toBe(0)
  expect(maxEffort.stats.simplificationStoppedAfterNoImprovement).toBe(true)
})
