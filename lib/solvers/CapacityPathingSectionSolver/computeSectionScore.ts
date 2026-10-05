import { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"
import { ConnectionPathWithNodes } from "../CapacityPathingSolver/CapacityPathingSolver"

export const calculateNodeProbabilityOfFailure = (params: {
  usedCapacity: number
  totalCapacity: number
  layerCount: number
}) => {
  const { usedCapacity, totalCapacity, layerCount } = params

  if (usedCapacity < totalCapacity) return 0
  if (totalCapacity < 1 && usedCapacity <= 1) return 0

  const ratioOverTotal = usedCapacity / totalCapacity

  // If you only have one layer, you really can't have multiple paths, 50% of
  // the time you'll have an unsolvable intersection
  if (layerCount === 1 && usedCapacity > 1) {
    return 1 - 0.01 ** usedCapacity
  }

  // Tunable parameter to shape the curve
  const k = 2 // increase for steeper approach to 1
  const adjustedRatio = ratioOverTotal - 1

  // This function approaches 1 as adjustedRatio increases
  return 1 - Math.exp(-k * adjustedRatio)
}

/**
 * Calculates the log(probability of success) for a single node.
 * Higher is better. Returns 0 if the node is a target or not over capacity.
 */
export const calculateSingleNodeLogSuccessProbability = (
  usedCapacity: number,
  totalCapacity: number,
  node: CapacityMeshNode, // Used for availableZ.length and _containsTarget
): number => {
  // If the node is a target, it doesn't contribute negatively to the score based on capacity.
  // Its "success" is tied to being reached, not its capacity pressure for other paths.
  // We return 0, as log(1) = 0, implying full probability of success from a capacity standpoint.
  if (node._containsTarget) return 0

  // If used capacity is not greater than total capacity, probability of success is 1.
  // log(1) = 0, so it doesn't negatively impact the sum.
  if (usedCapacity <= totalCapacity) return 0

  const probabilityOfFailure = calculateNodeProbabilityOfFailure({
    usedCapacity,
    totalCapacity,
    layerCount: node.availableZ.length,
  })
  const probabilityOfSuccess = 1 - probabilityOfFailure

  // Avoid log(0) or log(<0) if probabilityOfFailure results in non-positive success probability
  if (probabilityOfSuccess <= 0) {
    return -1e9 // Represents an extremely low (effectively zero) probability of success
  } else {
    return Math.log(probabilityOfSuccess)
  }
}

/**
 * Returns log(probability of success) for the section. Higher is better.
 */
export const computeSectionScore = ({
  totalNodeCapacityMap,
  usedNodeCapacityMap,
  nodeMap,
  sectionNodeIds, // Destructure sectionNodeIds here
}: {
  totalNodeCapacityMap: Map<CapacityMeshNodeId, number>
  usedNodeCapacityMap: Map<CapacityMeshNodeId, number>
  nodeMap: Map<CapacityMeshNodeId, CapacityMeshNode>
  sectionNodeIds?: Set<CapacityMeshNodeId> // Optional: Only consider nodes in this set
}) => {
  let logProbabilityOfSuccessSum = 0
  const nodesToConsider = sectionNodeIds ?? new Set(usedNodeCapacityMap.keys()) // Use provided set or all nodes in used map

  for (const nodeId of nodesToConsider) {
    // Skip if node doesn't have capacity info (shouldn't happen if maps are consistent)
    if (!totalNodeCapacityMap.has(nodeId)) continue
    const node = nodeMap.get(nodeId)
    if (!node) continue

    const totalCapacity = totalNodeCapacityMap.get(nodeId)!
    const usedCapacity = usedNodeCapacityMap.get(nodeId) ?? 0

    logProbabilityOfSuccessSum += calculateSingleNodeLogSuccessProbability(
      usedCapacity,
      totalCapacity,
      node,
    )
  }

  return logProbabilityOfSuccessSum
}
