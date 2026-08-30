import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimplifiedPcbTrace } from "lib/types"
import { convertPreloadedTraceToHdRoutes } from "./convertPreloadedTraceToHdRoutes"

const REGIONAL_PROMOTION_HALF_SIZE = 1.5

const getTracePairErrorCenters = (
  errorsWithCenters: Array<Record<string, unknown>>,
) =>
  errorsWithCenters.flatMap((error) => {
    if (
      error.type !== "pcb_trace_error" ||
      !Array.isArray(error.pcb_port_ids) ||
      error.pcb_port_ids.length < 4
    )
      return []
    const center = error.center
    return center &&
      typeof center === "object" &&
      "x" in center &&
      "y" in center &&
      typeof center.x === "number" &&
      typeof center.y === "number"
      ? [{ x: center.x, y: center.y }]
      : []
  })

/**
 * Makes every preloaded trace crossing an initial trace-pair DRC region
 * available to the last-resort regional rerouter. Connectivity still comes
 * from trace metadata; geometry only determines membership in the region.
 */
export const getPipeline9PreloadedTraceIdsInInitialDrcRegions = ({
  errorsWithCenters,
  traces,
  layerCount,
  defaultViaDiameter,
  connMap,
}: {
  errorsWithCenters: Array<Record<string, unknown>>
  traces: SimplifiedPcbTrace[]
  layerCount: number
  defaultViaDiameter: number
  connMap: ConnectivityMap
}): Set<string> => {
  const repairCenters = getTracePairErrorCenters(errorsWithCenters)
  const traceIds = new Set<string>()
  for (let traceIndex = 0; traceIndex < traces.length; traceIndex++) {
    const trace = traces[traceIndex]!
    const sections = convertPreloadedTraceToHdRoutes(
      trace,
      traceIndex,
      layerCount,
      defaultViaDiameter,
      connMap,
    )
    const intersectsRepairRegion = repairCenters.some((center) =>
      sections.some((section) => {
        const xs = section.route.map((point) => point.x)
        const ys = section.route.map((point) => point.y)
        return (
          Math.min(...xs) <= center.x + REGIONAL_PROMOTION_HALF_SIZE &&
          Math.max(...xs) >= center.x - REGIONAL_PROMOTION_HALF_SIZE &&
          Math.min(...ys) <= center.y + REGIONAL_PROMOTION_HALF_SIZE &&
          Math.max(...ys) >= center.y - REGIONAL_PROMOTION_HALF_SIZE
        )
      }),
    )
    if (intersectsRepairRegion) traceIds.add(trace.pcb_trace_id)
  }
  return traceIds
}
