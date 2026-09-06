import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { canSectionMoveToLayer } from "lib/solvers/UselessViaRemovalSolver/can-section-move-to-layer"
import { createObstacleDetourPathValidator } from "lib/solvers/UselessViaRemovalSolver/create-obstacle-detour-path-validator"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("via-removal validators reject a foreign pad centered at a segment endpoint", (): void => {
  const route: HighDensityRoute = {
    connectionName: "moving_trace",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
    vias: [],
  }
  const foreignPad: Obstacle = {
    type: "rect",
    layers: ["top"],
    __zLayers: [0],
    center: { x: 0, y: 0 },
    width: 0.6,
    height: 0.6,
    connectedTo: ["foreign_pad"],
  }
  const connMap: ConnectivityMap = new ConnectivityMap({
    moving_net: [route.connectionName],
    foreign_net: ["foreign_pad"],
  })
  const hdRouteSHI: HighDensityRouteSpatialIndex =
    new HighDensityRouteSpatialIndex([route])
  const obstacleSHI: ObstacleSpatialHashIndex = new ObstacleSpatialHashIndex(
    "flatbush",
    [foreignPad],
  )

  expect(
    canSectionMoveToLayer({
      currentSection: {
        points: route.route,
        startIndex: 0,
        endIndex: 1,
        z: 0,
      },
      targetZ: 0,
      route,
      hdRouteSHI,
      obstacleSHI,
      connMap,
      defaultTraceThickness: 0.15,
      obstacleMargin: 0.1,
      traceMargin: 0.1,
    }),
  ).toBeFalse()

  const validateDetour = createObstacleDetourPathValidator({
    targetZ: 0,
    route,
    hdRouteSHI,
    obstacleSHI,
    connMap,
    defaultTraceThickness: 0.15,
    obstacleMargin: 0.1,
    traceMargin: 0.1,
    useNumericSegmentKeys: true,
  })
  expect(validateDetour(route.route, 0)).toBeFalse()
})
