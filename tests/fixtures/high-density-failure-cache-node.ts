import type { NodeWithPortPoints } from "../../lib/types/high-density-types"

export const highDensityFailureCacheNode: NodeWithPortPoints = {
  capacityMeshNodeId: "failure-cache",
  center: { x: 0, y: 0 },
  width: 3,
  height: 3,
  availableZ: [0, 1],
  portPoints: [
    { connectionName: "a", x: -1.5, y: -1, z: 0 },
    { connectionName: "a", x: 1.5, y: 1, z: 1 },
    { connectionName: "b", x: -1.5, y: 1, z: 0 },
    { connectionName: "b", x: 1.5, y: -1, z: 1 },
  ],
}
