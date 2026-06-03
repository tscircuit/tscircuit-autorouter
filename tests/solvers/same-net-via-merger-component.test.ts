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

test("SameNetViaMergerSolver canonicalizes overlapping via components", () => {
  const solver = new SameNetViaMergerSolver({
    inputHdRoutes: [
      makeViaRoute("route-a", 0),
      makeViaRoute("route-b", 0.1),
      makeViaRoute("route-c", 0.2),
    ],
    obstacles: [],
    colorMap: {},
    layerCount: 2,
    connMap: new ConnectivityMap({}),
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.iterations).toBeLessThan(10)

  const routes = solver.getMergedViaHdRoutes()
  expect(routes).not.toBeNull()
  expect(routes!.flatMap((route) => route.vias)).toEqual([
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ])
})
