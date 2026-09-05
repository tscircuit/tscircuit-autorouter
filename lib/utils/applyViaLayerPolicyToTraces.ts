import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { getDeclaredViaLayers } from "./getDeclaredViaLayers"

/** Attach manufacturing geometry only when the caller declares a via policy. */
export const applyViaLayerPolicyToTraces = (
  traces: SimplifiedPcbTraces,
  srj: Pick<SimpleRouteJson, "layerCount" | "allowBlindAndBuriedVias">,
): SimplifiedPcbTraces => {
  if (srj.allowBlindAndBuriedVias === undefined) return traces
  return traces.map((trace) => ({
    ...trace,
    route: trace.route.map((point) =>
      point.route_type === "via"
        ? {
            ...point,
            layers: getDeclaredViaLayers({
              layerCount: srj.layerCount,
              allowBlindAndBuriedVias: srj.allowBlindAndBuriedVias,
              fromLayer: point.from_layer,
              toLayer: point.to_layer,
              layers: point.layers,
            }),
          }
        : point,
    ),
  }))
}
