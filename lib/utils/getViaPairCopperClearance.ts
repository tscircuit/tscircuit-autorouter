import type { SimpleRouteJson } from "lib/types"
import { RELAXED_DRC_OPTIONS } from "./drcPresets"
import { getViaDimensions } from "./getViaDimensions"

export const getViaPairCopperClearance = (
  srj: SimpleRouteJson,
  viaHoleDiameterOverride?: number,
): number => {
  const { padDiameter, holeDiameter } = getViaDimensions(srj)
  const effectiveHoleDiameter = viaHoleDiameterOverride ?? holeDiameter
  const drillDrivenCopperClearance =
    srj.minViaHoleEdgeToViaHoleEdgeClearance === undefined
      ? 0
      : effectiveHoleDiameter +
        srj.minViaHoleEdgeToViaHoleEdgeClearance -
        padDiameter
  return Math.max(
    srj.minPadEdgeToPadEdgeClearance ?? RELAXED_DRC_OPTIONS.viaClearance,
    drillDrivenCopperClearance,
  )
}
