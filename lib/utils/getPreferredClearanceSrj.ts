import type { SimpleRouteJson } from "lib/types"

/**
 * Cleanup should seek benchmark-relaxed trace spacing even on fine-pitch boards
 * that permit tighter escapes. Keep the original input for topology generation
 * and preserve independently declared via-to-pad manufacturing clearances.
 */
export const getPreferredClearanceSrj = (srj: SimpleRouteJson): SimpleRouteJson => {
  return {
    ...srj,
    minTraceToPadEdgeClearance:
      srj.minTraceToPadEdgeClearance === undefined
        ? undefined
        : Math.max(0.1, srj.minTraceToPadEdgeClearance),
  }
}
