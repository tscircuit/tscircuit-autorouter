import { getConnectionPointLayers } from "lib/utils/connection-point-utils"
import type { ConnectionPoint } from "lib/types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

type GetConnectionPointZLayersParams = {
  point: ConnectionPoint
  layerCount: number
}

export function getConnectionPointZLayers({
  point,
  layerCount,
}: GetConnectionPointZLayersParams): number[] {
  const layerNames = getConnectionPointLayers(point)
  const zLayers = layerNames.map((layerName) =>
    mapLayerNameToZ(layerName, layerCount),
  )

  return [...new Set(zLayers)]
}
