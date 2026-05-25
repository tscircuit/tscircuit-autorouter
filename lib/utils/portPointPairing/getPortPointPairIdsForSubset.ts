import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import { clonePortPointPairIds } from "./clonePortPointPairIds"
import { getExplicitPortPointPairIds } from "./getExplicitPortPointPairIds"

/**
 * Filters explicit pair ids down to the pairs fully contained in a port-point
 * subset.
 *
 * @param nodeWithPortPoints - Node that owns the explicit pair ids.
 * @param portPoints - Port points that define the subset.
 * @returns Cloned pair ids whose endpoints both exist in the subset, or
 * `undefined` when no explicit subset pairs exist.
 * @caution Port points without `portPointId` are ignored because subset
 * matching is id-based.
 */
export const getPortPointPairIdsForSubset = (
  nodeWithPortPoints: Pick<
    NodeWithPortPoints,
    "portPointPairIds" | "portPointsInPairs"
  >,
  portPoints: Array<Pick<PortPoint, "portPointId">>,
): [string, string][] | undefined => {
  const explicitPairIds = getExplicitPortPointPairIds(nodeWithPortPoints)
  if (!explicitPairIds?.length) return undefined

  const selectedPortPointIds = new Set(
    portPoints.flatMap((portPoint) =>
      portPoint.portPointId ? [portPoint.portPointId] : [],
    ),
  )
  if (selectedPortPointIds.size === 0) return undefined

  const relevantPairIds = explicitPairIds.filter(
    ([startPortPointId, endPortPointId]) =>
      selectedPortPointIds.has(startPortPointId) &&
      selectedPortPointIds.has(endPortPointId),
  )

  return relevantPairIds.length > 0
    ? clonePortPointPairIds(relevantPairIds)
    : undefined
}
