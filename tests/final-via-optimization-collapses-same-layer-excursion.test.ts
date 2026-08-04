import { expect, test } from "bun:test"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { tryCollapseSameLayerSpan } from "lib/solvers/FinalViaOptimizationSolver/try-collapse-same-layer-span"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("final via optimization collapses a clear top-bottom-top excursion", () => {
  const srj = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "trace",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top", pointId: "start" },
          { x: 1, y: 0, layer: "top", pointId: "end" },
        ],
      },
    ],
  }
  const route: HighDensityRoute = {
    connectionName: "trace",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [
      { x: -0.5, y: 0 },
      { x: 0.5, y: 0 },
    ],
    route: [
      { x: -1, y: 0, z: 0 },
      { x: -0.5, y: 0, z: 0 },
      { x: -0.5, y: 0, z: 1 },
      { x: 0.5, y: 0, z: 1 },
      { x: 0.5, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
  }

  const collapsed = tryCollapseSameLayerSpan({
    route,
    hdRouteSHI: new HighDensityRouteSpatialIndex([route]),
    obstacleSHI: new ObstacleSpatialHashIndex("flatbush", []),
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
  })

  expect(collapsed?.vias).toEqual([])
  expect(collapsed?.route.every((point) => point.z === 0)).toBe(true)
})
