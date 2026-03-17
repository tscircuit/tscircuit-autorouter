import { CapacityMeshNode } from "lib/types"
import { getTunedTotalCapacity1 } from "lib/utils/getTunedTotalCapacity1"

export const calculateNodeProbabilityOfFailure = (
  node: CapacityMeshNode,
  numSameLayerCrossings: number,
  numEntryExitLayerChanges: number,
  numTransitionCrossings: number,
): number => {
  if (node?._containsTarget) return 0

  const numLayers = node.availableZ?.length ?? 2

  if (
    numLayers === 1 &&
    (numSameLayerCrossings > 0 ||
      numEntryExitLayerChanges > 0 ||
      numTransitionCrossings > 0)
  ) {
    return 1
  }

  // Estimated number of vias based on crossings
  const estNumVias =
    numSameLayerCrossings * 0.82 +
    numEntryExitLayerChanges * 0.41 +
    numTransitionCrossings * 0.2

  const estUsedCapacity = (estNumVias / 2) ** 1.1
  if (!Number.isFinite(estUsedCapacity)) {
    return 1
  }

  // Number of traces through the node
  const totalCapacity = getTunedTotalCapacity1(node)
  if (!Number.isFinite(totalCapacity) || totalCapacity <= 0) {
    return estUsedCapacity > 0 ? 1 : 0
  }

  // We could refine this with actual trace capacity
  const approxProb = estUsedCapacity / totalCapacity
  if (Number.isNaN(approxProb)) {
    throw new Error("calculateNodeProbabilityOfFailure returned NaN")
  }
  if (!Number.isFinite(approxProb)) {
    return estUsedCapacity > 0 ? 1 : 0
  }

  // Bounded probability calculation
  return approxProb
}
