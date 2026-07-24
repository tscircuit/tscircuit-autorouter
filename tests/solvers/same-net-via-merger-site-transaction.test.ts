import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

const makeViaRoute = ({
  connectionName,
  viaX,
  startY,
}: {
  connectionName: string
  viaX: number
  startY: number
}): HighDensityRoute => ({
  connectionName,
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: [
    { x: viaX, y: startY, z: 0 },
    { x: viaX, y: 0, z: 0 },
    { x: viaX, y: 0, z: 1 },
  ],
  vias: [{ x: viaX, y: 0 }],
})

test("SameNetViaMergerSolver only moves complete physical via sites", () => {
  const routes: HighDensityRoute[] = [
    makeViaRoute({ connectionName: "site-a-upper", viaX: 0, startY: 1 }),
    makeViaRoute({ connectionName: "site-a-lower", viaX: 0, startY: -1 }),
    makeViaRoute({ connectionName: "site-b-upper", viaX: 0.6, startY: 1 }),
    makeViaRoute({ connectionName: "site-b-lower", viaX: 0.6, startY: -1 }),
    {
      connectionName: "lower-segment-blocker",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0.25, y: -0.5, z: 0 },
        { x: 0.35, y: -0.5, z: 0 },
      ],
      vias: [],
    },
  ]
  const solver = new SameNetViaMergerSolver({
    inputHdRoutes: routes,
    obstacles: [],
    colorMap: {},
    layerCount: 2,
    connMap: new ConnectivityMap({
      sharedNet: [
        "site-a-upper",
        "site-a-lower",
        "site-b-upper",
        "site-b-lower",
      ],
      blockerNet: ["lower-segment-blocker"],
    }),
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.iterations).toBe(1)
  expect(solver.viaMerges).toEqual([])
  expect(solver.getMergedViaHdRoutes()).toEqual(routes)
})
