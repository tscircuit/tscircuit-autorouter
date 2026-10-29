import { expect, test } from "bun:test"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("route spatial index includes neighboring-bucket copper within clearance", () => {
  const neighboringRoute: HighDensityRoute = {
    connectionName: "neighboring_route",
    traceThickness: 0.15,
    viaDiameter: 0.5,
    route: [
      { x: 1.04, y: 0, z: 0 },
      { x: 1.04, y: 1, z: 0 },
    ],
    vias: [],
  }
  const spatialIndex = new HighDensityRouteSpatialIndex([neighboringRoute], 1)

  const conflicts = spatialIndex.getConflictingRoutesForSegment(
    { x: 0.8, y: 0, z: 0 },
    { x: 0.8, y: 1, z: 0 },
    0.075 + 0.1,
  )
  expect(conflicts).toHaveLength(1)
  expect(conflicts[0]!.conflictingRoute).toBe(neighboringRoute)
  expect(conflicts[0]!.distance).toBeCloseTo(0.24, 10)

  const pointConflicts = spatialIndex.getConflictingRoutesNearPoint(
    { x: 0.8, y: 0.5, z: 0 },
    0.075 + 0.1,
  )
  expect(pointConflicts).toHaveLength(1)
  expect(pointConflicts[0]!.conflictingRoute).toBe(neighboringRoute)
  expect(pointConflicts[0]!.distance).toBeCloseTo(0.24, 10)
})
