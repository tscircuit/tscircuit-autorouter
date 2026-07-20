import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("post-DRC simplification scales one ordered strategy portfolio", () => {
  const route: HighDensityRoute = {
    connectionName: "route",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
    ],
  }
  const createSolver = (effort: number) =>
    new TraceSimplificationSolver({
      hdRoutes: [route],
      obstacles: [],
      connMap: new ConnectivityMap({ net: [route.connectionName] }),
      colorMap: {},
      defaultViaDiameter: route.viaDiameter,
      layerCount: 2,
      effort,
      drcEvaluator: () => [],
      preserveInitialDrcCheckpoint: true,
    })

  const oneX = createSolver(1)
  const twoX = createSolver(2)

  expect(oneX.simplifiedHdRoutes[0]?.vias).toEqual([{ x: 0, y: 0 }])
  expect(twoX.simplifiedHdRoutes[0]?.vias).toEqual(
    oneX.simplifiedHdRoutes[0]?.vias,
  )
  expect(oneX.SIMPLIFICATION_STRATEGY_LIMIT).toBe(2)
  expect(twoX.SIMPLIFICATION_STRATEGY_LIMIT).toBe(3)

  oneX.solve()
  twoX.solve()

  expect(oneX.iterations).toBeGreaterThan(0)
  expect(twoX.iterations).toBeGreaterThanOrEqual(oneX.iterations)
})
