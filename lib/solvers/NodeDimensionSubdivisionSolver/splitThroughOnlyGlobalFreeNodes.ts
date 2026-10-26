import type { CapacityMeshNode } from "lib/types"

type ThroughOnlyPolicy = {
  layerCount: number
  allowBlindAndBuriedVias?: boolean
  allowViaInPad?: boolean
}

const GEOMETRY_KEYS = new Set(["capacityMeshNodeId", "center", "width", "height", "layer", "availableZ"])
const EMPTY_ROLE_KEYS = new Set(["_containsObstacle", "_containsTarget", "_completelyInsideObstacle", "_isComponentTopologyNode", "_isNarrowQfpPadGap"])

/** A partial free stack does not provide space for a through via. */
export function splitThroughOnlyGlobalFreeNodes(nodes: CapacityMeshNode[], policy: ThroughOnlyPolicy): CapacityMeshNode[] {
  if (policy.allowBlindAndBuriedVias || policy.allowViaInPad) return nodes
  const usedIds = new Set(nodes.map((node) => node.capacityMeshNodeId))
  const output: CapacityMeshNode[] = []
  for (const node of nodes) {
    const partial = node.availableZ.length > 1 && node.availableZ.length < policy.layerCount &&
      node.availableZ.every((z) => Number.isInteger(z) && z >= 0 && z < policy.layerCount) &&
      new Set(node.availableZ).size === node.availableZ.length &&
      [node.center.x, node.center.y, node.width, node.height].every(Number.isFinite) && node.width > 0 && node.height > 0
    const plainFree = Object.entries(node).every(([key, value]) => GEOMETRY_KEYS.has(key) || value === undefined || (EMPTY_ROLE_KEYS.has(key) && value === false))
    if (!partial || !plainFree) {
      output.push(node)
      continue
    }
    for (const z of node.availableZ) {
      let id = `${node.capacityMeshNodeId}__single_z${z}`
      while (usedIds.has(id)) id += "_next"
      usedIds.add(id)
      output.push({ ...node, capacityMeshNodeId: id, availableZ: [z], layer: `z${z}` })
    }
  }
  return output
}
