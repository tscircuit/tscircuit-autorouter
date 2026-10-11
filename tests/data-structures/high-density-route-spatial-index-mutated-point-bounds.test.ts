import { expect, test } from "bun:test"
import { HighDensityRouteSpatialIndex, type HighDensityRoute } from "lib/data-structures/HighDensityRouteSpatialIndex"

test("coarse buckets retain exact copper boundaries after indexed endpoint edits", () => {
  const route: HighDensityRoute = {
    connectionName: "moving_trace", traceThickness: 0.2, viaDiameter: 0.3,
    route: [{ x: 0, y: 0, z: 0 }, { x: 0.9, y: 0, z: 0 }], vias: [],
  }
  const index = new HighDensityRouteSpatialIndex([route], 1)
  expect(index.getConflictingRoutesNearPoint({ x: 0.4, y: 0.149, z: 0 }, 0.05)).toEqual([
    { conflictingRoute: route, distance: 0.149 },
  ])
  expect(index.getConflictingRoutesNearPoint({ x: 0.4, y: 0.151, z: 0 }, 0.05)).toEqual([])
  // Editing points within their existing cells retains valid bucket ownership.
  // A cached constructor-time centerline box would omit this new conflict.
  for (const point of route.route) point.y = 0.8
  expect(index.getConflictingRoutesNearPoint({ x: 0.4, y: 0, z: 0 }, 0.05)).toEqual([])
  const conflicts = index.getConflictingRoutesForSegment(
    { x: 0.3, y: 0.7, z: 0 }, { x: 0.6, y: 0.7, z: 0 }, 0.05,
  )
  expect(conflicts.length).toBe(1)
  expect(conflicts[0]!.conflictingRoute).toBe(route)
  expect(conflicts[0]!.distance).toBeCloseTo(0.1, 14)
  expect(index.getConflictingRoutesForSegment(
    { x: 0.3, y: 0.951, z: 0 }, { x: 0.6, y: 0.951, z: 0 }, 0.05,
  )).toEqual([])
  index.removeRoute(route.connectionName)
  expect(index.getConflictingRoutesNearPoint({ x: 0.4, y: 0.8, z: 0 }, 0.05)).toEqual([])
  index.addRoute(route)
  expect(index.getConflictingRoutesNearPoint({ x: 0.4, y: 0.8, z: 0 }, 0.05)).toEqual([
    { conflictingRoute: route, distance: 0 },
  ])
})
