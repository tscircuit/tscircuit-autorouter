import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

function createRouteFragment({
  regionId,
  points,
}: {
  regionId: string
  points: Array<{ x: number; y: number; z: number }>
}): HighDensityIntraNodeRoute {
  return {
    connectionName: "trace-a",
    regionId,
    route: points,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
  }
}

test("visualizes route stitching around a blocking obstacle", () => {
  const routes = [
    createRouteFragment({
      regionId: "main",
      points: [
        { x: -2, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
      ],
    }),
    createRouteFragment({
      regionId: "escape-1",
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0.5, z: 0 },
      ],
    }),
    createRouteFragment({
      regionId: "escape-2",
      points: [
        { x: 0, y: 0.5, z: 0 },
        { x: 0.9, y: 0.5, z: 0 },
      ],
    }),
    createRouteFragment({
      regionId: "escape-3",
      points: [
        { x: 0.9, y: 0.5, z: 0 },
        { x: 0.9, y: 0, z: 0 },
      ],
    }),
  ]

  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [
      {
        name: "trace-a",
        pointsToConnect: [
          { x: -2, y: 0, layer: "top" },
          { x: 0.9, y: 0, layer: "top" },
        ],
      },
    ],
    hdRoutes: routes,
    layerCount: 2,
    obstacles: [
      {
        type: "rect",
        componentId: "blocker",
        layers: ["top"],
        center: { x: 0.45, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["other-net"],
      },
    ],
  } as ConstructorParameters<typeof MultipleHighDensityRouteStitchSolver3>[0])

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(getSvgFromGraphicsObject(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
    { tolerance: 0 },
  )
})
