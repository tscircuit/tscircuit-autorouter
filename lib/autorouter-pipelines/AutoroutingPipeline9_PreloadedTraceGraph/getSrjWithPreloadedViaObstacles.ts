import type { Obstacle, SimpleRouteJson } from "lib/types"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"

export function getSrjWithPreloadedViaObstacles(
  srj: SimpleRouteJson,
): SimpleRouteJson {
  const viaObstacles: Obstacle[] = []
  const { padDiameter } = getViaDimensions(srj)

  for (const trace of srj.traces ?? []) {
    const connectedTo = [
      ...new Set([trace.connection_name, ...(trace.connectsTo ?? [])]),
    ]
    for (const [routeIndex, point] of trace.route.entries()) {
      if (point.route_type !== "via") continue

      const fromZ = mapLayerNameToZ(point.from_layer, srj.layerCount)
      const toZ = mapLayerNameToZ(point.to_layer, srj.layerCount)
      const minZ = srj.allowBlindAndBuriedVias ? Math.min(fromZ, toZ) : 0
      const maxZ = srj.allowBlindAndBuriedVias
        ? Math.max(fromZ, toZ)
        : srj.layerCount - 1
      const zLayers =
        srj.allowBlindAndBuriedVias && point.layers !== undefined
          ? point.layers.map((layer) => mapLayerNameToZ(layer, srj.layerCount))
          : Array.from(
              { length: maxZ - minZ + 1 },
              (_, layerOffset) => minZ + layerOffset,
            )
      const diameter = point.via_diameter ?? padDiameter

      viaObstacles.push({
        obstacleId: `preloaded_via_${trace.pcb_trace_id}_${routeIndex}`,
        type: "rect",
        shape: "circle",
        center: { x: point.x, y: point.y },
        width: diameter,
        height: diameter,
        layers: zLayers.map((z) => mapZToLayerName(z, srj.layerCount)),
        zLayers,
        __zLayers: zLayers,
        connectedTo,
      })
    }
  }

  if (viaObstacles.length === 0) return srj
  return { ...srj, obstacles: [...srj.obstacles, ...viaObstacles] }
}
