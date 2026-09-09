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

test("original-copper advancement preserves short bends and a layer transition", (): void => {
  const inputRoute: HighDensityRoute = {
    connectionName: "signal",
    startPcbPortId: "start",
    endPcbPortId: "end",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 0.1, y: 0, z: 0 },
      { x: 0.1, y: 0.1, z: 0 },
      { x: 0.2, y: 0.1, z: 0 },
      { x: 0.2, y: 0.2, z: 0 },
      { x: 0.3, y: 0.2, z: 0 },
      { x: 0.3, y: 0.2, z: 1 },
      { x: 0.4, y: 0.2, z: 1 },
      { x: 0.4, y: 0.3, z: 1 },
      { x: 1, y: 0.3, z: 1 },
    ],
    vias: [{ x: 0.3, y: 0.2 }],
  }
  const leadingViaRoute: HighDensityRoute = {
    ...inputRoute,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0.1, y: 0, z: 1 },
      { x: 0.1, y: 0.1, z: 1 },
      { x: 0.2, y: 0.1, z: 1 },
      { x: 0.2, y: 0.2, z: 1 },
      { x: 1, y: 0.2, z: 1 },
    ],
    vias: [{ x: 0, y: 0 }],
  }

  for (const route of [inputRoute, leadingViaRoute]) {
    const originalRoute = structuredClone(route)
    const solver = new OriginalCopperOnlySimplifier({
      inputRoute: route,
      otherHdRoutes: [],
      obstacles: [],
      connMap: new ConnectivityMap({}),
      colorMap: {},
    })

    solver.solve()

    expect(solver.failed).toBeFalse()
    expect(solver.rejectedPathCount).toBeGreaterThan(0)
    expect(solver.simplifiedRoute).toMatchObject(route)
    expect(solver.simplifiedRoute.vias).toEqual(route.vias)
    expect(route).toEqual(originalRoute)
  }
})
