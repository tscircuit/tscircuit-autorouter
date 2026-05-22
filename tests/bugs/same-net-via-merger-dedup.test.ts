import { expect, test } from "bun:test"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("SameNetViaMergerSolver deduplicates merged vias on the same net", () => {
  // Set up input routes where one route has two close vias that will merge
  const inputHdRoutes: HighDensityRoute[] = [
    {
      connectionName: "netA",
      traceThickness: 0.2,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 0.1, y: 0, z: 1 },
        { x: 0.1, y: 0, z: 0 },
      ],
      vias: [
        { x: 0, y: 0 },
        { x: 0.1, y: 0 },
      ],
    },
  ]

  const solver = new SameNetViaMergerSolver({
    inputHdRoutes,
    obstacles: [],
    colorMap: {},
    layerCount: 2,
    connMap: {
      netMap: {},
      idToNetMap: {
        netA: "netA",
      },
    } as any,
  })

  solver.solve()

  const outputRoutes = solver.getMergedViaHdRoutes()
  expect(outputRoutes).toHaveLength(1)

  const vias = outputRoutes![0].vias
  // The two vias are at distance 0.1, which is <= viaDiameter (0.3).
  // They should be merged into a single via location, and deduplicated.
  expect(vias.length).toBe(1)
})
