import { getCapacityMeshNodeBounds } from "lib/solvers/TopologyPlanningSolver/capacity-node-geometry"
import type { validateTopologyMergingOutput } from "lib/solvers/TopologyMergingSolver/topology-merging-output"
import type { PreparedTopologyMergingNode } from "lib/solvers/TopologyMergingSolver/topology-merging-types"
import type { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"

type TopologyMergingSourceKey = string

export function createTopologyMergingValidationTestInput(
  entries: Array<{ node: CapacityMeshNode; groupIndex: number }>,
): Parameters<typeof validateTopologyMergingOutput>[0] {
  const preparedNodeBySourceKey = new Map<
    TopologyMergingSourceKey,
    PreparedTopologyMergingNode
  >()
  const groupIndexesByNodeId = new Map<CapacityMeshNodeId, number[]>()
  const sourceKeysByNodeId = new Map<
    CapacityMeshNodeId,
    TopologyMergingSourceKey[]
  >()
  for (const { node, groupIndex } of entries) {
    const sourceKey = `${groupIndex}:${node.capacityMeshNodeId}`
    preparedNodeBySourceKey.set(sourceKey, {
      sourceKey,
      groupIndex,
      node,
      bounds: getCapacityMeshNodeBounds(node),
    })
    groupIndexesByNodeId.set(node.capacityMeshNodeId, [groupIndex])
    sourceKeysByNodeId.set(node.capacityMeshNodeId, [sourceKey])
  }
  return {
    nodes: entries.map(({ node }) => node),
    preparedNodeBySourceKey,
    provenance: { groupIndexesByNodeId, sourceKeysByNodeId },
  }
}
