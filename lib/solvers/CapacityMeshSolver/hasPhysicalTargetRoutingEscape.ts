import type { Bounds } from "@tscircuit/math-utils"
import type { CapacityMeshEdge, CapacityMeshNode } from "lib/types"
import { getSharedEdgeForNodePair } from "../UniformPortDistributionSolver/getSharedEdgeForNodePair"

const EPSILON = 1e-6

/** Follows existing copper borders within the original physical pad. */
export function hasPhysicalTargetRoutingEscape({
  targetNode,
  nodeById,
  nodeBounds,
  edgesByNodeId,
}: {
  targetNode: CapacityMeshNode
  nodeById: Map<string, CapacityMeshNode>
  nodeBounds: Map<string, Bounds>
  edgesByNodeId: Map<string, CapacityMeshEdge[]>
}): boolean {
  for (const region of targetNode._physicalTargetRegions ?? []) {
    if (region.connectionName !== targetNode._targetConnectionName) continue
    const minX = region.center.x - region.width / 2
    const maxX = region.center.x + region.width / 2
    const minY = region.center.y - region.height / 2
    const maxY = region.center.y + region.height / 2
    for (const z of targetNode.availableZ) {
      if (!region.availableZ.includes(z)) continue
      const pending = [targetNode.capacityMeshNodeId]
      const visited = new Set<string>()
      while (pending.length > 0) {
        const nodeId = pending.pop()!
        if (visited.has(nodeId)) continue
        visited.add(nodeId)
        for (const edge of edgesByNodeId.get(nodeId) ?? []) {
          const otherId = edge.nodeIds.find((id) => id !== nodeId)!
          const other = nodeById.get(otherId)!
          if (!other.availableZ.includes(z)) continue
          const shared = getSharedEdgeForNodePair({
            nodeAId: nodeId,
            nodeBId: otherId,
            nodeBounds,
          })
          if (!shared) continue
          const vertical = shared.orientation === "vertical"
          const fixedCoordinate = vertical ? shared.x1 : shared.y1
          const minimum = vertical ? minX : minY
          const maximum = vertical ? maxX : maxY
          if (
            fixedCoordinate < minimum - EPSILON ||
            fixedCoordinate > maximum + EPSILON
          ) {
            continue
          }
          const overlapLength = vertical
            ? Math.min(shared.y2, maxY) - Math.max(shared.y1, minY)
            : Math.min(shared.x2, maxX) - Math.max(shared.x1, minX)
          if (overlapLength <= EPSILON) continue
          if (!other._containsObstacle && !other._containsTarget) {
            // A free cell inside the footprint cannot be a physical pad exit.
            if (
              Math.abs(fixedCoordinate - minimum) <= EPSILON ||
              Math.abs(fixedCoordinate - maximum) <= EPSILON
            ) {
              return true
            }
            continue
          }
          if (
            other._containsObstacle &&
            other._containsTarget &&
            other._physicalTargetRegions?.some(
              (target) => target.id === region.id,
            )
          ) {
            pending.push(otherId)
          }
        }
      }
    }
  }
  return false
}
