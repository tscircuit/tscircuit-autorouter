import { expect, test } from "bun:test"
import type { Bounds } from "@tscircuit/math-utils"
import { createTopologyMergingXSweepEvents } from "lib/solvers/TopologyMergingSolver/topology-merging-x-sweep"
import type { PreparedTopologyMergingNode } from "lib/solvers/TopologyMergingSolver/topology-merging-types"
import type { CapacityMeshNodeId } from "lib/types"

const createPreparedNode = (
  capacityMeshNodeId: CapacityMeshNodeId,
  bounds: Bounds,
): PreparedTopologyMergingNode => ({
  sourceKey: capacityMeshNodeId,
  groupIndex: 0,
  bounds,
  node: {
    capacityMeshNodeId,
    center: {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    },
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
    layer: "z0",
    availableZ: [0],
  },
})

test("x-sweep events preserve midpoint overlap membership", () => {
  const xCoordinates = [0, 1, 2, 3, 4]
  const preparedNodes = [
    createPreparedNode("left", { minX: 0, minY: 0, maxX: 2, maxY: 1 }),
    createPreparedNode("middle", { minX: 1, minY: 0, maxX: 3, maxY: 1 }),
    createPreparedNode("right", { minX: 3, minY: 0, maxX: 4, maxY: 1 }),
  ]
  const { enteringNodesBySlabIndex, leavingNodesBySlabIndex } =
    createTopologyMergingXSweepEvents({ preparedNodes, xCoordinates })
  const activeNodes = new Set<PreparedTopologyMergingNode>()

  for (let slabIndex = 0; slabIndex < xCoordinates.length - 1; slabIndex++) {
    for (const node of leavingNodesBySlabIndex[slabIndex] ?? []) {
      activeNodes.delete(node)
    }
    for (const node of enteringNodesBySlabIndex[slabIndex] ?? []) {
      activeNodes.add(node)
    }

    const midpoint =
      (xCoordinates[slabIndex]! + xCoordinates[slabIndex + 1]!) / 2
    const expectedSourceKeys = preparedNodes
      .filter(
        ({ bounds }) => midpoint >= bounds.minX && midpoint <= bounds.maxX,
      )
      .map(({ sourceKey }) => sourceKey)

    expect([...activeNodes].map(({ sourceKey }) => sourceKey)).toEqual(
      expectedSourceKeys,
    )
  }
})
