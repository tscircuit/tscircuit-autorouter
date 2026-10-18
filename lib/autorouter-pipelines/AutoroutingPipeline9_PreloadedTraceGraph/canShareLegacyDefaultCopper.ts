import type { SimpleRouteJson } from "lib/types"

/** Reuse logical aliases only for the legacy uniform/default copper model. */
export const canShareLegacyDefaultCopper = (srj: SimpleRouteJson): boolean => {
  // Advisory layers do not imply identical physical copper demands. Explicit
  // widths, via dimensions and clearances retain the declared-board model.
  const declaredRules = [
    srj.nominalTraceWidth,
    srj.minViaDiameter,
    srj.minViaPadDiameter,
    srj.minViaHoleDiameter,
    srj.minTraceToPadEdgeClearance,
    srj.minViaHoleEdgeToViaHoleEdgeClearance,
    srj.minViaEdgeToPadEdgeClearance,
  ]
  return declaredRules.every((value) => value === undefined)
}
