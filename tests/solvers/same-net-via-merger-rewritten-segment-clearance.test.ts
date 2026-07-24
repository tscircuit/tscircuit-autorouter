import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

const makeViaRoute = ({
  connectionName,
  viaX,
}: {
  connectionName: string
  viaX: number
}): HighDensityRoute => ({
  connectionName,
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: [
    { x: viaX, y: 1, z: 0 },
    { x: viaX, y: 0, z: 0 },
    { x: viaX, y: 0, z: 1 },
  ],
  vias: [{ x: viaX, y: 0 }],
})

test("SameNetViaMergerSolver rejects moves whose rewritten route segment collides", () => {
  const routeA = makeViaRoute({ connectionName: "route-a", viaX: 0 })
  const routeB = makeViaRoute({ connectionName: "route-b", viaX: 0.6 })
  const blocker: HighDensityRoute = {
    connectionName: "blocker",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0.25, y: 0.5, z: 0 },
      { x: 0.35, y: 0.5, z: 0 },
    ],
    vias: [],
  }
  const solver = new SameNetViaMergerSolver({
    inputHdRoutes: [routeA, routeB, blocker],
    obstacles: [],
    colorMap: {},
    layerCount: 2,
    connMap: new ConnectivityMap({
      sharedNet: ["route-a", "route-b"],
      blockerNet: ["blocker"],
    }),
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.viaMerges).toEqual([])
  expect(solver.getMergedViaHdRoutes()?.flatMap((route) => route.vias)).toEqual(
    [
      { x: 0, y: 0 },
      { x: 0.6, y: 0 },
    ],
  )
})
