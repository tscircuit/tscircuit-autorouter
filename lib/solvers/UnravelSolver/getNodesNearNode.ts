import { CapacityMeshNodeId } from "lib/types"

export function getNodesNearNode(params: {
  nodeId: CapacityMeshNodeId
  nodeIdToSegmentIds: Map<CapacityMeshNodeId, CapacityMeshNodeId[]>
  segmentIdToNodeIds: Map<CapacityMeshNodeId, CapacityMeshNodeId[]>
  hops: number
}): CapacityMeshNodeId[] {
  const { nodeId, nodeIdToSegmentIds, segmentIdToNodeIds, hops } = params

  if (hops === 0) return [nodeId]

  const visitedNodes = new Set<CapacityMeshNodeId>([nodeId])
  const exploreQueue: Array<{
    nodeId: CapacityMeshNodeId
    remainingHops: number
  }> = [{ nodeId: nodeId, remainingHops: hops }]

  while (exploreQueue.length > 0) {
    const { nodeId: node, remainingHops } = exploreQueue.shift()!

    if (remainingHops === 0) continue

    const segments = nodeIdToSegmentIds.get(node) || []
    for (const segmentId of segments) {
      const adjacentNodeIds = segmentIdToNodeIds.get(segmentId) || []
      for (const adjacentNodeId of adjacentNodeIds) {
        if (!visitedNodes.has(adjacentNodeId)) {
          visitedNodes.add(adjacentNodeId)
          exploreQueue.push({
            nodeId: adjacentNodeId,
            remainingHops: remainingHops - 1,
          })
        }
      }
    }
  }

  return Array.from(visitedNodes)
}
