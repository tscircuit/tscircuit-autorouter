import { expect, test } from "bun:test"
import { segmentToBoxMinDistance } from "@tscircuit/math-utils"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SingleSimplifiedPathSolver5 } from "lib/solvers/SimplifiedPathSolver/SingleSimplifiedPathSolver5_Deg45"
import type { Obstacle } from "lib/types"
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

class PrefixOnlySimplifier extends SingleSimplifiedPathSolver5 {
  override isValidPath(points: Point[]): boolean {
    const endPoint = points[points.length - 1]
    if (!endPoint) {
      throw new Error("Expected a proposed simplification path")
    }
    if (endPoint.x > 0.5 || endPoint.y !== 0) {
      return false
    }
    return super.isValidPath(points)
  }
}

test("rejected shortcuts retain every original corner without an interpolated connector", (): void => {
  const inputRoute: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -2, y: 0, z: 0 },
      { x: -1.9, y: 0, z: 0 },
      { x: -1.9, y: 0.1, z: 0 },
      { x: -1.8, y: 0.1, z: 0 },
      { x: -1.8, y: 0.2, z: 0 },
      { x: -0.3, y: 0.2, z: 0 },
      { x: -0.3, y: 1, z: 0 },
      { x: 0.3, y: 1, z: 0 },
      { x: 0.3, y: 0.2, z: 0 },
      { x: 2, y: 0.2, z: 0 },
    ],
    vias: [],
  }
  const originalRoute = structuredClone(inputRoute)
  const obstacle: Obstacle = {
    type: "rect",
    center: { x: 0, y: 0.6 },
    width: 0.2,
    height: 0.2,
    layers: ["top"],
    __zLayers: [0],
    connectedTo: ["foreign"],
  }
  const solver = new OriginalCopperOnlySimplifier({
    inputRoute,
    otherHdRoutes: [],
    obstacles: [obstacle],
    connMap: new ConnectivityMap({}),
    colorMap: {},
  })

  solver.solve()

  expect(solver.failed).toBeFalse()
  expect(solver.rejectedPathCount).toBeGreaterThan(0)
  expect(solver.simplifiedRoute.route).toEqual(inputRoute.route)
  expect(inputRoute).toEqual(originalRoute)
  for (let index = 1; index < solver.newRoute.length; index++) {
    expect(
      solver.isValidPathSegment(
        solver.newRoute[index - 1]!,
        solver.newRoute[index]!,
      ),
    ).toBeTrue()
  }

  const prefixRoute: HighDensityRoute = {
    connectionName: "interpolated-prefix",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 3, y: 0, z: 0, traceThickness: 0.1 },
      { x: 3, y: 1, z: 0 },
      { x: 4, y: 1, z: 0 },
    ],
    vias: [],
  }
  const originalPrefixRoute = structuredClone(prefixRoute)
  const prefixSolver = new PrefixOnlySimplifier({
    inputRoute: prefixRoute,
    otherHdRoutes: [],
    obstacles: [],
    connMap: new ConnectivityMap({}),
    colorMap: {},
  })

  prefixSolver.solve()

  expect(prefixSolver.failed).toBeFalse()
  expect(
    prefixSolver.newRoute.filter((point, index, points): boolean => {
      const previousPoint = points[index - 1]
      return (
        !previousPoint ||
        point.x !== previousPoint.x ||
        point.y !== previousPoint.y ||
        point.z !== previousPoint.z
      )
    }),
  ).toEqual([
    { x: 0, y: 0, z: 0 },
    { x: 0.5, y: 0, z: 0 },
    ...prefixRoute.route.slice(1),
  ])
  expect(prefixRoute).toEqual(originalPrefixRoute)

  const pad: Obstacle = {
    type: "rect",
    center: { x: 0, y: 0 },
    width: 0.36,
    height: 0.36,
    layers: ["top"],
    __zLayers: [0],
    connectedTo: ["foreign-pad"],
  }
  const cornerRoute: HighDensityRoute = {
    connectionName: "pad-corner",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -1, y: -0.4, z: 0 },
      { x: 0.18, y: -0.4, z: 0 },
      { x: 0.4, y: -0.18, z: 0 },
      { x: 0.4, y: 1, z: 0 },
    ],
    vias: [],
  }
  const cornerSolver = new SingleSimplifiedPathSolver5({
    inputRoute: cornerRoute,
    otherHdRoutes: [],
    obstacles: [pad],
    connMap: new ConnectivityMap({}),
    colorMap: {},
  })

  cornerSolver.solve()

  expect(cornerSolver.failed).toBeFalse()
  expect(cornerSolver.newRoute[0]).toEqual(cornerRoute.route[0])
  expect(cornerSolver.newRoute.at(-1)).toEqual(cornerRoute.route.at(-1))
  for (let index = 1; index < cornerSolver.newRoute.length; index++) {
    const physicalClearance =
      segmentToBoxMinDistance(
        cornerSolver.newRoute[index - 1]!,
        cornerSolver.newRoute[index]!,
        pad,
      ) -
      cornerRoute.traceThickness / 2
    expect(physicalClearance).toBeGreaterThanOrEqual(0.1 - 1e-12)
  }
})
