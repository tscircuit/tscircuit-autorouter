import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { mapZToLayerName } from "./mapZToLayerName"

/** Emit explicit full-stack geometry when routing requires through vias. */
export const addThroughViaLayersToTraces = (
  traces: SimplifiedPcbTraces,
  srj: Pick<SimpleRouteJson, "layerCount" | "allowBlindAndBuriedVias">,
): SimplifiedPcbTraces => {
  if (srj.allowBlindAndBuriedVias !== false) return traces
  const layers = Array.from({ length: srj.layerCount }, (_, z) =>
    mapZToLayerName(z, srj.layerCount),
  )
  return traces.map((trace) => ({
    ...trace,
    route: trace.route.map((point) =>
      point.route_type === "via" ? { ...point, layers } : point,
    ),
  }))
}
