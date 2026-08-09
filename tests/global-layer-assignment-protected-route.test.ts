import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { GlobalLayerAssignmentSolver } from "lib/solvers/GlobalLayerAssignmentSolver/GlobalLayerAssignmentSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("does not change protected differential-pair routes", () => {
  const route: HighDensityRoute = {
    connectionName: "pair_positive_segment",
    rootConnectionName: "pair_positive",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -2, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: -1, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
    vias: [
      { x: -1, y: 0 },
      { x: 1, y: 0 },
    ],
  }
  const solver = new GlobalLayerAssignmentSolver({
    hdRoutes: [route],
    obstacles: [],
    connMap: new ConnectivityMap({}),
    layerCount: 2,
    protectedConnectionNames: new Set(["pair_positive"]),
  })

  solver.solve()

  expect(solver.getOutput()[0]!.vias).toHaveLength(2)
  expect(solver.getOutput()[0]!.route).toEqual(route.route)
  expect(solver.stats.viasRemoved).toBe(0)
})
