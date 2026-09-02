import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { canSectionMoveToLayer } from "lib/solvers/UselessViaRemovalSolver/can-section-move-to-layer"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("layer move checks the via pad radius rather than the other trace width", (): void => {
  const route: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 1 },
      { x: 2, y: 0, z: 1 },
    ],
    vias: [],
  }
  const nearbyVia: HighDensityRoute = {
    connectionName: "other_net",
    traceThickness: 0.1,
    viaDiameter: 0.6,
    route: [
      { x: 1, y: 0.2, z: 0 },
      { x: 1, y: 0.2, z: 1 },
    ],
    vias: [{ x: 1, y: 0.2 }],
  }
  const canMove = canSectionMoveToLayer({
    currentSection: {
      points: route.route,
      z: 1,
      startIndex: 0,
      endIndex: 1,
    },
    targetZ: 0,
    route,
    hdRouteSHI: new HighDensityRouteSpatialIndex([nearbyVia]),
    obstacleSHI: new ObstacleSpatialHashIndex("flatbush", []),
    connMap: new ConnectivityMap({}),
    defaultTraceThickness: route.traceThickness,
    obstacleMargin: 0,
  })

  expect(canMove).toBeFalse()
})
