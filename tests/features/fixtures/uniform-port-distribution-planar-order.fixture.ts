import type { NodeWithPortPoints } from "lib/types/high-density-types"

const leftNodeId = "sample4-left-node"
const rightNodeId = "sample4-right-node"

const source175Top = {
  portPointId: "source175-top",
  connectionName: "source_trace_175__source_net_175_mst2",
  rootConnectionName: "source_trace_175",
  x: 0.6325,
  y: 0.185,
  z: 5,
}
const source175Shared = {
  portPointId: "sample4-shared-port",
  connectionName: "source_trace_175__source_net_175_mst2",
  rootConnectionName: "source_trace_175",
  x: 0.82,
  y: 0,
  z: 5,
}
const source169Top = {
  portPointId: "source169-top",
  connectionName: "source_trace_169__source_net_169_mst2",
  rootConnectionName: "source_trace_169",
  x: -0.3675,
  y: 0.185,
  z: 5,
}
const source169Shared = {
  portPointId: "sample4-shared-port::dup1",
  duplicatedFromPortId: "sample4-shared-port",
  connectionName: "source_trace_169__source_net_169_mst2",
  rootConnectionName: "source_trace_169",
  x: 0.82,
  y: 0,
  z: 5,
}

export const sample4PlanarPortOrderNodes: NodeWithPortPoints[] = [
  {
    capacityMeshNodeId: leftNodeId,
    center: { x: 0, y: 0 },
    width: 1.64,
    height: 0.37,
    availableZ: [5],
    portPoints: [
      source175Top,
      source175Shared,
      source169Top,
      source169Shared,
    ],
    portPointsInPairs: [
      [source175Top, source175Shared],
      [source169Top, source169Shared],
    ],
  },
  {
    capacityMeshNodeId: rightNodeId,
    center: { x: 1.32, y: 0 },
    width: 1,
    height: 0.37,
    availableZ: [5],
    portPoints: [source175Shared, source169Shared],
    portPointsInPairs: [],
  },
]

export const sample4PlanarPortOrderInputNodes =
  sample4PlanarPortOrderNodes.map((node) => ({
    ...node,
    portPoints: node.portPoints.map((portPoint) => ({
      ...portPoint,
      connectionNodeIds: portPoint.portPointId?.includes("shared-port")
        ? ([leftNodeId, rightNodeId] as [string, string])
        : ([leftNodeId, leftNodeId] as [string, string]),
      distToCentermostPortOnZ: 0,
    })),
  }))
