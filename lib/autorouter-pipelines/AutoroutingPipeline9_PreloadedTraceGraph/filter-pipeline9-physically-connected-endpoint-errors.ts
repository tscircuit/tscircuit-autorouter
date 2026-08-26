import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimplifiedPcbTrace } from "lib/types"

type DrcError = Record<string, unknown>

// Simplified route output is rounded to 0.001 mm while retained preload
// endpoints preserve imported precision.
const ENDPOINT_LOCATION_EPSILON = 1e-3
const COPPER_CONTACT_NUMERIC_EPSILON = 1e-9

/** Removes disconnected-endpoint findings disproved by same-net copper contact. */
export const filterPipeline9PhysicallyConnectedEndpointErrors = <
  TError extends DrcError,
>({
  errors,
  evaluatedTraces,
  connMap,
}: {
  errors: TError[]
  evaluatedTraces: readonly SimplifiedPcbTrace[]
  connMap: ConnectivityMap
}): TError[] => {
  const traceById = new Map(
    evaluatedTraces.map((trace) => [trace.pcb_trace_id, trace]),
  )

  return errors.filter((error) => {
    const traceId =
      typeof error.pcb_trace_id === "string" ? error.pcb_trace_id : undefined
    const errorId =
      typeof error.pcb_trace_error_id === "string"
        ? error.pcb_trace_error_id
        : undefined
    const center =
      error.center && typeof error.center === "object"
        ? (error.center as Record<string, unknown>)
        : undefined
    if (
      !traceId ||
      !errorId?.startsWith(`disconnected_endpoint_${traceId}_`) ||
      typeof center?.x !== "number" ||
      typeof center.y !== "number"
    ) {
      return true
    }
    const centerX = center.x
    const centerY = center.y

    const disconnectedTrace = traceById.get(traceId)
    if (!disconnectedTrace) return true
    const endpoint = [
      disconnectedTrace.route[0],
      disconnectedTrace.route.at(-1),
    ].find(
      (routePoint) =>
        routePoint?.route_type === "wire" &&
        Math.hypot(routePoint.x - centerX, routePoint.y - centerY) <=
          ENDPOINT_LOCATION_EPSILON,
    )
    if (!endpoint || endpoint.route_type !== "wire") return true

    for (const otherTrace of evaluatedTraces) {
      if (otherTrace.pcb_trace_id === disconnectedTrace.pcb_trace_id) continue
      const sameNet =
        otherTrace.connection_name === disconnectedTrace.connection_name ||
        connMap.areIdsConnected(
          otherTrace.connection_name,
          disconnectedTrace.connection_name,
        )
      if (!sameNet) continue
      const hasCopperContact = otherTrace.route.some(
        (routePoint) =>
          routePoint.route_type === "wire" &&
          routePoint.layer === endpoint.layer &&
          Math.hypot(routePoint.x - endpoint.x, routePoint.y - endpoint.y) <=
            (routePoint.width + endpoint.width) / 2 +
              COPPER_CONTACT_NUMERIC_EPSILON,
      )
      if (hasCopperContact) return false
    }

    return true
  })
}
