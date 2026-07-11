import { expect, test } from "bun:test"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { canEndpointConnectOnLayer } from "lib/solvers/UselessViaRemovalSolver/can-endpoint-connect-on-layer"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createObjectsWithZLayers } from "lib/utils/createObjectsWithZLayers"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("sample008 does not treat a nearby same-net bottom pad as its top endpoint", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 8, 1)
  const obstacleSHI = new ObstacleSpatialHashIndex(
    "flatbush",
    createObjectsWithZLayers(scenario.obstacles, scenario.layerCount),
  )

  expect(
    canEndpointConnectOnLayer({
      endpointX: -10.3995,
      endpointY: 5.938,
      targetZ: 3,
      obstacleSHI,
      route: {
        connectionName: "source_trace_9__source_net_9_mst15",
        rootConnectionName: "source_trace_9",
      } as HighDensityRoute,
      connMap: getConnectivityMapFromSimpleRouteJson(scenario),
    }),
  ).toBe(false)
})
