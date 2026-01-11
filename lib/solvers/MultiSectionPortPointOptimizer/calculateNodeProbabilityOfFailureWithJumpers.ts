import { CapacityMeshNode } from "lib/types"

const JUMPERS_PER_MM_SQUARED = 0.1
export const calculateNodeProbabilityOfFailureWithJumpers = (
  node: CapacityMeshNode,
  numSameLayerCrossings: number,
) => {
  const minDimension = Math.min(node.width, node.height)
  const jumpersWeCanFitInNode = minDimension ** 2 * JUMPERS_PER_MM_SQUARED
  const estimatedRequiredJumpers = numSameLayerCrossings ** 2

  // Temporary fix to prevent putting jumpers in nodes that are too small
  if (minDimension < 6 && estimatedRequiredJumpers > 1) return 1

  return Math.min(1, estimatedRequiredJumpers / jumpersWeCanFitInNode)
}
