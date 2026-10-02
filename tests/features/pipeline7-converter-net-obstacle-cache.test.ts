import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import type { Obstacle, SimpleRouteConnection } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("Pipeline7 reuses multilayer obstacle connectivity across point-pair routes on one net", () => {
  const connections: SimpleRouteConnection[] = ["pair_a", "pair_b"].map(
    (name, index) => ({
      name,
      __netConnectionName: "shared_net",
      pointsToConnect: [
        { x: index * 2 - 2, y: 0, layer: "top", pointId: `${name}_start` },
        { x: index * 2 - 1, y: 0, layer: "top", pointId: `${name}_end` },
      ],
    }),
  )
  const obstacles: Obstacle[] = ["pad_shared", "pad_other"].map(
    (connectedId, index) => ({
      type: "rect",
      center: { x: index * 3, y: index * 3 },
      width: 0.5,
      height: 0.5,
      layers: ["top", "bottom"],
      connectedTo: [connectedId],
    }),
  )
  const connMap = new ConnectivityMap({
    shared_net: ["pair_a", "pair_b", "pad_shared"],
    other_net: ["pad_other"],
  })
  let connectivityChecks = 0
  const areIdsConnected = connMap.areIdsConnected.bind(connMap)
  connMap.areIdsConnected = (left: string, right: string) => {
    connectivityChecks++
    return areIdsConnected(left, right)
  }
  const routes: HighDensityRoute[] = ["pair_a", "pair_b"].map(
    (connectionName, index) => ({
      connectionName,
      route: [
        { x: index * 2 - 2, y: 0, z: 0 },
        { x: index * 2 - 1, y: 0, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    }),
  )

  const traces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
    connections,
    originalConnections: connections,
    hdRoutes: routes,
    layerCount: 2,
    obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap,
  })

  expect(traces).toHaveLength(2)
  expect(connectivityChecks).toBe(2)
})
