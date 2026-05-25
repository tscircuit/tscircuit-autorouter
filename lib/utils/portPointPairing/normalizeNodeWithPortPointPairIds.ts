import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { getExplicitPortPointPairIds } from "./getExplicitPortPointPairIds"

/**
 * Normalizes a node so explicit pair ids are always stored in
 * `portPointPairIds`.
 *
 * @param nodeWithPortPoints - Node to normalize.
 * @returns A shallow clone of the node with `portPointPairIds` populated from
 * any supported explicit pairing source.
 * @note This does not remove `portPointsInPairs`; it only guarantees the
 * normalized id-based representation exists.
 */
export const normalizeNodeWithPortPointPairIds = (
  nodeWithPortPoints: NodeWithPortPoints,
): NodeWithPortPoints => ({
  ...nodeWithPortPoints,
  portPointPairIds: getExplicitPortPointPairIds(nodeWithPortPoints),
})
