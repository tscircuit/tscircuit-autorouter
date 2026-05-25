/**
 * Clones explicit port-point pair ids.
 *
 * @param portPointPairIds - Pair ids to copy.
 * @returns A deep copy of the provided tuple array.
 * @note This prevents later mutation from leaking back into solver inputs.
 */
export const clonePortPointPairIds = (
  portPointPairIds: [string, string][],
): [string, string][] =>
  portPointPairIds.map(
    ([startPortPointId, endPortPointId]) =>
      [startPortPointId, endPortPointId] as [string, string],
  )
