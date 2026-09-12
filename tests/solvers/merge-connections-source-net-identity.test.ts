import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline7HdRoutesToSimplifiedPcbTracesConverter } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { mergeConnections } from "lib/solvers/NetToPointPairsSolver/mergeConnections"

test("merged source traces retain the connected source-net identity", () => {
  const connections = mergeConnections([
    {
      name: "source_trace_181",
      source_trace_id: "source_trace_181",
      pointsToConnect: [
        { x: 29.283340833333334, y: -4.5680968, layer: "top" },
        { x: 29.283340833333334, y: -3.04420245, layer: "top" },
      ],
    },
    {
      name: "source_net_3",
      pointsToConnect: [
        { x: 29.283340833333334, y: -4.5680968, layer: "top" },
        { x: 29.283340833333334, y: -3.04420245, layer: "top" },
        { x: -26.975106, y: -17.93498, layer: "top" },
      ],
    },
  ])

  expect(connections).toHaveLength(1)
  expect(connections[0]?.__rootConnectionNames).toEqual([
    "source_trace_181",
    "source_net_3",
  ])
  expect(connections[0]?.__netConnectionName).toBe("source_net_3")

  const pointPairConnection = {
    ...connections[0]!,
    name: "source_trace_181__source_net_3_mst0",
    pointsToConnect: connections[0]!.pointsToConnect.slice(0, 2),
  }
  const convertRoutes =
    createPipeline7HdRoutesToSimplifiedPcbTracesConverter({
      connections: [pointPairConnection],
      originalConnections: connections,
      layerCount: 2,
      obstacles: [],
      defaultViaHoleDiameter: 0.2,
      connMap: new ConnectivityMap({}),
    })
  const [trace] = convertRoutes([
    {
      connectionName: pointPairConnection.name,
      route: pointPairConnection.pointsToConnect.map((point) => ({
        x: point.x,
        y: point.y,
        z: 0,
      })),
      vias: [],
      jumpers: [],
      traceThickness: 0.4,
      viaDiameter: 0.45,
    },
  ])

  expect(trace?.connection_name).toBe("source_net_3")
  expect(trace?.source_trace_id).toBe("source_net_3")
})
