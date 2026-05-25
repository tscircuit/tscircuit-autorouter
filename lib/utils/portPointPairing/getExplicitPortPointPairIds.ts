import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { clonePortPointPairIds } from "./clonePortPointPairIds"
import { derivePortPointPairIdsFromPortPointsInPairs } from "./derivePortPointPairIdsFromPortPointsInPairs"

/**
 * Reads explicit pair ids from a node, normalizing legacy paired-port input
 * when needed.
 *
 * @param nodeWithPortPoints - Node data that may define pair ids directly or
 * via `portPointsInPairs`.
 * @returns Cloned explicit pair ids, or `undefined` when the node does not
 * define any explicit pairing.
 * @note `portPointPairIds` takes precedence over `portPointsInPairs`.
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

  return derivePortPointPairIdsFromPortPointsInPairs(
    nodeWithPortPoints.portPointsInPairs,
  )
}
