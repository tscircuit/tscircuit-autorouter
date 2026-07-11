import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

const makeRoute = (
  points: Array<{ x: number; y: number; z: number }>,
): HighDensityIntraNodeRoute => ({
  connectionName: "conn",
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: points,
  vias: [],
  jumpers: [],
})

test("single stitch preserves terminal layers with coincident vias", () => {
  const startTransitionSolver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "conn",
    start: { x: 0, y: 0, z: 0 },
    end: { x: 2, y: 0, z: 5 },
    hdRoutes: [
      makeRoute([
        { x: 0, y: 0, z: 5 },
        { x: 2, y: 0, z: 5 },
      ]),
    ],
  })
  startTransitionSolver.solve()

  expect(startTransitionSolver.solved).toBe(true)
  expect(startTransitionSolver.failed).toBe(false)
  expect(startTransitionSolver.mergedHdRoute.route).toEqual([
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 5 },
    { x: 2, y: 0, z: 5 },
  ])
  expect(startTransitionSolver.mergedHdRoute.vias).toEqual([{ x: 0, y: 0 }])

  const endTransitionSolver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "conn",
    start: { x: 0, y: 0, z: 0 },
    end: { x: 2, y: 0, z: 5 },
    hdRoutes: [
      makeRoute([
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ]),
    ],
  })
  endTransitionSolver.solve()

  expect(endTransitionSolver.solved).toBe(true)
  expect(endTransitionSolver.failed).toBe(false)
  expect(endTransitionSolver.mergedHdRoute.route).toEqual([
    { x: 0, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
    { x: 2, y: 0, z: 5 },
  ])
  expect(endTransitionSolver.mergedHdRoute.vias).toEqual([{ x: 2, y: 0 }])
})
