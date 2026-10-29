import type { NodeWithPortPoints } from "lib/types/high-density-types"

export const makeSingleTransitionAnchorNode = (): NodeWithPortPoints => ({
  capacityMeshNodeId: "synthetic-legal-anchors",
  center: { x: 10, y: -20 },
  width: 0.25,
  height: 0.25,
  availableZ: [0, 3],
  portPoints: [
    { x: 9.875, y: -20, z: 0, connectionName: "signal-branch", rootConnectionName: "other-root" },
    { x: 10.125, y: -20, z: 3, connectionName: "signal-branch", rootConnectionName: "other-root" },
  ],
})
