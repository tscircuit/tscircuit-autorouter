import { pointToBoxDistance } from "@tscircuit/math-utils"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { sharedZLayers } from "./sharedZLayers"
import { ConnectionHg, RegionHg } from "./types"

export const getValidEndpointPointInRegion = (params: {
  connection: ConnectionHg
  region: RegionHg
  layerCount: number
}): { x: number; y: number; z: number } | null => {
  const { connection, region, layerCount } = params
  for (const point of connection.simpleRouteConnection?.pointsToConnect ?? []) {
    if (pointToBoxDistance(point, region.d) !== 0) continue
    const layers =
      "layers" in point
        ? point.layers.map((layer) => mapLayerNameToZ(layer, layerCount))
        : [mapLayerNameToZ(point.layer, layerCount)]
    const sharedLayers = sharedZLayers(layers, region.d.availableZ)
    if (sharedLayers.length === 0) continue
    return {
      x: point.x,
      y: point.y,
      z: sharedLayers[0],
    }
  }
  return null
}
