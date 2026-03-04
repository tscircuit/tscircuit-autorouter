import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { sharedZLayers } from "./sharedZLayers"
import { ConnectionHg, RegionHg } from "./types"

export const getConnectionEndpointPointInRegion = (params: {
  connection: ConnectionHg
  region: RegionHg
  layerCount: number
  endpointKind: "start" | "end"
  preferredZ?: number
}): { x: number; y: number; z: number } | null => {
  const { connection, region, layerCount, endpointKind, preferredZ } = params
  const endpointIndex = endpointKind === "start" ? 0 : 1
  const endpointPoint =
    connection.simpleRouteConnection?.pointsToConnect?.[endpointIndex]
  if (!endpointPoint) return null

  const endpointLayers =
    "layers" in endpointPoint
      ? endpointPoint.layers.map((layer) => mapLayerNameToZ(layer, layerCount))
      : [mapLayerNameToZ(endpointPoint.layer, layerCount)]

  const sharedLayers = sharedZLayers(endpointLayers, region.d.availableZ)
  if (sharedLayers.length === 0) return null

  const z =
    preferredZ !== undefined && sharedLayers.includes(preferredZ)
      ? preferredZ
      : sharedLayers[0]

  return {
    x: endpointPoint.x,
    y: endpointPoint.y,
    z,
  }
}
