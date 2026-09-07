import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SingleSimplifiedPathSolver5 } from "lib/solvers/SimplifiedPathSolver/SingleSimplifiedPathSolver5_Deg45"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("wide peer copper remains in both path prefilter and segment-tree queries", (): void => {
  const inputRoute: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: -3, y: 0.5, z: 0 },
      { x: -3, y: 1.4, z: 0 },
      { x: 3, y: 1.4, z: 0 },
      { x: 3, y: 0.5, z: 0 },
    ],
    vias: [],
  }
  for (const widths of [
    { nominal: 1, endpoint: undefined },
    { nominal: 0.15, endpoint: 1 },
  ]) {
    const peer: HighDensityRoute = {
      connectionName: "foreign",
      traceThickness: widths.nominal,
      viaDiameter: 0.3,
      route: [
        { x: -2, y: 0, z: 0 },
        { x: 2, y: 0, z: 0, traceThickness: widths.endpoint },
      ],
      vias: [],
    }
    const originalPeer = structuredClone(peer)
    const sameNetPeer: HighDensityRoute = {
      ...peer,
      connectionName: inputRoute.connectionName,
      traceThickness: 10,
    }
    for (const compatibilityOption of [undefined, false, true]) {
      const solver = new SingleSimplifiedPathSolver5({
        inputRoute,
        otherHdRoutes: [peer, sameNetPeer],
        obstacles: [],
        connMap: new ConnectivityMap({}),
        colorMap: {},
        minTraceToPadEdgeClearance: 0.5,
        useTraceWidthAwareClearance: compatibilityOption,
      })
      const start = { x: -0.5, y: 0.5, z: 0 }
      const end = { x: 0.5, y: 0.5, z: 0 }
      expect(solver.filteredObstaclePathSegments).toHaveLength(1)
      expect(solver.segmentTree.SEGMENT_MARGIN).toBeCloseTo(0.675)
      expect(
        solver.segmentTree.getSegmentsThatCouldIntersect(start, end),
      ).toHaveLength(1)
      expect(solver.isValidPathSegment(start, end)).toBeFalse()
      expect(
        solver.isValidPathSegment(
          { x: -0.5, y: 1, z: 0 },
          { x: 0.5, y: 1, z: 0 },
        ),
      ).toBeTrue()
      expect(
        solver.isValidPathSegment({ ...start, z: 1 }, { ...end, z: 1 }),
      ).toBeTrue()
    }
    expect(peer).toEqual(originalPeer)
  }
})
