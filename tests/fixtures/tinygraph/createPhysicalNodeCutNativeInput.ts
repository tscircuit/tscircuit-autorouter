import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { PhysicalNodeCutContext } from "lib/solvers/NodeDimensionSubdivisionSolver/physicalNodeCuts"
import type { CapacityMeshNode, SimpleRouteConnection } from "lib/types"

export type PhysicalNodeCutNativeInput = {
  nodes: CapacityMeshNode[]
  connections: SimpleRouteConnection[]
  connectivityMap: ConnectivityMap
  context: PhysicalNodeCutContext
}

export function createPhysicalNodeCutNativeInput(
  sameNet = false,
): PhysicalNodeCutNativeInput {
  const nodes: CapacityMeshNode[] = [
    {
      capacityMeshNodeId: "central",
      center: { x: 0, y: 0 },
      width: 0.8125,
      height: 4,
      layer: "top",
      availableZ: [0, 1],
    },
    ...[-3, 3].map(
      (y): CapacityMeshNode => ({
        capacityMeshNodeId: y < 0 ? "south-bank" : "north-bank",
        center: { x: 0, y },
        width: 8,
        height: 2,
        layer: "top",
        availableZ: [0, 1],
      }),
    ),
  ]
  if (!sameNet) {
    nodes.push({
      capacityMeshNodeId: "outside-west",
      center: { x: -2, y: 0 },
      width: 3.1875,
      height: 4,
      layer: "top",
      availableZ: [0, 1],
    })
  }
  const connections: SimpleRouteConnection[] = Array.from(
    { length: 8 },
    (_, index): SimpleRouteConnection => ({
      name: `route-${index}`,
      __rootConnectionNames: [sameNet ? "shared-net" : `net-${index}`],
      pointsToConnect: [
        {
          x: -0.875 + index * 0.25,
          y: -3,
          layer: "top",
          pcb_port_id: `south-port-${index}`,
        },
        {
          x: -0.875 + index * 0.25,
          y: 3,
          layer: "top",
          pcb_port_id: `north-port-${index}`,
        },
      ],
    }),
  )
  const connectivityMap = new ConnectivityMap({})
  connectivityMap.addConnections(
    connections.map((connection): string[] => [
      connection.name,
      ...connection.__rootConnectionNames!,
    ]),
  )
  const routableNetIds = new Set<string>()
  for (const connection of connections) {
    const netId = connectivityMap.getNetConnectedToId(connection.name)
    if (typeof netId !== "string" || netId.length === 0) {
      throw new Error(`Native cut fixture has no owner for ${connection.name}`)
    }
    routableNetIds.add(netId)
  }
  return {
    nodes,
    connections,
    connectivityMap,
    context: {
      // This fixed copper is outside the central free rectangle. Its bottom
      // clearance alone reduces the cut from four bottom sites to three.
      rectangles: [
        {
          kind: "fixed-rectangle",
          center: { x: 0.90625, y: 0 },
          width: 1,
          height: 1,
          zLayers: [1],
          ownerNetIds: new Set(["unrouted-fixed-pad-net"]),
        },
      ],
      layerCount: 2,
      traceWidth: 0.125,
      traceGap: 0.125,
      padGap: 0.0625,
      routableNetIds,
      protectedPoints: connections.flatMap(
        (connection): Array<{ x: number; y: number }> =>
          connection.pointsToConnect.map(
            ({ x, y }): { x: number; y: number } => ({ x, y }),
          ),
      ),
    },
  }
}
