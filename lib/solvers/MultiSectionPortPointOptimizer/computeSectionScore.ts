import type { CapacityMeshNode, CapacityMeshNodeId } from "../../types"
import type { NodeWithPortPoints } from "../../types/high-density-types"
import { getIntraNodeCrossings } from "../../utils/getIntraNodeCrossings"
import { calculateNodeProbabilityOfFailure } from "../UnravelSolver/calculateCrossingProbabilityOfFailure"

/**
 * Computes a log-based score for a section of nodes with port points.
 *
 * The score is logSuccess = sum(log(1 - Pf)) for all contributing nodes.
 * This represents the log probability of all nodes succeeding.
 * Higher scores are better (closer to 0 means higher probability of success).
 *
 * Note: We return logSuccess directly instead of computing log(1 - exp(logSuccess)) to avoid
 * numerical precision issues when logSuccess is very negative (where exp(logSuccess) underflows to 0).
 *
 * @param nodesWithPortPoints - Nodes in the section with their assigned port points
 * @param capacityMeshNodeMap - Map from node ID to capacity mesh node for Pf calculation
 * @returns Score where higher is better (0 = perfect, more negative = more failures expected)
 */
export function computeSectionScore(
  nodesWithPortPoints: NodeWithPortPoints[],
  capacityMeshNodeMap: Map<CapacityMeshNodeId, CapacityMeshNode>,
  opts?: {
    NODE_MAX_PF?: number
  },
): number {
  let logSuccess = 0 // log(probability all nodes succeed)
  const NODE_MAX_PF = opts?.NODE_MAX_PF ?? 0.99999

  for (const nodeWithPortPoints of nodesWithPortPoints) {
    const node = capacityMeshNodeMap.get(nodeWithPortPoints.capacityMeshNodeId)
    if (!node) continue

    // Skip target nodes (they don't contribute to failure)
    if (node._containsTarget) continue

    // Compute crossings for this node
    const crossings = getIntraNodeCrossings(nodeWithPortPoints)

    // Compute probability of failure
    const estPf = Math.min(
      calculateNodeProbabilityOfFailure(
        node,
        crossings.numSameLayerCrossings,
        crossings.numEntryExitLayerChanges,
        crossings.numTransitionPairCrossings,
      ),
      NODE_MAX_PF,
    )

    // Add log(1 - Pf) to logSuccess
    // In log space, multiplying probabilities = adding logs
    const log1mPf = Math.log(1 - estPf)
    logSuccess += log1mPf
  }

  // Return logSuccess directly (higher is better)
  // When logSuccess is 0 (all Pf=0 or no contributing nodes), score is 0 (perfect)
  // When logSuccess is negative (some failures possible), score is worse
  return logSuccess
}

/**
 * Computes the probability of failure for a single node based on its port points.
 * Useful for finding the highest Pf node.
 *
 * @param nodeWithPortPoints - The node with assigned port points
 * @param capacityMeshNode - The capacity mesh node
 * @returns Probability of failure (0-1, higher is worse)
 */
export function computeNodePf(
  nodeWithPortPoints: NodeWithPortPoints,
  capacityMeshNode: CapacityMeshNode,
): number {
  if (capacityMeshNode._containsTarget) return 0

  const crossings = getIntraNodeCrossings(nodeWithPortPoints)

  return calculateNodeProbabilityOfFailure(
    capacityMeshNode,
    crossings.numSameLayerCrossings,
    crossings.numEntryExitLayerChanges,
    crossings.numTransitionPairCrossings,
  )
}
