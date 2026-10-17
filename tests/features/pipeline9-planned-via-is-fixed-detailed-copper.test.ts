import { expect, test } from "bun:test"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { SimpleRouteJson } from "lib/types"
import type { PortPoint } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("a planned graph via reserves its barrel during neighboring detailed routing", (): void => {
  const viaPorts: [PortPoint, PortPoint] = [
    { x: 0, y: 0, z: 0, connectionName: "via-net" },
    { x: 0, y: 0, z: 3, connectionName: "via-net" },
  ]
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1524,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "via-net",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 0, y: 0, layer: "bottom" },
        ],
      },
      {
        name: "wire-net",
        pointsToConnect: [
          { x: -1, y: 0, layer: "inner1" },
          { x: 1, y: 0, layer: "inner1" },
        ],
      },
    ],
  }
  const solver = new Pipeline9HighDensitySolver({
    nodePortPoints: [
      {
        capacityMeshNodeId: "neighboring-wire",
        center: { x: 0, y: 0 },
        width: 3,
        height: 2,
        availableZ: [1],
        portPoints: [
          { x: -1, y: 0, z: 1, connectionName: "wire-net" },
          { x: 1, y: 0, z: 1, connectionName: "wire-net" },
        ],
      },
      {
        capacityMeshNodeId: "planned-via",
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.4,
        availableZ: [0, 1, 2, 3],
        isLayerTransition: true,
        portPoints: viaPorts,
        portPointsInPairs: [viaPorts],
      },
    ],
    fixedHdRoutes: [],
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    obstacles: [],
    includeBoardObstacles: true,
    layerCount: 4,
    allowBlindAndBuriedVias: true,
    viaDiameter: 0.4,
    traceWidth: 0.1524,
    minimumTraceWidth: 0.1524,
    obstacleMargin: 0.1,
    effort: 1,
  })
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBeTrue()
  const routes = solver.routes
  expect(routes).toHaveLength(2)
  expect(
    doPipeline9RoutesHaveCopperConflict({
      left: routes.find((route) => route.connectionName === "via-net")!,
      right: routes.find((route) => route.connectionName === "wire-net")!,
      clearance: 0.1,
      layerCount: 4,
      allowBlindAndBuriedVias: true,
    }),
  ).toBeFalse()
})
