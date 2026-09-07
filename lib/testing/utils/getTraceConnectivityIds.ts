import type { SimplifiedPcbTrace } from "lib/types"

type TraceWithLegacyConnectivity = SimplifiedPcbTrace & {
  connectedTo?: SimplifiedPcbTrace["connectsTo"]
}

export function getTraceConnectivityIds(
  trace: SimplifiedPcbTrace,
): readonly string[] {
  if (trace.connectsTo !== undefined) {
    return trace.connectsTo
  }
  const legacyTrace = trace as TraceWithLegacyConnectivity
  if (legacyTrace.connectedTo !== undefined) {
    return legacyTrace.connectedTo
  }
  return []
}
