import { OwnerPair, OwnerPairKey } from "./types"

/**
 * Creates a deterministic two-node owner identity so pair-based maps and
 * family grouping remain stable regardless of input ordering.
 */
export const normalizeOwnerPair = (nodeA: string, nodeB: string): OwnerPair =>
  nodeA <= nodeB ? [nodeA, nodeB] : [nodeB, nodeA]

/**
 * Encodes the normalized owner pair into a compact key used across solver
 * state for bucketing, precompute lookup, and visualization.
 */
export const getOwnerPairKey = (ownerNodeIds: OwnerPair): OwnerPairKey =>
  `${ownerNodeIds[0]}|${ownerNodeIds[1]}`
