import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { GlobalLayerAssignmentSolver } from "lib/solvers/GlobalLayerAssignmentSolver/GlobalLayerAssignmentSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("globally coordinates layer flips to remove vias without creating a crossing", () => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "horizontal",
      rootConnectionName: "horizontal",
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
    },
    {
      connectionName: "vertical",
      rootConnectionName: "vertical",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: -2, z: 1 },
        { x: 0, y: -1, z: 1 },
        { x: 0, y: -1, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 1, z: 1 },
        { x: 0, y: 2, z: 1 },
      ],
      vias: [
        { x: 0, y: -1 },
        { x: 0, y: 1 },
      ],
    },
  ]
  const solver = new GlobalLayerAssignmentSolver({
    hdRoutes: routes,
    obstacles: [],
    connMap: new ConnectivityMap({}),
    layerCount: 2,
  })

  solver.solve()

  const output = solver.getOutput()
  expect(output.flatMap((route) => route.vias)).toHaveLength(0)
  expect(output[0]!.route.every((point) => point.z === 0)).toBe(true)
  expect(output[1]!.route.every((point) => point.z === 1)).toBe(true)
  expect(solver.stats.viasRemoved).toBe(4)
})
