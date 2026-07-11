import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import { selectRoutesAlongEndpointPath } from "lib/solvers/RouteStitchingSolver/routeStitchingEndpointHelpers"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

const makeRoute = (
  regionId: string,
  points: Array<{ x: number; y: number; z: number }>,
): HighDensityIntraNodeRoute => ({
  connectionName: "conn",
  rootConnectionName: "conn",
  regionId,
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: points,
  vias: [],
  jumpers: [],
})

test("endpoint path selection prefers a continuous fragment chain over nearby shortcuts and branches", (): void => {
  const start = { x: 0, y: 0, z: 0 }
  const end = { x: 0.9, y: 0, z: 0 }
  const mainA = makeRoute("main-a", [start, { x: 0.45, y: 0, z: 0 }])
  const mainB = makeRoute("main-b", [{ x: 0.45, y: 0, z: 0 }, end])
  const branch = makeRoute("branch", [
    { x: 0.45, y: 0, z: 0 },
    { x: 0.45, y: 0.4, z: 0 },
  ])
  const smallGapShortcut = makeRoute("small-gap-shortcut", [
    { x: 0.05, y: 0.05, z: 0 },
    end,
  ])

  const selectedRoutes = selectRoutesAlongEndpointPath({
    connectionName: "conn",
    hdRoutes: [branch, smallGapShortcut, mainB, mainA],
    start,
    end,
    canStitchBetweenTerminals: (selection): boolean => {
      const solver = new SingleHighDensityRouteStitchSolver3(selection)
      solver.solve()
      return (
        solver.solved && !solver.failed && solver.remainingHdRoutes.length === 0
      )
    },
  })

  expect(selectedRoutes.map((route) => route.regionId)).toEqual([
    "main-a",
    "main-b",
  ])
})
