import type { SimpleRouteJson } from "lib/types"

/** Custom physical clearances need the established force-repair starting point. */
export const getPipeline9ForceWarmupIterations = (
  srj: SimpleRouteJson,
): number => {
  const declaredClearances = [
    srj.minTraceToPadEdgeClearance,
    srj.minTraceToHoleEdgeClearance,
    srj.minBoardEdgeClearance,
    srj.minViaEdgeToPadEdgeClearance,
    srj.minViaHoleEdgeToViaHoleEdgeClearance,
    srj.minPlatedHoleDrillEdgeToDrillEdgeClearance,
    srj.minPadEdgeToPadEdgeClearance,
  ]
  return srj.layerCount === 2 &&
    (srj.traces?.length ?? 0) === 0 &&
    declaredClearances.every((clearance) => clearance === undefined)
    ? 2
    : 16
}
