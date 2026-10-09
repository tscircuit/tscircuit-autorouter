import type { PreparedTopologyMergingNode } from "./topology-merging-types"
import { TOPOLOGY_MERGING_EPSILON } from "./topology-merging-types"

export type TopologyMergingXSweepEvents = {
  enteringNodesBySlabIndex: PreparedTopologyMergingNode[][]
  leavingNodesBySlabIndex: PreparedTopologyMergingNode[][]
}

export function createTopologyMergingXSweepEvents({
  preparedNodes,
  xCoordinates,
}: {
  preparedNodes: PreparedTopologyMergingNode[]
  xCoordinates: number[]
}): TopologyMergingXSweepEvents {
  const slabMidpoints = xCoordinates
    .slice(0, -1)
    .map((minX, index) => (minX + xCoordinates[index + 1]!) / 2)
  const enteringNodesBySlabIndex = Array.from(
    { length: slabMidpoints.length },
    () => [] as PreparedTopologyMergingNode[],
  )
  const leavingNodesBySlabIndex = Array.from(
    { length: slabMidpoints.length + 1 },
    () => [] as PreparedTopologyMergingNode[],
  )

  for (const preparedNode of preparedNodes) {
    const firstSlabIndex = findFirstIndexAtLeast(
      slabMidpoints,
      preparedNode.bounds.minX - TOPOLOGY_MERGING_EPSILON,
    )
    const leavingSlabIndex = findFirstIndexGreaterThan(
      slabMidpoints,
      preparedNode.bounds.maxX + TOPOLOGY_MERGING_EPSILON,
    )
    if (firstSlabIndex >= leavingSlabIndex) continue

    enteringNodesBySlabIndex[firstSlabIndex]!.push(preparedNode)
    leavingNodesBySlabIndex[leavingSlabIndex]!.push(preparedNode)
  }

  return { enteringNodesBySlabIndex, leavingNodesBySlabIndex }
}

function findFirstIndexAtLeast(values: number[], target: number): number {
  let low = 0
  let high = values.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (values[middle]! < target) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  return low
}

function findFirstIndexGreaterThan(values: number[], target: number): number {
  let low = 0
  let high = values.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (values[middle]! <= target) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  return low
}
