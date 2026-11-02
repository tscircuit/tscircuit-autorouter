import type {
  CapacityMeshEdge,
  CapacityMeshNode,
  CapacityMeshNodeId,
} from "../../types/capacity-mesh-types"
import { areNodesBordering } from "../../utils/areNodesBordering"
import {
  getBoundsIntersection,
  getCapacityMeshNodeBounds,
} from "../TopologyPlanningSolver/capacity-node-geometry"

/** A partition of one conductive target can reach free space through another
 * partition of that same target. Use existing shared-layer mesh edges only;
 * an adjacent foreign target does not provide an exit. */
export function getTargetNodesWithRoutingAccess({
  nodes,
  edges,
}: {
  nodes: CapacityMeshNode[]
  edges: CapacityMeshEdge[]
}): Set<CapacityMeshNodeId> {
  const nodeById = new Map(nodes.map((node) => [node.capacityMeshNodeId, node]))
  const neighbors = new Map<CapacityMeshNodeId, CapacityMeshNode[]>()
  for (const node of nodes) neighbors.set(node.capacityMeshNodeId, [])
  for (const edge of edges) {
    const first = nodeById.get(edge.nodeIds[0])!
    const second = nodeById.get(edge.nodeIds[1])!
    if (first._containsTarget && second._containsTarget) {
      // Point contacts in the mesh cannot provide a physical exit between
      // target pieces. Check access without changing the shared routing mesh.
      const firstBounds = getCapacityMeshNodeBounds(first)
      const secondBounds = getCapacityMeshNodeBounds(second)
      const overlap = getBoundsIntersection(firstBounds, secondBounds)
      if (!areNodesBordering(first, second) && !overlap) continue
    }
    neighbors.get(first.capacityMeshNodeId)!.push(second)
    neighbors.get(second.capacityMeshNodeId)!.push(first)
  }

  const reachable = new Set<CapacityMeshNodeId>()
  const pending: CapacityMeshNode[] = []
  for (const node of nodes) {
    if (!node._containsTarget || !node._targetConnectionName) continue
    const hasRoutingEdge = neighbors
      .get(node.capacityMeshNodeId)!
      .some(
        (neighbor) => !neighbor._containsObstacle && !neighbor._containsTarget,
      )
    if (!hasRoutingEdge) continue
    reachable.add(node.capacityMeshNodeId)
    pending.push(node)
  }
  while (pending.length) {
    const node = pending.pop()!
    for (const neighbor of neighbors.get(node.capacityMeshNodeId)!) {
      if (
        !neighbor._containsTarget ||
        neighbor._targetConnectionName !== node._targetConnectionName ||
        reachable.has(neighbor.capacityMeshNodeId)
      )
        continue
      reachable.add(neighbor.capacityMeshNodeId)
      pending.push(neighbor)
    }
  }
  return reachable
}
