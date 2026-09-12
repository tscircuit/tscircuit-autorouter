import { Bounds, OwnerPair, OwnerPairKey, SharedEdge } from "./types"
import { initializeAutorouterBindings } from "../../bindings/initializeAutorouterBindings"
import { decodeName, decodeSharedEdge, encodeName, encodeBounds } from "../../bindings/uniform-port-distribution/UniformPortDistributionCodec"
import { precomputeUniformSharedEdges } from "../../../rust/autorouter-bindings/pkg/autorouter_bindings.js"

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
  initializeAutorouterBindings()
  const entries = precomputeUniformSharedEdges({
    ownerPairs: ownerPairs.map(pair => [encodeName(pair[0]), encodeName(pair[1])]),
    nodeBounds: [...nodeBounds].map(([key, bounds]) => [encodeName(key), encodeBounds(bounds)]),
  })
  return new Map(entries.map(([key, edge]) => [decodeName(key), decodeSharedEdge(edge)]))
}
