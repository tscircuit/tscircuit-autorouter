import { expect, test } from "bun:test"
import { CapacityNodeTree } from "lib/data-structures/CapacityNodeTree"
import type { CapacityMeshNode } from "lib/types"

test("capacity node tree indexes every bucket touched by a rectangle", (): void => {
  const wideNode: CapacityMeshNode = {
    capacityMeshNodeId: "wide-node",
    center: { x: 0.7, y: 0 },
    width: 0.34,
    height: 0.36,
    layer: "z0",
    availableZ: [0],
  }
  const tree = new CapacityNodeTree([wideNode])

  const nodesAtRightEdge = tree.getNodesInArea(0.885, 0, 0.06, 0.36)

  expect(nodesAtRightEdge.map((node) => node.capacityMeshNodeId)).toEqual([
    "wide-node",
  ])
})
