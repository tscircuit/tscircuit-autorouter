import { expect, test } from "bun:test"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("spatial queries distinguish same-name routes sharing a bucket", (): void => {
  const bottomRoute: HighDensityRoute = {
    connectionName: "shared_net",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0.4, z: 1 },
      { x: 1, y: 0.4, z: 1 },
    ],
    vias: [{ x: 0, y: 0.4 }],
  }
  const topRoute: HighDensityRoute = {
    ...bottomRoute,
    route: [
      { x: 0, y: 0.1, z: 0 },
      { x: 1, y: 0.1, z: 0 },
    ],
    vias: [{ x: 0, y: 0.1 }],
  }
  const index = new HighDensityRouteSpatialIndex([bottomRoute, topRoute])
  const start = { x: 0, y: 0, z: 0 }
  const end = { x: 1, y: 0, z: 0 }

  expect(index.getConflictingRoutesForSegment(start, end, 0.1)).toEqual([
    { conflictingRoute: topRoute, distance: 0.1 },
  ])
  expect(index.getConflictingRoutesNearPoint(start, 0.1)).toEqual([
    { conflictingRoute: topRoute, distance: 0.1 },
  ])
  index.removeRoute(bottomRoute)
  expect(index.getConflictingRoutesForSegment(start, end, 0.1)).toHaveLength(1)
  index.removeRoute(topRoute.connectionName)
  expect(index.getConflictingRoutesForSegment(start, end, 0.1)).toEqual([])
  index.addRoute(topRoute)
  expect(index.getConflictingRoutesNearPoint(start, 0.1)).toEqual([
    { conflictingRoute: topRoute, distance: 0.1 },
  ])
  index.removeRoute(topRoute)
  expect(index.getConflictingRoutesNearPoint(start, 0.1)).toEqual([])
})
