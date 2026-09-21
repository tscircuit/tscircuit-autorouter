import { expect, test } from "bun:test"
import { segmentToBoundsMinDistance } from "@tscircuit/math-utils"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SingleSimplifiedPathSolver5 } from "lib/solvers/SimplifiedPathSolver/SingleSimplifiedPathSolver5_Deg45"
import type { HighDensityRoute } from "lib/types/high-density-types"

type RoutePoint = HighDensityRoute["route"][number]

test("segment prefilter preserves exact clearance candidates at edges and corners", (): void => {
  const inputRoute: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.2,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
    ],
  }
  const bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 }

  for (const useTraceWidthAwareClearance of [false, true]) {
    const margin = useTraceWidthAwareClearance ? 0.1 + 0.2 / 2 + 0.8 / 2 : 0.25
    const segments: Array<[RoutePoint, RoutePoint]> = [
      [
        { x: -2, y: -2, z: 0 },
        { x: 3, y: 3, z: 0 },
      ],
      [
        { x: -2, y: 3, z: 0 },
        { x: 3, y: -2, z: 0 },
      ],
      [
        { x: 0.5, y: 0.5, z: 0 },
        { x: 0.5, y: 0.5, z: 0 },
      ],
      [
        { x: -margin, y: 0, z: 0 },
        { x: -margin, y: 1, z: 0 },
      ],
    ]
    for (const distance of [margin - 1e-8, margin, margin + 1e-8, 10]) {
      segments.push(
        [
          { x: 0, y: -distance, z: 0 },
          { x: 1, y: -distance, z: 0 },
        ],
        [
          { x: 0, y: 1 + distance, z: 0 },
          { x: 1, y: 1 + distance, z: 0 },
        ],
        [
          { x: -distance, y: 0, z: 0 },
          { x: -distance, y: 1, z: 0 },
        ],
        [
          { x: 1 + distance, y: 0, z: 0 },
          { x: 1 + distance, y: 1, z: 0 },
        ],
        [
          { x: -distance, y: 0, z: 0 },
          { x: 0, y: -distance, z: 0 },
        ],
        [
          { x: 1, y: 1 + distance, z: 0 },
          { x: 1 + distance, y: 1, z: 0 },
        ],
      )
    }
    const otherHdRoutes: HighDensityRoute[] = segments.map((route, index) => ({
      connectionName: `peer-${index}`,
      traceThickness: 0.8,
      viaDiameter: 0.3,
      vias: [],
      route,
    }))
    const solver = new SingleSimplifiedPathSolver5({
      inputRoute,
      otherHdRoutes,
      obstacles: [],
      connMap: new ConnectivityMap({}),
      colorMap: {},
      useTraceWidthAwareClearance,
    })
    const expectedSegments = segments.filter(
      ([start, end]) =>
        segmentToBoundsMinDistance(start, end, bounds) <= margin,
    )

    expect(solver.filteredObstaclePathSegments).toEqual(expectedSegments)
    expect(solver.filteredObstaclePathSegments).toContainEqual(segments[3])
    expect(expectedSegments.length).toBeLessThan(segments.length)
  }
})
