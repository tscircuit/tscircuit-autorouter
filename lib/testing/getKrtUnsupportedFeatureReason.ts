import type { SimpleRouteJson } from "lib/types"

/** Applicability is decided before either direct or general routing starts. */
export const getKrtUnsupportedFeatureReason = (
  original: SimpleRouteJson,
): string | undefined => {
  if (
    original.traces?.length ||
    original.allowBlindAndBuriedVias ||
    original.allowViaInPad === true ||
    original.jumpers?.length ||
    original.allowJumpers ||
    original.differentialPairs?.length ||
    original.buses?.length ||
    original.minTraceToPadEdgeClearance !== undefined ||
    original.minViaEdgeToPadEdgeClearance !== undefined ||
    original.minPlatedHoleDrillEdgeToDrillEdgeClearance !== undefined ||
    original.minPadEdgeToPadEdgeClearance !== undefined ||
    original.connections.some((connection) =>
      connection.isOffBoard || connection.externallyConnectedPointIds?.length ||
      connection.pointsToConnect.some((point) => "terminalVia" in point && point.terminalVia),
    )
  ) {
    return "Direct KRT routing does not support preloaded copper, blind/buried vias, via-in-pad, jumpers, paired/bus constraints, typed pad/plated-hole rules, off-board connectivity or terminal via hints"
  }
  return undefined
}
