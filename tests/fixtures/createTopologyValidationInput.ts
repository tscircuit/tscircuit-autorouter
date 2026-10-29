import { getCapacityMeshNodeBounds } from "lib/solvers/TopologyPlanningSolver/capacity-node-geometry"
import type { validateTopologyMergingOutput } from "lib/solvers/TopologyMergingSolver/topology-merging-output"
import type { PreparedTopologyMergingNode } from "lib/solvers/TopologyMergingSolver/topology-merging-types"
import type { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"

type TopologySourceKey = PreparedTopologyMergingNode["sourceKey"]

export function createTopologyValidationInput({
  nodes,
  groupIndexes = nodes.map((_, index) => index),
}: {
  nodes: CapacityMeshNode[]
  groupIndexes?: number[]
}): Parameters<typeof validateTopologyMergingOutput>[0] {
  const preparedNodeBySourceKey = new Map<
    TopologySourceKey,
    PreparedTopologyMergingNode
  >()
  const provenance = {
    sourceKeysByNodeId: new Map<CapacityMeshNodeId, TopologySourceKey[]>(),
    groupIndexesByNodeId: new Map<CapacityMeshNodeId, number[]>(),
  }
  for (const [index, node] of nodes.entries()) {
    const sourceKey = `source-${index}`
    const groupIndex = groupIndexes[index]!
    preparedNodeBySourceKey.set(sourceKey, {
      sourceKey,
      groupIndex,
      node: structuredClone(node),
      bounds: getCapacityMeshNodeBounds(node),
    })
    provenance.sourceKeysByNodeId.set(node.capacityMeshNodeId, [sourceKey])
    provenance.groupIndexesByNodeId.set(node.capacityMeshNodeId, [groupIndex])
  }
  return { nodes, preparedNodeBySourceKey, provenance }
}
