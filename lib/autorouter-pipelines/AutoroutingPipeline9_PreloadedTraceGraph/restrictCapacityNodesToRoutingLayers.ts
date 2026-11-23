import type { CapacityMeshNode } from "lib/types"

/** Keep physical Z indices and the via connectivity of the merged board topology. */
export function restrictCapacityNodesToRoutingLayers(
  nodes: CapacityMeshNode[],
  routingLayerIndices: readonly number[],
): CapacityMeshNode[] {
  const routingLayers = new Set(routingLayerIndices)
  return nodes.flatMap((node) => {
    const availableZ = node.availableZ.filter((z) => routingLayers.has(z))
    if (availableZ.length === node.availableZ.length) return [node]
    if (!availableZ.length) return []
    return [{ ...node, availableZ, layer: `z${availableZ.join(",")}` }]
  })
}
