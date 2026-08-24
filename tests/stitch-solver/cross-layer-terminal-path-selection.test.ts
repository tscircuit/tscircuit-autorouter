import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("stitch path retains the via to a colocated cross-layer terminal", () => {
  const connectionName = "changed-preloaded-section"
  const routes: HighDensityIntraNodeRoute[] = [
    {
      connectionName,
      rootConnectionName: "shared-net",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 1, z: 0 },
        { x: 6, y: 0, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName,
      rootConnectionName: "shared-net",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 6, y: 0, z: 0 },
        { x: 6, y: 0, z: 10 },
      ],
      vias: [{ x: 6, y: 0 }],
    },
    {
      connectionName,
      rootConnectionName: "shared-net",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [{ x: 2, y: 2, z: 0 }],
      vias: [],
    },
  ]
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [
      {
        name: connectionName,
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 6.2, y: 0, layer: "inner10" },
        ],
      },
    ],
    hdRoutes: routes,
    layerCount: 12,
    defaultViaDiameter: 0.3,
  })

  solver.solve()

  expect(solver.failed).toBeFalse()
  expect(solver.mergedHdRoutes).toHaveLength(1)
  expect([
    solver.mergedHdRoutes[0]!.route[0],
    solver.mergedHdRoutes[0]!.route.at(-1),
  ]).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ x: 0, y: 0, z: 0 }),
      expect.objectContaining({ x: 6.2, y: 0, z: 10 }),
    ]),
  )
  expect(solver.mergedHdRoutes[0]!.vias).toEqual([{ x: 6, y: 0 }])
})
