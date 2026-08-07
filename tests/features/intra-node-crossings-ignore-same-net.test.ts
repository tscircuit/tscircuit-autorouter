import { expect, test } from "bun:test"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { getIntraNodeCrossingsUsingCircle } from "lib/utils/getIntraNodeCrossingsUsingCircle"

test("same-net chords are not classified as an impossible crossing", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "cn_same_net_crossing",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0],
    portPoints: [
      {
        connectionName: "net1_mst0",
        rootConnectionName: "net1",
        x: -1,
        y: 0,
        z: 0,
      },
      {
        connectionName: "net1_mst0",
        rootConnectionName: "net1",
        x: 1,
        y: 0,
        z: 0,
      },
      {
        connectionName: "net1_mst1",
        rootConnectionName: "net1",
        x: 0,
        y: -1,
        z: 0,
      },
      {
        connectionName: "net1_mst1",
        rootConnectionName: "net1",
        x: 0,
        y: 1,
        z: 0,
      },
    ],
  }

  expect(getIntraNodeCrossingsUsingCircle(node)).toEqual({
    numSameLayerCrossings: 0,
    numEntryExitLayerChanges: 0,
    numTransitionPairCrossings: 0,
  })
})
