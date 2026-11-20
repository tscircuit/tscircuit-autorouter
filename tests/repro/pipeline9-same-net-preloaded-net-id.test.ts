import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { arePipeline9RoutesOnSameNet } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"

test("Pipeline9 matches a connection and preloaded net id that share a net", (): void => {
  const connMap = new ConnectivityMap({
    connectivity_net1: [
      "source_net_6",
      "source_net_6_mst0",
      "source_net_6_mst5",
      "breakout:pcb_breakout_point_38",
    ],
    connectivity_net2: [
      "source_net_5",
      "source_net_5_mst0",
      "source_net_5_mst18",
      "breakout:pcb_breakout_point_39",
    ],
  })
  const preloadedRoute = {
    connectionName: "breakout:pcb_breakout_point_38_fixed_22_0",
    rootConnectionName: "connectivity_net1",
  }

  expect(
    arePipeline9RoutesOnSameNet(
      { connectionName: "source_net_6_mst5", rootConnectionName: "source_net_6" },
      preloadedRoute,
      connMap,
    ),
  ).toBeTrue()
  expect(
    arePipeline9RoutesOnSameNet(
      {
        connectionName: "source_net_5_mst18",
        rootConnectionName: "source_net_5",
      },
      preloadedRoute,
      connMap,
    ),
  ).toBeFalse()
  expect(
    arePipeline9RoutesOnSameNet(
      { connectionName: "unknown_connection_a" },
      { connectionName: "unknown_connection_b" },
      connMap,
    ),
  ).toBeFalse()
})
