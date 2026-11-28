import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getViaDimensions } from "./getViaDimensions"
import { isViaInKeepout } from "./isViaInKeepout"
import { mapLayerNameToZ } from "./mapLayerNameToZ"

/** Validate final copper after routing/repair; never publish an illegal via. */
export function assertTracesAvoidViaKeepouts(
  traces: SimplifiedPcbTrace[],
  srj: SimpleRouteJson,
): void {
  if (!srj.viaKeepouts?.length) return
  for (const trace of traces) {
    for (const point of trace.route) {
      if (point.route_type !== "via") continue
      const zs = point.layers?.map((layer) =>
        mapLayerNameToZ(layer, srj.layerCount),
      ) ?? [
        mapLayerNameToZ(point.from_layer, srj.layerCount),
        mapLayerNameToZ(point.to_layer, srj.layerCount),
      ]
      const minZ = srj.allowBlindAndBuriedVias ? Math.min(...zs) : 0
      const maxZ = srj.allowBlindAndBuriedVias
        ? Math.max(...zs)
        : srj.layerCount - 1
      if (
        isViaInKeepout(
          point,
          point.via_diameter ?? getViaDimensions(srj).padDiameter,
          srj.viaKeepouts,
          srj.layerCount,
          minZ,
          maxZ,
        )
      ) {
        throw new Error(
          `Via copper overlaps a keepout at (${point.x}, ${point.y})`,
        )
      }
    }
  }
}
