import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { clonePortPointPairIds } from "./clonePortPointPairIds"

/**
 * Reads explicit pair ids from a node.
 *
 * @param nodeWithPortPoints - Node data that may define pair ids directly.
 * @returns Cloned explicit pair ids, or `undefined` when the node does not
 * define any explicit id-based pairing.
 * @note Legacy `portPointsInPairs` data is intentionally ignored here so older
 * routing behavior is preserved unless callers opt into explicit id pairing.
 */
export const getExplicitPortPointPairIds = (
  nodeWithPortPoints: Pick<
    NodeWithPortPoints,
    "portPointPairIds" | "portPointsInPairs"
  >,
): [string, string][] | undefined => {
  if (nodeWithPortPoints.portPointPairIds?.length) {
    return clonePortPointPairIds(nodeWithPortPoints.portPointPairIds)
  }
  return undefined
}
