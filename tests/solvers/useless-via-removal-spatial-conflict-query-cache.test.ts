import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { UselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/UselessViaRemovalSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("segment conflict query memoization is opt-in and invalidated by route updates", async () => {
  const indexedRoute: HighDensityRoute = {
    connectionName: "indexed_route",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
    ],
    vias: [],
  }
  const queryStart = { x: 2, y: -1, z: 0 }
  const queryEnd = { x: 2, y: 1, z: 0 }
  const queryMargin = 0.1

  const defaultIndex = new HighDensityRouteSpatialIndex([indexedRoute])
  const firstDefaultResult = defaultIndex.getConflictingRoutesForSegment(
    queryStart,
    queryEnd,
    queryMargin,
  )
  const secondDefaultResult = defaultIndex.getConflictingRoutesForSegment(
    queryStart,
    queryEnd,
    queryMargin,
  )
  expect(secondDefaultResult).not.toBe(firstDefaultResult)
  expect(secondDefaultResult).toEqual(firstDefaultResult)
  expect(Object.isFrozen(firstDefaultResult)).toBe(false)

  const memoizedIndex = new HighDensityRouteSpatialIndex([indexedRoute], {
    memoizeSegmentConflictQueries: true,
  })
  const firstMemoizedResult = memoizedIndex.getConflictingRoutesForSegment(
    queryStart,
    queryEnd,
    queryMargin,
  )
  const secondMemoizedResult = memoizedIndex.getConflictingRoutesForSegment(
    queryStart,
    queryEnd,
    queryMargin,
  )
  expect(firstMemoizedResult).toHaveLength(1)
  expect(secondMemoizedResult).toBe(firstMemoizedResult)
  expect(Object.isFrozen(firstMemoizedResult)).toBe(true)
  expect(Object.isFrozen(firstMemoizedResult[0]!)).toBe(true)

  const distinctQueries: Array<
    Parameters<HighDensityRouteSpatialIndex["getConflictingRoutesForSegment"]>
  > = [
    [{ ...queryStart, x: 2.5 }, queryEnd, queryMargin],
    [{ ...queryStart, y: -1.5 }, queryEnd, queryMargin],
    [{ ...queryStart, z: 1 }, queryEnd, queryMargin],
    [queryStart, { ...queryEnd, x: 2.5 }, queryMargin],
    [queryStart, { ...queryEnd, y: 1.5 }, queryMargin],
    [queryStart, { ...queryEnd, z: 1 }, queryMargin],
    [queryStart, queryEnd, 0.2],
    [queryEnd, queryStart, queryMargin],
  ]
  for (const query of distinctQueries) {
    const distinctQueryResult =
      memoizedIndex.getConflictingRoutesForSegment(...query)
    expect(distinctQueryResult).not.toBe(firstMemoizedResult)
    expect(memoizedIndex.getConflictingRoutesForSegment(...query)).toBe(
      distinctQueryResult,
    )
  }

  memoizedIndex.removeRoute(indexedRoute.connectionName)
  const resultAfterRemoval = memoizedIndex.getConflictingRoutesForSegment(
    queryStart,
    queryEnd,
    queryMargin,
  )
  expect(resultAfterRemoval).toEqual([])
  expect(resultAfterRemoval).not.toBe(firstMemoizedResult)

  memoizedIndex.addRoute(indexedRoute)
  const resultAfterReadd = memoizedIndex.getConflictingRoutesForSegment(
    queryStart,
    queryEnd,
    queryMargin,
  )
  expect(resultAfterReadd).toHaveLength(1)
  expect(resultAfterReadd).not.toBe(resultAfterRemoval)
  expect(
    memoizedIndex.getConflictingRoutesForSegment(
      queryStart,
      queryEnd,
      queryMargin,
    ),
  ).toBe(resultAfterReadd)

  const viaRemovalSolver = new UselessViaRemovalSolver({
    unsimplifiedHdRoutes: [indexedRoute],
    obstacles: [],
    colorMap: {},
    layerCount: 2,
    connMap: new ConnectivityMap({
      indexed_route: [indexedRoute.connectionName],
    }),
  })
  const viaRemovalIndex = viaRemovalSolver.hdRouteSHI!
  const firstViaRemovalResult = viaRemovalIndex.getConflictingRoutesForSegment(
    queryStart,
    queryEnd,
    queryMargin,
  )
  const secondViaRemovalResult =
    viaRemovalIndex.getConflictingRoutesForSegment(
      queryStart,
      queryEnd,
      queryMargin,
    )
  expect(secondViaRemovalResult).toBe(firstViaRemovalResult)

  const phaseOffsets = [0, 6, 12]
  await expect(
    getSvgFromGraphicsObject({
      title: "Memoized segment conflict queries invalidate with route updates",
      lines: [
        ...phaseOffsets
          .filter((_, phaseIndex) => phaseIndex !== 1)
          .map((xOffset, phaseIndex) => ({
            points: indexedRoute.route.map((point) => ({
              x: point.x + xOffset,
              y: point.y,
            })),
            strokeColor: "#dc2626",
            strokeWidth: indexedRoute.traceThickness,
            label: phaseIndex === 0 ? "indexed route" : "re-added route",
          })),
        ...phaseOffsets.map((xOffset, phaseIndex) => ({
          points: [queryStart, queryEnd].map((point) => ({
            x: point.x + xOffset,
            y: point.y,
          })),
          strokeColor: phaseIndex === 1 ? "#64748b" : "#7c3aed",
          strokeWidth: 0.08,
          label:
            phaseIndex === 0
              ? "repeated query (cache hit)"
              : phaseIndex === 1
                ? "query after removal (no conflict)"
                : "query after re-add (cache rebuilt)",
        })),
      ],
      points: [],
      rects: [],
      circles: [],
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
