import { boundsIntersection } from "@tscircuit/math-utils"
import type {
  PreparedTopologyMergingNode,
  TopologyMergingNodeGroup,
} from "./topology-merging-types"
import { TOPOLOGY_MERGING_EPSILON } from "./topology-merging-types"

export function hasOverlappingSingleAndMultilayerFreeMeshes({
  nodeGroups,
  preparedNodes,
}: {
  nodeGroups: readonly TopologyMergingNodeGroup[]
  preparedNodes: PreparedTopologyMergingNode[]
}): boolean {
  if (nodeGroups.length !== 1) return false

  const freeNodes = preparedNodes.filter(
    ({ node }) => node._containsObstacle !== true,
  )
  const freeLayerSets: number[][] = []
  for (const { node } of freeNodes) {
    const hasKnownLayerSet = freeLayerSets.some(
      (layers) =>
        layers.length === node.availableZ.length &&
        layers.every((z, index) => z === node.availableZ[index]),
    )
    if (!hasKnownLayerSet) freeLayerSets.push(node.availableZ)
    if (freeLayerSets.length > 2) return false
  }
  if (freeLayerSets.length !== 2) return false
  if (freeLayerSets.every((layers) => layers.length === 1)) return false

  for (let aIndex = 0; aIndex < freeNodes.length; aIndex++) {
    const nodeA = freeNodes[aIndex]!
    for (let bIndex = aIndex + 1; bIndex < freeNodes.length; bIndex++) {
      const nodeB = freeNodes[bIndex]!
      if (nodeA.node.availableZ.some((z) => nodeB.node.availableZ.includes(z))) {
        continue
      }

      const overlap = boundsIntersection(nodeA.bounds, nodeB.bounds)
      if (
        overlap &&
        overlap.maxX - overlap.minX > TOPOLOGY_MERGING_EPSILON &&
        overlap.maxY - overlap.minY > TOPOLOGY_MERGING_EPSILON
      ) {
        return true
      }
    }
  }

  return false
}
