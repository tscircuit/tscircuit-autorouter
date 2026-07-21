import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("SameNetViaMergerSolver ignores a via without an anchored transition", () => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "keep",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
      ],
      vias: [{ x: 0, y: 0 }],
    },
    {
      connectionName: "diagonal-transition",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: 1, y: 0, z: 1 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [{ x: 0.5, y: 0 }],
    },
  ]
  const solver = new SameNetViaMergerSolver({
    inputHdRoutes: routes,
    obstacles: [],
    colorMap: {},
    layerCount: 2,
    connMap: new ConnectivityMap({
      net0: routes.map((route) => route.connectionName),
    }),
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.getMergedViaHdRoutes()!.flatMap((route) => route.vias)).toEqual(
    [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
    ],
  )
})
