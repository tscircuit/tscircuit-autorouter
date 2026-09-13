import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

const makeViaRoute = (connectionName: string, x: number): HighDensityRoute => ({
  connectionName,
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: [
    { x, y: 0, z: 0 },
    { x, y: 0, z: 1 },
  ],
  vias: [{ x, y: 0 }],
})

test("SameNetViaMergerSolver skips a batch candidate removed by an earlier merge", () => {
  const solver = new SameNetViaMergerSolver({
    inputHdRoutes: [makeViaRoute("route-a", 0), makeViaRoute("route-b", 0.2)],
    obstacles: [],
    colorMap: {},
    layerCount: 2,
    connMap: new ConnectivityMap({ net0: ["route-a", "route-b"] }),
  })
  const [staleVia, keepVia] = solver.vias
  solver.mergedViaHdRoutes[staleVia!.routeIndex]!.vias = []
  ;(solver as any).getOffendingViaGroupsBatch = () => [
    { keep: keepVia, remove: [staleVia] },
  ]

  expect(() => solver.step()).not.toThrow()
  expect(solver.stats.mergedViaCount).toBe(0)
})
