import { expect, test } from "bun:test"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { getSameLayerSpanCollapseCandidates } from "lib/solvers/FinalViaOptimizationSolver/try-collapse-same-layer-span"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("final via optimization collapses a maximal multilayer same-layer excursion", () => {
  const srj = {
    layerCount: 3,
    minTraceWidth: 0.1,
    bounds: { minX: -3, minY: -2, maxX: 3, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "trace",
        pointsToConnect: [
          { x: -2, y: 0, layer: "top", pointId: "start" },
          { x: 2, y: 0, layer: "top", pointId: "end" },
        ],
      },
    ],
  }
  const route: HighDensityRoute = {
    connectionName: "trace",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [
      { x: -1, y: 0 },
      { x: -0.25, y: 0 },
      { x: 0.25, y: 0 },
      { x: 1, y: 0 },
    ],
    route: [
      { x: -2, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: -1, y: 0, z: 1 },
      { x: -0.25, y: 0, z: 1 },
      { x: -0.25, y: 0, z: 2 },
      { x: 0.25, y: 0, z: 2 },
      { x: 0.25, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
  }

  const candidates = getSameLayerSpanCollapseCandidates({
    route,
    hdRouteSHI: new HighDensityRouteSpatialIndex([route]),
    obstacleSHI: new ObstacleSpatialHashIndex("flatbush", []),
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
  })

  expect(candidates[0]?.removedTransitionCount).toBe(4)
  expect(candidates[0]?.route.vias).toEqual([])
})
