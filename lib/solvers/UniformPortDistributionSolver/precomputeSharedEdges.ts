import { getSharedEdgeForNodePair } from "./getSharedEdgeForNodePair"
import { Bounds, OwnerPair, OwnerPairKey, SharedEdge } from "./types"
import { getOwnerPairKey } from "./getOwnerPairKey"

/**
 * Builds a reusable lookup of valid shared edges for all owner pairs that
 * will be processed, avoiding repeated geometry checks during solver steps.
 */
export const precomputeSharedEdges = ({
  ownerPairs,
  nodeBounds,
}: {
  ownerPairs: OwnerPair[]
  nodeBounds: Map<string, Bounds>
}): Map<OwnerPairKey, SharedEdge> => {
  const sharedEdges = new Map<OwnerPairKey, SharedEdge>()
  for (const ownerPair of ownerPairs) {
    const [nodeAId, nodeBId] = ownerPair
    if (nodeAId === nodeBId) continue

    const sharedEdge = getSharedEdgeForNodePair({
      nodeAId,
      nodeBId,
      nodeBounds,
    })
    if (!sharedEdge) continue

    sharedEdges.set(getOwnerPairKey(ownerPair), sharedEdge)
  }
  return sharedEdges
}
