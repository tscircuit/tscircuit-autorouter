import { expect, test } from "bun:test"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("segment conflicts ignore copper on other layers but still include vias", () => {
  const bottomRoute: HighDensityRoute = {
    connectionName: "bottom_route",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 1 },
      { x: 2, y: 0, z: 1 },
    ],
    vias: [],
  }
  const viaRoute: HighDensityRoute = {
    connectionName: "via_route",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 1, y: 1, z: 0 },
      { x: 1, y: 1, z: 1 },
    ],
    vias: [{ x: 1, y: 1 }],
  }
  const spatialIndex = new HighDensityRouteSpatialIndex([bottomRoute, viaRoute])

  const conflicts = spatialIndex.getConflictingRoutesForSegment(
    { x: 0, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
    1,
  )

  expect(
    conflicts.map(({ conflictingRoute }) => conflictingRoute.connectionName),
  ).toEqual(["via_route"])
})
