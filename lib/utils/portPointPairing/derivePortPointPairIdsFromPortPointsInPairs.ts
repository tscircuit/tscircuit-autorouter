import type { PortPoint } from "lib/types/high-density-types"

/**
 * Derives explicit pair ids from `portPointsInPairs`.
 *
 * @param portPointsInPairs - Existing explicit port-point pair objects.
 * @returns Pair ids for entries where both endpoints have distinct
 * `portPointId` values, or `undefined` when no valid ids can be produced.
 * @caution Pairs without ids are dropped because they cannot be referenced
 * stably after cloning or normalization.
 */
export const derivePortPointPairIdsFromPortPointsInPairs = (
  portPointsInPairs?: [
    Pick<PortPoint, "portPointId">,
    Pick<PortPoint, "portPointId">,
  ][],
): [string, string][] | undefined => {
  if (!portPointsInPairs?.length) return undefined

  const portPointPairIds = portPointsInPairs.flatMap(([start, end]) =>
    start.portPointId &&
    end.portPointId &&
    start.portPointId !== end.portPointId
      ? ([[start.portPointId, end.portPointId]] as [string, string][])
      : [],
  )

  return portPointPairIds.length > 0 ? portPointPairIds : undefined
}
