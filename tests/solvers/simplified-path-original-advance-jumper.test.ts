import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SingleSimplifiedPathSolver5 } from "lib/solvers/SimplifiedPathSolver/SingleSimplifiedPathSolver5_Deg45"
import type { HighDensityRoute } from "lib/types/high-density-types"

type Point = HighDensityRoute["route"][number]

class OriginalCopperOnlySimplifier extends SingleSimplifiedPathSolver5 {
  rejectedPathCount = 0

  override isValidPath(points: Point[]): boolean {
    const segmentCount = points.length - 1
    if (segmentCount === 0) {
      return true
    }
    this.rejectedPathCount++
    return false
  }
}

test("original-copper advancement retains jumper pads and their approach bends", (): void => {
  const inputRoute: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -0.5, y: 0, z: 0 },
      { x: -0.4, y: 0, z: 0 },
      { x: -0.4, y: 0.1, z: 0 },
      { x: -0.3, y: 0.1, z: 0 },
      { x: -0.3, y: 0.2, z: 0 },
      { x: 0.5, y: 0.2, z: 0 },
      { x: 0.5, y: 0.5, z: 0, insideJumperPad: true },
      { x: 2.15, y: 0.5, z: 0, insideJumperPad: true },
      { x: 2.15, y: 0.8, z: 0 },
      { x: 2.25, y: 0.8, z: 0 },
      { x: 2.25, y: 1.5, z: 0 },
    ],
    vias: [],
    jumpers: [
      {
        route_type: "jumper",
        footprint: "0603",
        start: { x: 0.5, y: 0.5 },
        end: { x: 2.15, y: 0.5 },
      },
    ],
  }
  const originalRoute = structuredClone(inputRoute)
  const solver = new OriginalCopperOnlySimplifier({
    inputRoute,
    otherHdRoutes: [],
    obstacles: [],
    connMap: new ConnectivityMap({}),
    colorMap: {},
  })

  solver.solve()

  expect(solver.failed).toBeFalse()
  expect(solver.rejectedPathCount).toBeGreaterThan(0)
  expect(solver.simplifiedRoute.route).toEqual(inputRoute.route)
  expect(solver.simplifiedRoute.jumpers).toEqual(inputRoute.jumpers)
  expect(inputRoute).toEqual(originalRoute)
})
