import type { CapacityMeshNode } from "lib/types"
import {
  getCapacityMeshNodeBounds,
  isValidCapacityBounds,
} from "../TopologyPlanningSolver/capacity-node-geometry"
import { getTopologyMergingNodesWithCrossLayerTargetAccess } from "./get-cross-layer-target-access"
import type {
  PreparedTopologyMergingNode,
  TopologyMergingSolverParams,
} from "./topology-merging-types"

export type PreparedTopologyMergingInput = {
  preparedNodes: PreparedTopologyMergingNode[]
  preparedNodeBySourceKey: Map<string, PreparedTopologyMergingNode>
}

export function prepareTopologyMergingInput(
  inputProblem: TopologyMergingSolverParams,
): PreparedTopologyMergingInput {
  validateTopologyMergingInput(inputProblem)

  const preparedNodes: PreparedTopologyMergingNode[] = []
  const preparedNodeBySourceKey = new Map<string, PreparedTopologyMergingNode>()
  const mergingNodeByInputNode =
    getTopologyMergingNodesWithCrossLayerTargetAccess(inputProblem)
  for (
    let groupIndex = 0;
    groupIndex < inputProblem.nodeGroups.length;
    groupIndex++
  ) {
    const group = inputProblem.nodeGroups[groupIndex]!
    for (const inputNode of group.nodes) {
      for (const node of mergingNodeByInputNode.get(inputNode)!) {
        const preparedNode: PreparedTopologyMergingNode = {
          sourceKey: `${group.groupId}:${node.capacityMeshNodeId}`,
          groupIndex,
          node,
          bounds: getCapacityMeshNodeBounds(node),
        }
        preparedNodes.push(preparedNode)
        preparedNodeBySourceKey.set(preparedNode.sourceKey, preparedNode)
      }
    }
  }

  return { preparedNodes, preparedNodeBySourceKey }
}

function validateTopologyMergingInput(
  inputProblem: TopologyMergingSolverParams,
): void {
  if (!Number.isInteger(inputProblem.layerCount)) {
    throw new Error("TopologyMergingSolver: layerCount must be an integer")
  }
  if (inputProblem.layerCount <= 0) {
    throw new Error("TopologyMergingSolver: layerCount must be positive")
  }
  if (
    inputProblem.viaDiameter !== undefined &&
    (!Number.isFinite(inputProblem.viaDiameter) ||
      inputProblem.viaDiameter <= 0)
  ) {
    throw new Error("TopologyMergingSolver: viaDiameter must be positive")
  }
  if (
    inputProblem.viaFootprintMargin !== undefined &&
    (!Number.isFinite(inputProblem.viaFootprintMargin) ||
      inputProblem.viaFootprintMargin < 0)
  ) {
    throw new Error(
      "TopologyMergingSolver: viaFootprintMargin must be non-negative",
    )
  }
  if (inputProblem.nodeGroups.length === 0) {
    throw new Error(
      "TopologyMergingSolver: at least one node group is required",
    )
  }

  const groupIds = new Set<string>()
  let nodeCount = 0
  for (const group of inputProblem.nodeGroups) {
    if (groupIds.has(group.groupId)) {
      throw new Error(
        `TopologyMergingSolver: duplicate topology group id "${group.groupId}"`,
      )
    }
    groupIds.add(group.groupId)
    nodeCount += group.nodes.length
    if (group.nodes.length === 0) {
      throw new Error(
        `TopologyMergingSolver: topology group "${group.groupId}" is empty`,
      )
    }

    const nodeIds = new Set<string>()
    for (const node of group.nodes) {
      if (nodeIds.has(node.capacityMeshNodeId)) {
        throw new Error(
          `TopologyMergingSolver: duplicate node id "${node.capacityMeshNodeId}" in group "${group.groupId}"`,
        )
      }
      nodeIds.add(node.capacityMeshNodeId)
      validateTopologyMergingNode({
        node,
        groupId: group.groupId,
        layerCount: inputProblem.layerCount,
      })
    }
  }

  if (nodeCount === 0) {
    throw new Error("TopologyMergingSolver: topology node groups are empty")
  }
}

function validateTopologyMergingNode({
  node,
  groupId,
  layerCount,
}: {
  node: CapacityMeshNode
  groupId: string
  layerCount: number
}): void {
  if (!isValidCapacityBounds(getCapacityMeshNodeBounds(node))) {
    throw new Error(
      `TopologyMergingSolver: node "${node.capacityMeshNodeId}" in group "${groupId}" has invalid bounds`,
    )
  }
  if (node.availableZ.length === 0) {
    throw new Error(
      `TopologyMergingSolver: node "${node.capacityMeshNodeId}" in group "${groupId}" has no available layers`,
    )
  }

  const sortedAvailableZ = [...new Set(node.availableZ)].sort((a, b) => a - b)
  const hasInvalidLayer = sortedAvailableZ.some(
    (z) => !Number.isInteger(z) || z < 0 || z >= layerCount,
  )
  const hasSortedUniqueAvailableZ =
    sortedAvailableZ.length === node.availableZ.length &&
    sortedAvailableZ.every((z, index) => z === node.availableZ[index])
  if (hasInvalidLayer || !hasSortedUniqueAvailableZ) {
    throw new Error(
      `TopologyMergingSolver: node "${node.capacityMeshNodeId}" in group "${groupId}" has invalid or unsorted availableZ`,
    )
  }
}
