import type { CapacityMeshNode } from "lib/types"
import {
  getCapacityMeshNodeBounds,
  isValidCapacityBounds,
} from "../TopologyPlanningSolver/capacity-node-geometry"
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
  const useLayerBitmask = inputProblem.layerCount <= 30
  for (
    let groupIndex = 0;
    groupIndex < inputProblem.nodeGroups.length;
    groupIndex++
  ) {
    const group = inputProblem.nodeGroups[groupIndex]!
    for (const node of group.nodes) {
      const sourceKey = `${group.groupId}:${node.capacityMeshNodeId}`
      const singleSourceKeys = [sourceKey]
      let layerMask: number | undefined
      if (useLayerBitmask) {
        layerMask = 0
        for (const z of node.availableZ) {
          layerMask |= 1 << z
        }
      }
      const preparedNode: PreparedTopologyMergingNode = {
        sourceKey,
        groupIndex,
        node,
        bounds: getCapacityMeshNodeBounds(node),
        layerMask,
        singleSourceKeys,
        passthroughSignature: JSON.stringify({
          mode: "passthrough",
          sourceKeys: singleSourceKeys,
        }),
        targetPassthroughSignature: JSON.stringify({
          mode: "target-passthrough",
          sourceKeys: singleSourceKeys,
        }),
      }
      preparedNodes.push(preparedNode)
      preparedNodeBySourceKey.set(preparedNode.sourceKey, preparedNode)
    }
  }

  const localeSortedNodes = [...preparedNodes].sort((a, b) =>
    a.sourceKey.localeCompare(b.sourceKey),
  )
  for (let rank = 0; rank < localeSortedNodes.length; rank++) {
    localeSortedNodes[rank]!.localeRank = rank
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
