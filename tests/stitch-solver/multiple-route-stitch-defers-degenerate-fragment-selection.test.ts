import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

const makeRoute = (
  regionId: string,
  points: Array<{ x: number; y: number; z: number }>,
): HighDensityIntraNodeRoute => ({
  connectionName: "degenerate-conn",
  rootConnectionName: "degenerate-conn",
  regionId,
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: points,
  vias: [],
  jumpers: [],
})

test("multiple stitch defers degenerate islands until connection-level path selection", (): void => {
  const connection: SimpleRouteConnection = {
    name: "degenerate-conn",
    pointsToConnect: [
      { x: 0, y: 0, layer: "top" },
      { x: 2, y: 0, layer: "top" },
    ],
  }
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [connection],
    layerCount: 2,
    hdRoutes: [
      makeRoute("left", [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ]),
      makeRoute("degenerate", [{ x: 1, y: 0, z: 0 }]),
      makeRoute("right", [
        { x: 1.2, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ]),
    ],
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoutes).toHaveLength(1)
  expect(solver.mergedHdRoutes[0]?.route).toEqual([
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 1.2, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
  ])
})
