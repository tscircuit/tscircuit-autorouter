import { createPortPointPairsFromPortPoints } from "lib/utils/getPortPointsFromNodeWithPortPoints"
import React from "react"
import { ViaPossibilitiesDebugger } from "./ViaPossibilitiesDebugger"
import { NodeWithPortPoints } from "lib/types/high-density-types"
const nodeWithPortPoints: NodeWithPortPoints = {
  capacityMeshNodeId: "node1",
  center: { x: 5, y: 5 },
  width: 2,
  height: 2,
  portPointsInPairs: createPortPointPairsFromPortPoints([
    { connectionName: "A", x: 4, y: 4, z: 0 },
    { connectionName: "A", x: 6, y: 6, z: 0 },
    { connectionName: "B", x: 4, y: 6, z: 0 },
    { connectionName: "B", x: 6, y: 4, z: 0 },
  ]),
}
export default () => {
  return <ViaPossibilitiesDebugger nodeWithPortPoints={nodeWithPortPoints} />
}
