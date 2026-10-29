import type { SimpleRouteJson } from "lib/types"

/** A via-specific rule cannot weaken the board's general pad-copper rule. */
export const getViaToPadClearance = (
  srj: Pick<
    SimpleRouteJson,
    "minViaEdgeToPadEdgeClearance" | "minPadEdgeToPadEdgeClearance"
  >,
): number | undefined =>
  srj.minViaEdgeToPadEdgeClearance === undefined
    ? srj.minPadEdgeToPadEdgeClearance
    : Math.max(
        srj.minViaEdgeToPadEdgeClearance,
        srj.minPadEdgeToPadEdgeClearance ?? 0,
      )
