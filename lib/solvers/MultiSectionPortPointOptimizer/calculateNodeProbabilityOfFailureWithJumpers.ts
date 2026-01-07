import { CapacityMeshNode } from "lib/types"

const JUMPERS_PER_MM_SQUARED = 0.1
export const calculateNodeProbabilityOfFailureWithJumpers = (
  node: CapacityMeshNode,
  numSameLayerCrossings: number,
) => {
  const nodeArea = node.width * node.height
  const jumpersWeCanFitInNode = nodeArea * JUMPERS_PER_MM_SQUARED
  const estimatedRequiredJumpers = numSameLayerCrossings ** 2
  return Math.min(1, estimatedRequiredJumpers / jumpersWeCanFitInNode)
}
