import type { SimpleRouteJson } from "lib/types"
import { getUniqueValidZLayersFromLayerNames } from "lib/utils/mapLayerNameToZ"

/** A through-via crosses plane layers too. Only a planar wire demonstrates signal routing there. */
export function getBgaSignalLayers(srj: SimpleRouteJson): number[] {
  const layers = new Set<string>()
  for (const connection of srj.connections) {
    for (const point of connection.pointsToConnect) {
      if (point.layer) layers.add(point.layer)
    }
  }
  for (const trace of srj.traces ?? []) {
    for (const [index, point] of trace.route.entries()) {
      const next = trace.route[index + 1]
      if (
        point.route_type === "wire" &&
        next?.route_type === "wire" &&
        point.layer === next.layer &&
        (point.x !== next.x || point.y !== next.y)
      ) {
        layers.add(point.layer)
      }
    }
  }
  return getUniqueValidZLayersFromLayerNames([...layers], srj.layerCount)
}
