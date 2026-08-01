import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

const connectionNames = Array.from(
  { length: 6 },
  (_, index) => `source_trace_3__source_net_3_mst${index}`,
)

const createPair = (connectionName: string): [PortPoint, PortPoint] => {
  const start: PortPoint = {
    connectionName,
    rootConnectionName: "source_trace_3",
    portPointId: "shared-left-port",
    nextPortPointId: "shared-right-port",
    x: -1.5,
    y: 0,
    z: 0,
  }
  const end: PortPoint = {
    connectionName,
    rootConnectionName: "source_trace_3",
    portPointId: "shared-right-port",
    prevPortPointId: "shared-left-port",
    x: 1.5,
    y: 0,
    z: 0,
  }
  return [start, end]
}

const portPointsInPairs = connectionNames.map(createPair)

export const sharedSameNetPhysicalSegment: NodeWithPortPoints = {
  capacityMeshNodeId: "shared-same-net-region",
  center: { x: 0, y: 0 },
  width: 4,
  height: 2,
  availableZ: [0, 1],
  portPoints: portPointsInPairs.flat(),
  portPointsInPairs,
}
