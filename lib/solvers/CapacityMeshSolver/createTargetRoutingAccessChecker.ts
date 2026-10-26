import type { CapacityMeshEdge, CapacityMeshNode, CapacityMeshNodeId } from "lib/types"

/** Ownership labels identify electrical aliases; geometry and layer indexes are
 * retained in the existing board-world-mm graph without any copper changes. */
function shareTargetOwnership(a: CapacityMeshNode, b: CapacityMeshNode): boolean {
  if (a._targetConnectionName && (
    a._targetConnectionName === b._targetConnectionName ||
    b._connectedTo?.includes(a._targetConnectionName)
  )) return true
  if (b._targetConnectionName && a._connectedTo?.includes(b._targetConnectionName)) {
    return true
  }
  return a._connectedTo?.some((owner) => b._connectedTo?.includes(owner)) === true
}

/** A pad fragment can exit through connected targets belonging to its own net.
 * Only actual graph edges on shared layers are followed. Foreign and unowned
 * targets remain blocked. Each visited owned component is memoized per solve. */
export function createTargetRoutingAccessChecker({
  nodeById,
  edgesByTargetNodeId,
  nodesHaveSharedLayer,
}: {
  nodeById: ReadonlyMap<CapacityMeshNodeId, CapacityMeshNode>
  edgesByTargetNodeId: ReadonlyMap<CapacityMeshNodeId, readonly CapacityMeshEdge[]>
  nodesHaveSharedLayer: (a: CapacityMeshNode, b: CapacityMeshNode) => boolean
}): (target: CapacityMeshNode) => boolean {
  const accessByNodeId = new Map<CapacityMeshNodeId, boolean>()
  return (target): boolean => {
    const cached = accessByNodeId.get(target.capacityMeshNodeId)
    if (cached !== undefined) return cached
    const visited = new Set<CapacityMeshNodeId>([target.capacityMeshNodeId])
    const queue = [target]
    let hasRoutingAccess = false
    for (let cursor = 0; cursor < queue.length && !hasRoutingAccess; cursor++) {
      const current = queue[cursor]!
      for (const edge of edgesByTargetNodeId.get(current.capacityMeshNodeId)!) {
        const otherNodeId = edge.nodeIds[0] === current.capacityMeshNodeId
          ? edge.nodeIds[1] : edge.nodeIds[0]
        const other = nodeById.get(otherNodeId!)
        if (!other || !nodesHaveSharedLayer(current, other)) continue
        if (!other._containsObstacle && !other._containsTarget) {
          hasRoutingAccess = true
          break
        }
        if (!other._containsTarget || !shareTargetOwnership(current, other)) continue
        const otherAccess = accessByNodeId.get(other.capacityMeshNodeId)
        if (otherAccess === true) {
          hasRoutingAccess = true
          break
        }
        if (otherAccess === false || visited.has(other.capacityMeshNodeId)) continue
        visited.add(other.capacityMeshNodeId)
        queue.push(other)
      }
    }
    for (const nodeId of visited) accessByNodeId.set(nodeId, hasRoutingAccess)
    return hasRoutingAccess
  }
}
