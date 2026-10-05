import type { CapacityMeshNode } from "lib/types"

/**
 * Creates a Map from an array of capacity nodes, keyed by capacityMeshNodeId.
 * Useful for O(1) node lookup instead of O(n) array find operations.
 */
export function createNodeMap(
  nodes: CapacityMeshNode[],
): Map<string, CapacityMeshNode> {
  const map = new Map<string, CapacityMeshNode>()
  for (const node of nodes) {
    map.set(node.capacityMeshNodeId, node)
  }
  return map
}
