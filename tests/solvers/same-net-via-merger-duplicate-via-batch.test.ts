import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

const makeViaRoute = (
  connectionName: string,
  x: number,
  duplicateVia = false,
): HighDensityRoute => ({
  connectionName,
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: [
    { x, y: 0, z: 0 },
    { x, y: 0, z: 1 },
  ],
  vias: duplicateVia
    ? [
        { x, y: 0 },
        { x, y: 0 },
      ]
    : [{ x, y: 0 }],
})

test("SameNetViaMergerSolver canonicalizes duplicate physical vias before batching merges", () => {
  const solver = new SameNetViaMergerSolver({
    inputHdRoutes: [
      makeViaRoute("route-with-duplicate", 0, true),
      makeViaRoute("nearby-route", 0.1),
    ],
    obstacles: [],
    colorMap: {},
    layerCount: 2,
    connMap: new ConnectivityMap({
      net0: ["route-with-duplicate", "nearby-route"],
    }),
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.getMergedViaHdRoutes()?.flatMap((route) => route.vias)).toEqual(
    [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ],
  )
})
