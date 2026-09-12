import { OwnerPair, OwnerPairKey } from "./types"
import { initializeAutorouterBindings } from "../../bindings/initializeAutorouterBindings"
import { decodeName, encodeName } from "../../bindings/uniform-port-distribution/UniformPortDistributionCodec"
import { normalizeUniformPortOwnerPair, getUniformPortOwnerPairKey } from "../../../rust/autorouter-bindings/pkg/autorouter_bindings.js"

/**
 * Creates a deterministic two-node owner identity so pair-based maps and
 * family grouping remain stable regardless of input ordering.
 */
export const normalizeOwnerPair = (nodeA: string, nodeB: string): OwnerPair => {
  initializeAutorouterBindings()
  const pair = normalizeUniformPortOwnerPair(
    encodeName(nodeA), encodeName(nodeB),
  )
  return [decodeName(pair[0]), decodeName(pair[1])]
}

/**
 * Encodes the normalized owner pair into a compact key used across solver
 * state for bucketing, precompute lookup, and visualization.
 */
export const getOwnerPairKey = (ownerNodeIds: OwnerPair): OwnerPairKey => {
  initializeAutorouterBindings()
  const key = getUniformPortOwnerPairKey(
    [encodeName(ownerNodeIds[0]), encodeName(ownerNodeIds[1])],
  )
  return decodeName(key)
}
