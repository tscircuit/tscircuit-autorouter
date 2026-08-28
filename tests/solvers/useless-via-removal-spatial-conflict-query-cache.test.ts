import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { SingleRouteUselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/SingleRouteUselessViaRemovalSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("memoizes only identical spatial conflict queries within one route solve", () => {
  const route: HighDensityRoute = {
    connectionName: "cached_query_net",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
    vias: [],
  }
  let indexCallCount = 0
  const hdRouteSHI = {
    getConflictingRoutesForSegment: () => {
      indexCallCount++
      return [{ conflictingRoute: route, distance: indexCallCount }]
    },
  } as unknown as HighDensityRouteSpatialIndex
  const solver = new SingleRouteUselessViaRemovalSolver({
    obstacleSHI: new ObstacleSpatialHashIndex("flatbush", []),
    hdRouteSHI,
    unsimplifiedRoute: route,
    connMap: new ConnectivityMap({ cached_query_net: [route.connectionName] }),
  })
  const memoizedIndex = (
    solver as unknown as {
      memoizedHdRouteSHI: Pick<
        HighDensityRouteSpatialIndex,
        "getConflictingRoutesForSegment"
      >
    }
  ).memoizedHdRouteSHI
  const baseStart = { x: 1, y: 2, z: 0 }
  const baseEnd = { x: 4, y: 5, z: 1 }
  const queries: Array<
    Parameters<HighDensityRouteSpatialIndex["getConflictingRoutesForSegment"]>
  > = [
    [baseStart, baseEnd, 0.7],
    [{ ...baseStart, x: 11 }, baseEnd, 0.7],
    [{ ...baseStart, y: 12 }, baseEnd, 0.7],
    [{ ...baseStart, z: 2 }, baseEnd, 0.7],
    [baseStart, { ...baseEnd, x: 14 }, 0.7],
    [baseStart, { ...baseEnd, y: 15 }, 0.7],
    [baseStart, { ...baseEnd, z: 3 }, 0.7],
    [baseStart, baseEnd, 0.8],
    [baseEnd, baseStart, 0.7],
  ]

  const observedDistances = queries.flatMap((query) => [
    memoizedIndex.getConflictingRoutesForSegment(...query)[0]?.distance,
    memoizedIndex.getConflictingRoutesForSegment(...query)[0]?.distance,
  ])

  expect(indexCallCount).toBe(queries.length)
  expect(observedDistances).toEqual(
    queries.flatMap((_, index) => [index + 1, index + 1]),
  )
})
