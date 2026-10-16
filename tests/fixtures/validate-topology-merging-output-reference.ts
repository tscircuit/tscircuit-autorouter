// Frozen exhaustive validator from 9d95bfd, retained as a differential oracle.
import type { CapacityMeshNode } from "lib/types"
import {
  getBoundsIntersection,
  getCapacityMeshNodeBounds,
  isValidCapacityBounds,
} from "lib/solvers/TopologyPlanningSolver/capacity-node-geometry"
import type { TopologyMergingOutputProvenance } from "lib/solvers/TopologyMergingSolver/topology-merging-output"
import type { PreparedTopologyMergingNode } from "lib/solvers/TopologyMergingSolver/topology-merging-types"
import { TOPOLOGY_PROVENANCE_EPSILON } from "lib/solvers/TopologyMergingSolver/topology-merging-types"

export function validateTopologyMergingOutputReference({
  nodes,
  preparedNodeBySourceKey,
  provenance,
}: {
  nodes: CapacityMeshNode[]
  preparedNodeBySourceKey: ReadonlyMap<string, PreparedTopologyMergingNode>
  provenance: TopologyMergingOutputProvenance
}): void {
  const nodeIds = new Set<string>()
  for (const node of nodes) {
    if (nodeIds.has(node.capacityMeshNodeId)) {
      throw new Error(
        `TopologyMergingSolver: duplicate output node id "${node.capacityMeshNodeId}"`,
      )
    }
    nodeIds.add(node.capacityMeshNodeId)

    if (!isValidCapacityBounds(getCapacityMeshNodeBounds(node))) {
      throw new Error(
        `TopologyMergingSolver: output node "${node.capacityMeshNodeId}" has invalid bounds`,
      )
    }
    if (node.availableZ.length === 0) {
      throw new Error(
        `TopologyMergingSolver: output node "${node.capacityMeshNodeId}" has no available layers`,
      )
    }

    const sourceKeys = provenance.sourceKeysByNodeId.get(
      node.capacityMeshNodeId,
    )
    if (!sourceKeys) {
      throw new Error(
        `TopologyMergingSolver: missing output provenance for node "${node.capacityMeshNodeId}"`,
      )
    }
    if (sourceKeys.length === 1) {
      validateSingleSourceOutput({
        node,
        sourceKey: sourceKeys[0]!,
        preparedNodeBySourceKey,
      })
    }
  }

  for (let aIndex = 0; aIndex < nodes.length; aIndex++) {
    const nodeA = nodes[aIndex]!
    for (let bIndex = aIndex + 1; bIndex < nodes.length; bIndex++) {
      const nodeB = nodes[bIndex]!
      const sharedLayers = nodeA.availableZ.filter((z) =>
        nodeB.availableZ.includes(z),
      )
      if (sharedLayers.length === 0) continue

      const intersection = getBoundsIntersection(
        getCapacityMeshNodeBounds(nodeA),
        getCapacityMeshNodeBounds(nodeB),
      )
      if (!intersection) continue
      const intersectionWidth = intersection.maxX - intersection.minX
      const intersectionHeight = intersection.maxY - intersection.minY
      if (
        intersectionWidth <= TOPOLOGY_PROVENANCE_EPSILON ||
        intersectionHeight <= TOPOLOGY_PROVENANCE_EPSILON
      ) {
        continue
      }

      const nodeAGroupIndexes = provenance.groupIndexesByNodeId.get(
        nodeA.capacityMeshNodeId,
      )
      const nodeBGroupIndexes = provenance.groupIndexesByNodeId.get(
        nodeB.capacityMeshNodeId,
      )
      if (!nodeAGroupIndexes || !nodeBGroupIndexes) {
        throw new Error(
          `TopologyMergingSolver: missing output provenance for overlapping nodes "${nodeA.capacityMeshNodeId}" and "${nodeB.capacityMeshNodeId}"`,
        )
      }
      const nodeASourceKeys = provenance.sourceKeysByNodeId.get(
        nodeA.capacityMeshNodeId,
      )
      const nodeBSourceKeys = provenance.sourceKeysByNodeId.get(
        nodeB.capacityMeshNodeId,
      )
      if (!nodeASourceKeys || !nodeBSourceKeys) {
        throw new Error(
          `TopologyMergingSolver: missing source provenance for overlapping nodes "${nodeA.capacityMeshNodeId}" and "${nodeB.capacityMeshNodeId}"`,
        )
      }
      if (
        isPreservedSameGroupOverlap({
          groupIndexesA: nodeAGroupIndexes,
          groupIndexesB: nodeBGroupIndexes,
          sourceKeysA: nodeASourceKeys,
          sourceKeysB: nodeBSourceKeys,
          sharedLayers,
          preparedNodeBySourceKey,
        })
      ) {
        continue
      }

      throw new Error(
        `TopologyMergingSolver: output nodes "${nodeA.capacityMeshNodeId}" and "${nodeB.capacityMeshNodeId}" have an unresolved inter-group overlap on a shared layer`,
      )
    }
  }
}

function validateSingleSourceOutput({
  node,
  sourceKey,
  preparedNodeBySourceKey,
}: {
  node: CapacityMeshNode
  sourceKey: string
  preparedNodeBySourceKey: ReadonlyMap<string, PreparedTopologyMergingNode>
}): void {
  const preparedNode = preparedNodeBySourceKey.get(sourceKey)
  if (!preparedNode) {
    throw new Error(
      `TopologyMergingSolver: missing source node for output "${node.capacityMeshNodeId}"`,
    )
  }

  const bounds = getCapacityMeshNodeBounds(node)
  const isInsideSource =
    bounds.minX >= preparedNode.bounds.minX - TOPOLOGY_PROVENANCE_EPSILON &&
    bounds.maxX <= preparedNode.bounds.maxX + TOPOLOGY_PROVENANCE_EPSILON &&
    bounds.minY >= preparedNode.bounds.minY - TOPOLOGY_PROVENANCE_EPSILON &&
    bounds.maxY <= preparedNode.bounds.maxY + TOPOLOGY_PROVENANCE_EPSILON
  const usesOnlySourceLayers = node.availableZ.every((z) =>
    preparedNode.node.availableZ.includes(z),
  )
  if (!isInsideSource || !usesOnlySourceLayers) {
    throw new Error(
      `TopologyMergingSolver: output node "${node.capacityMeshNodeId}" escapes its source geometry or layers`,
    )
  }
}

function isPreservedSameGroupOverlap({
  groupIndexesA,
  groupIndexesB,
  sourceKeysA,
  sourceKeysB,
  sharedLayers,
  preparedNodeBySourceKey,
}: {
  groupIndexesA: number[]
  groupIndexesB: number[]
  sourceKeysA: string[]
  sourceKeysB: string[]
  sharedLayers: number[]
  preparedNodeBySourceKey: ReadonlyMap<string, PreparedTopologyMergingNode>
}): boolean {
  if (
    groupIndexesA.length !== 1 ||
    groupIndexesB.length !== 1 ||
    groupIndexesA[0] !== groupIndexesB[0] ||
    sourceKeysA.length !== 1 ||
    sourceKeysB.length !== 1 ||
    sourceKeysA[0] === sourceKeysB[0]
  ) {
    return false
  }

  const sourceA = preparedNodeBySourceKey.get(sourceKeysA[0]!)
  const sourceB = preparedNodeBySourceKey.get(sourceKeysB[0]!)
  if (!sourceA || !sourceB || sharedLayers.length === 0) return false

  const sourcesShareLayer = sharedLayers.some(
    (z) =>
      sourceA.node.availableZ.includes(z) &&
      sourceB.node.availableZ.includes(z),
  )
  return (
    sourcesShareLayer &&
    getBoundsIntersection(sourceA.bounds, sourceB.bounds) !== null
  )
}
