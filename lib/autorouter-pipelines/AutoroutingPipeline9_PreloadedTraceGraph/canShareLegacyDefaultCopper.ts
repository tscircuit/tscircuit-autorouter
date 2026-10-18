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
    srj.min_via_hole_diameter,
    srj.min_via_pad_diameter,
    srj.defaultObstacleMargin,
    srj.minTraceToPadEdgeClearance,
    srj.minTraceToHoleEdgeClearance,
    srj.minBoardEdgeClearance,
    srj.minViaHoleEdgeToViaHoleEdgeClearance,
    srj.minViaEdgeToPadEdgeClearance,
    srj.minPlatedHoleDrillEdgeToDrillEdgeClearance,
    srj.minPadEdgeToPadEdgeClearance,
  ]
  return (
    declaredRules.every((value) => value === undefined) &&
    srj.connections.every(
      (connection) =>
        (connection.nominalTraceWidth ??
          connection.width ??
          srj.minTraceWidth) <= srj.minTraceWidth,
    ) &&
    !srj.buses?.some(
      (bus) =>
        bus.traceWidth !== undefined && bus.traceWidth > srj.minTraceWidth,
    )
  )
}
